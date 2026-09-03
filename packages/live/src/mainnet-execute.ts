/**
 * MAINNET EXECUTE (Sprint 111) — the buy and sell orchestration that was never assembled.
 *
 * Order of operations for a BUY, every step a refusal wall:
 *   envelope (mainnet-beta, unsigned) → simulation report (simulated-ok, SAME envelope, fresh)
 *   → quote freshness → duplicate / max-open walls → fourteen-condition live gate → signer
 *   (must be the envelope's fee payer) → balances BEFORE → attemptExecution (submit once)
 *   → confirmSignature → balances AFTER → position opened ONLY on a landed transaction.
 *
 * Outcomes are honest and disjoint:
 *   refused                — nothing was sent
 *   failed-onchain         — sent, landed with an error: no position, no funds moved but the fee
 *   submitted-unconfirmed  — sent, status unknown at the deadline: NO position; must reconcile
 *   confirmed              — landed; position opened with the signature as its proof
 *
 * Pure with respect to I/O: every RPC, clock, sleep and file read is injected.
 */

import {
  attemptExecution,
  confirmSignature,
  evaluateMainnetLiveGate,
  loadLocalSignerBoundary,
  SignerBoundaryError,
  tokenDelta,
  type BalanceRpcLike,
  type ConfirmResult,
  type ConfirmRpcLike,
  type ExecutionAttemptReport,
  type MainnetLiveGateResult,
  type OperatorSafetyControls,
  type SendRpcLike,
  type SessionState,
  type TokenDelta,
  type TransactionSigningBoundary,
} from "@soulmaker/execution";
import { redactString } from "@soulmaker/security";
import { validateUnsignedTxEnvelope, type UnsignedTxEnvelope } from "@soulmaker/txpreview";
import {
  closePosition,
  ledgerOpen,
  ledgerReplace,
  openPosition,
  type ExitReason,
  type LivePosition,
  type PositionLedger,
} from "./position.js";

export const MAINNET_EXECUTION_REPORT_SCHEMA_VERSION = "live.mainnet.execution.v1";

export const MAINNET_EXECUTION_OUTCOMES = ["refused", "failed-onchain", "submitted-unconfirmed", "confirmed"] as const;
export type MainnetExecutionOutcome = (typeof MAINNET_EXECUTION_OUTCOMES)[number];

/** A simulation report may back a send only this long — after that, simulate again. */
export const MAX_SIMULATION_AGE_MS = 120_000;

export interface MainnetCaps {
  /** Per-trade spend cap in lamports (integer string). */
  maxSpendLamports: string;
  sessionLossCapSol: number;
  slippageCapBps: number;
  riskScoreCap: number;
  quoteAgeCapMs: number;
  maxTradesPerSession: number;
  maxOpenPositions: number;
  /** Minimum SOL the wallet must retain AFTER the buy (lamports). */
  minSolReserveLamports: number;
}

export interface MainnetRpcSeams {
  send: SendRpcLike;
  confirm: ConfirmRpcLike;
  balance: BalanceRpcLike;
  endpointHost: string;
}

export interface MainnetExecuteCommonInput {
  /** The unsigned envelope value (validated here). */
  envelopeValue: unknown;
  /** The txpreview simulation report value for the SAME envelope (validated here). */
  simulationValue: unknown;
  riskScore: number;
  env: Record<string, string | undefined>;
  configPhase7LiveTradingReady: boolean;
  configKillSwitch: boolean;
  emergencyStopFilePresent: boolean;
  cliAcknowledged: boolean;
  caps: MainnetCaps;
  ledger: PositionLedger;
  session: SessionState;
  signerEnvVar: string;
  readFile: (path: string) => string;
  rpc: MainnetRpcSeams;
  auditLogPathProvided: boolean;
  nowMs: () => number;
  clock: () => string;
  sleep?: (ms: number) => Promise<void>;
  confirmTimeoutMs?: number;
  confirmPollMs?: number;
}

export interface MainnetBuyInput extends MainnetExecuteCommonInput {
  symbol?: string | null;
}

export interface MainnetSellInput extends MainnetExecuteCommonInput {
  /** The OPEN `live` position being sold (must be in `ledger`). */
  positionId: string;
  reason: ExitReason;
  detail?: string;
}

export interface BalanceSnapshot {
  solLamports: number;
  tokenRaw: string;
}

export interface MainnetExecutionReport {
  schemaVersion: typeof MAINNET_EXECUTION_REPORT_SCHEMA_VERSION;
  side: "buy" | "sell";
  outcome: MainnetExecutionOutcome;
  attemptedAt: string;
  mint: string | null;
  endpointHost: string;
  refusalDetail: string | null;
  liveGate: MainnetLiveGateResult | null;
  attempt: ExecutionAttemptReport | null;
  confirm: ConfirmResult | null;
  /** The signature when anything was sent (public chain data); null when refused. */
  signature: string | null;
  /** The fee payer / signer public key and the bounded spend, recorded so a crash after send is recoverable. */
  feePayer: string | null;
  spendLamports: string | null;
  balancesBefore: BalanceSnapshot | null;
  balancesAfter: BalanceSnapshot | null;
  tokenDelta: TokenDelta | null;
  solDeltaLamports: number | null;
  position: LivePosition | null;
  /** The ledger AFTER this execution (unchanged unless a position opened/closed). */
  ledger: PositionLedger;
  caveats: string[];
  notProfitabilityClaim: true;
}

// ---------------------------------------------------------------------------
// Shared preflight (buy and sell)
// ---------------------------------------------------------------------------

interface Preflight {
  envelope: UnsignedTxEnvelope;
  quoteAgeMs: number;
  liveGate: MainnetLiveGateResult;
  signer: TransactionSigningBoundary;
  controls: OperatorSafetyControls;
}

type PreflightResult = { ok: true; value: Preflight } | { ok: false; detail: string; liveGate: MainnetLiveGateResult | null };

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function refuse(detail: string, liveGate: MainnetLiveGateResult | null = null): PreflightResult {
  return { ok: false, detail, liveGate };
}

function preflight(input: MainnetExecuteCommonInput, nowMs: number): PreflightResult {
  // 1) Envelope: strictly unsigned, strictly mainnet-beta.
  let envelope: UnsignedTxEnvelope;
  try {
    envelope = validateUnsignedTxEnvelope(input.envelopeValue);
  } catch (err) {
    return refuse(`envelope invalid: ${(err as Error).message}`);
  }
  if (envelope.network !== "mainnet-beta") return refuse(`envelope network is "${envelope.network}", not mainnet-beta`);

  // 2) Simulation: simulated-ok, for THIS envelope, and recent.
  const sim = input.simulationValue;
  if (!isObject(sim)) return refuse("simulation report is missing or not an object");
  if (sim.outcome !== "simulated-ok") return refuse(`simulation outcome is "${String(sim.outcome)}", not simulated-ok — simulate the exact envelope first`);
  if (sim.feePayerPublicKey !== envelope.feePayerPublicKey || sim.candidateMint !== envelope.candidateMint || sim.builderId !== envelope.builderId) {
    return refuse("simulation report does not describe this envelope (fee payer / mint / builder mismatch)");
  }
  const simAt = typeof sim.simulatedAt === "string" ? Date.parse(sim.simulatedAt) : NaN;
  if (!Number.isFinite(simAt)) return refuse("simulation report carries no parseable simulatedAt");
  const simAge = nowMs - simAt;
  if (simAge < 0 || simAge > MAX_SIMULATION_AGE_MS) return refuse(`simulation is ${simAge}ms old (cap ${MAX_SIMULATION_AGE_MS}ms) — simulate again`);

  // 3) Quote freshness from the envelope's own provenance. Missing = never fresh.
  if (typeof envelope.quotedAt !== "string") return refuse("envelope carries no quotedAt — a quoteless envelope can never satisfy the freshness gate");
  const quotedMs = Date.parse(envelope.quotedAt);
  if (!Number.isFinite(quotedMs)) return refuse("envelope quotedAt is not parseable");
  const quoteAgeMs = nowMs - quotedMs;
  const quoteFresh = quoteAgeMs >= 0 && quoteAgeMs <= input.caps.quoteAgeCapMs;

  // 4) The fourteen-condition gate. Default state BLOCKED; nothing here can skip a check.
  const killSwitchActive = input.configKillSwitch || input.emergencyStopFilePresent || input.env.SOULMAKER_KILL_SWITCH === "true";
  const liveGate = evaluateMainnetLiveGate({
    env: input.env,
    configPhase7LiveTradingReady: input.configPhase7LiveTradingReady,
    cliAcknowledged: input.cliAcknowledged,
    network: envelope.network,
    maxSpendLamports: input.caps.maxSpendLamports,
    sessionLossCapSol: input.caps.sessionLossCapSol,
    slippageCapBps: input.caps.slippageCapBps,
    killSwitchActive,
    quoteFresh,
    simulationOutcome: "simulated-ok",
    riskScore: input.riskScore,
    riskScoreCap: input.caps.riskScoreCap,
    walletPublicKeyValid: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(envelope.feePayerPublicKey),
    signerBoundaryKind: "local-file",
    auditLogPathProvided: input.auditLogPathProvided,
    redactionFindings: 0,
  });
  if (!liveGate.armed) {
    const failed = liveGate.checks.filter((c) => !c.satisfied).map((c) => `${c.gate}: ${c.detail}`);
    return refuse(`mainnet live gate BLOCKED (${failed.length} failed):\n  - ${failed.join("\n  - ")}`, liveGate);
  }

  // 5) Signer through the boundary, ONLY behind the armed gate, and it must BE the fee payer.
  let signer: TransactionSigningBoundary;
  try {
    signer = loadLocalSignerBoundary({
      envVarName: input.signerEnvVar,
      env: input.env,
      readFile: input.readFile,
      network: "mainnet-beta",
      mainnetLiveGate: liveGate,
    });
  } catch (err) {
    const msg = err instanceof SignerBoundaryError ? err.message : "signer boundary failed";
    return refuse(msg, liveGate);
  }
  if (signer.publicKeyBase58 !== envelope.feePayerPublicKey) {
    return refuse("the loaded signer is NOT the envelope's fee payer — the envelope was built for a different wallet", liveGate);
  }

  const controls: OperatorSafetyControls = {
    killSwitchActive,
    emergencyStopFilePresent: input.emergencyStopFilePresent,
    maxSpendPerTradeLamports: input.caps.maxSpendLamports,
    maxTradesPerSession: input.caps.maxTradesPerSession,
    sessionLossCapSol: input.caps.sessionLossCapSol,
    slippageCapBps: input.caps.slippageCapBps,
    riskScoreCap: input.caps.riskScoreCap,
    quoteAgeCapMs: input.caps.quoteAgeCapMs,
    allowedMints: null,
    blockedMints: [],
    allowedProviders: null,
    networkLock: "mainnet-beta",
    auditLogRequired: true,
    cooldownMs: 0,
    duplicateMintProtection: true,
  };
  return { ok: true, value: { envelope, quoteAgeMs, liveGate, signer, controls } };
}

async function snapshot(rpc: BalanceRpcLike, owner: string, mint: string | null): Promise<BalanceSnapshot> {
  const solLamports = await rpc.getBalanceLamports(owner);
  const tokenRaw = mint ? await rpc.getTokenBalanceRaw(owner, mint) : "0";
  return { solLamports, tokenRaw };
}

function baseReport(side: "buy" | "sell", input: MainnetExecuteCommonInput, attemptedAt: string, mint: string | null): MainnetExecutionReport {
  return {
    schemaVersion: MAINNET_EXECUTION_REPORT_SCHEMA_VERSION,
    side,
    outcome: "refused",
    attemptedAt,
    mint,
    endpointHost: input.rpc.endpointHost,
    refusalDetail: null,
    liveGate: null,
    attempt: null,
    confirm: null,
    signature: null,
    feePayer: null,
    spendLamports: null,
    balancesBefore: null,
    balancesAfter: null,
    tokenDelta: null,
    solDeltaLamports: null,
    position: null,
    ledger: input.ledger,
    caveats: [],
    notProfitabilityClaim: true,
  };
}

function refusedReport(r: MainnetExecutionReport, detail: string, liveGate: MainnetLiveGateResult | null = null): MainnetExecutionReport {
  return { ...r, outcome: "refused", refusalDetail: redactString(detail), liveGate };
}

/** Submit once, confirm, snapshot after. Shared by buy and sell. Never throws. */
async function sendAndConfirm(
  input: MainnetExecuteCommonInput,
  pf: Preflight,
  r: MainnetExecutionReport,
  tradeMint: string,
  spendLamports: string,
  nowMs: number,
): Promise<MainnetExecutionReport> {
  const owner = pf.envelope.feePayerPublicKey;
  let before: BalanceSnapshot;
  try {
    before = await snapshot(input.rpc.balance, owner, tradeMint);
  } catch (err) {
    return refusedReport(r, `could not read balances before sending (${(err as Error).message}) — refusing to trade blind`, pf.liveGate);
  }
  r = { ...r, liveGate: pf.liveGate, balancesBefore: before, feePayer: owner, spendLamports: spendLamports };

  const attempt = await attemptExecution({
    mode: "mainnet-live-armed",
    mainnetLiveGate: pf.liveGate,
    signer: pf.signer,
    envelopeValue: input.envelopeValue,
    rpc: input.rpc.send,
    endpointHost: input.rpc.endpointHost,
    controls: pf.controls,
    trade: {
      mint: tradeMint,
      provider: pf.envelope.builderId,
      network: pf.envelope.network,
      spendLamports,
      slippageBps: pf.envelope.constraints.slippageBps ?? 0,
      riskScore: input.riskScore,
      quoteAgeMs: pf.quoteAgeMs,
      auditLogPathProvided: input.auditLogPathProvided,
    },
    session: input.session,
    nowMs,
    clock: input.clock,
  });
  r = { ...r, attempt };
  if (attempt.outcome !== "submitted" || !attempt.signature) {
    return refusedReport(r, attempt.refusalDetail ?? attempt.refusalCode ?? "send refused", pf.liveGate);
  }
  r = { ...r, signature: attempt.signature };

  const confirm = await confirmSignature({
    rpc: input.rpc.confirm,
    signature: attempt.signature,
    timeoutMs: input.confirmTimeoutMs,
    pollMs: input.confirmPollMs,
    nowMs: input.nowMs,
    sleep: input.sleep,
  });
  r = { ...r, confirm };
  if (confirm.status === "failed") {
    return { ...r, outcome: "failed-onchain", caveats: [...r.caveats, `transaction landed with an error: ${confirm.errLabel ?? "unknown"} — no position; only the fee was spent`] };
  }
  if (!confirm.landed) {
    return {
      ...r,
      outcome: "submitted-unconfirmed",
      caveats: [...r.caveats, `confirmation ${confirm.status} after ${confirm.polls} poll(s) — the signature MUST be reconciled before any further trading (live:sniper:reconcile-startup)`],
    };
  }

  let after: BalanceSnapshot | null = null;
  try {
    after = await snapshot(input.rpc.balance, owner, tradeMint);
  } catch {
    r = { ...r, caveats: [...r.caveats, "balances AFTER could not be read — token amount recorded as unknown; reconcile on next start"] };
  }
  const delta = after ? tokenDelta(before.tokenRaw, after.tokenRaw) : null;
  return { ...r, outcome: "confirmed", balancesAfter: after, tokenDelta: delta, solDeltaLamports: after ? after.solLamports - before.solLamports : null };
}

// ---------------------------------------------------------------------------
// BUY
// ---------------------------------------------------------------------------

/** Execute one bounded mainnet BUY. A position is opened ONLY on a landed transaction. */
export async function executeMainnetBuy(input: MainnetBuyInput): Promise<MainnetExecutionReport> {
  const nowMs = input.nowMs();
  const attemptedAt = input.clock();
  let r = baseReport("buy", input, attemptedAt, null);

  const pf = preflight(input, nowMs);
  if (!pf.ok) return refusedReport(r, pf.detail, pf.liveGate);
  const { envelope } = pf.value;
  const mint = envelope.candidateMint;
  if (!mint) return refusedReport(r, "a buy envelope must name its candidateMint", pf.value.liveGate);
  r = { ...r, mint };

  // Duplicate-intent + max-open walls against the LEDGER (the persisted truth).
  const openPositions = input.ledger.positions.filter((p) => p.status === "open");
  if (openPositions.some((p) => p.mint === mint)) {
    return refusedReport(r, `an OPEN position for ${mint} already exists in the ledger — duplicate buy refused`, pf.value.liveGate);
  }
  if (openPositions.length >= input.caps.maxOpenPositions) {
    return refusedReport(r, `max open positions reached (${openPositions.length}/${input.caps.maxOpenPositions})`, pf.value.liveGate);
  }
  const spend = envelope.constraints.maxSpendLamports;
  if (!spend || !/^[0-9]{1,20}$/.test(spend) || /^0+$/.test(spend)) {
    return refusedReport(r, "envelope carries no positive maxSpendLamports constraint", pf.value.liveGate);
  }
  if (BigInt(spend) > BigInt(input.caps.maxSpendLamports)) {
    return refusedReport(r, `envelope spend ${spend} exceeds the per-trade cap ${input.caps.maxSpendLamports}`, pf.value.liveGate);
  }

  // Reserve wall: the wallet must keep its floor AFTER spend + a fee allowance.
  try {
    const sol = await input.rpc.balance.getBalanceLamports(envelope.feePayerPublicKey);
    const FEE_ALLOWANCE = 10_000;
    if (sol - Number(spend) - FEE_ALLOWANCE < input.caps.minSolReserveLamports) {
      return refusedReport(r, `wallet would fall below the SOL reserve (${sol} - ${spend} < ${input.caps.minSolReserveLamports})`, pf.value.liveGate);
    }
  } catch (err) {
    return refusedReport(r, `could not read the wallet balance (${(err as Error).message})`, pf.value.liveGate);
  }

  r = await sendAndConfirm(input, pf.value, r, mint, spend, nowMs);
  if (r.outcome !== "confirmed" || !r.signature) return r;

  const received = r.tokenDelta && BigInt(r.tokenDelta.deltaRaw) > 0n ? r.tokenDelta.deltaRaw : null;
  const caveats = [...r.caveats];
  if (!received) caveats.push("confirmed, but no positive token delta was observed yet (RPC lag or balance read failed) — tokenAmountRaw unknown; reconcile on next start");
  let position: LivePosition;
  try {
    position = openPosition({
      kind: "live",
      mint,
      symbol: input.symbol ?? null,
      openedAt: input.clock(),
      entrySpendLamports: Number(spend),
      tokenAmountRaw: received,
      entrySignature: r.signature,
    });
  } catch (err) {
    // The buy LANDED. Losing the position record would be worse than a loud caveat.
    return { ...r, caveats: [...caveats, `LANDED but the ledger REFUSED the position (${(err as Error).message}) — reconcile immediately`] };
  }
  return { ...r, position, ledger: ledgerOpen(input.ledger, position), caveats };
}

// ---------------------------------------------------------------------------
// SELL
// ---------------------------------------------------------------------------

/**
 * Execute one mainnet SELL for an OPEN `live` position. The envelope must be a token→SOL swap
 * whose candidateMint is the position's mint. The position closes ONLY on a landed transaction,
 * with the realized value taken from the REAL SOL delta (net of fees — honest, not the quote).
 */
export async function executeMainnetSell(input: MainnetSellInput): Promise<MainnetExecutionReport> {
  const nowMs = input.nowMs();
  const attemptedAt = input.clock();
  let r = baseReport("sell", input, attemptedAt, null);

  const position = input.ledger.positions.find((p) => p.positionId === input.positionId) ?? null;
  if (!position) return refusedReport(r, `no position ${input.positionId} exists in the ledger — an unknown position can never be sold`);
  if (position.status !== "open") return refusedReport(r, `position ${input.positionId} is already closed`);
  if (position.kind !== "live") return refusedReport(r, `position ${input.positionId} is kind "${position.kind}" — only backend-signed live positions can be sold here`);
  r = { ...r, mint: position.mint };

  const pf = preflight(input, nowMs);
  if (!pf.ok) return refusedReport(r, pf.detail, pf.liveGate);
  const { envelope } = pf.value;
  if (envelope.candidateMint !== position.mint) {
    return refusedReport(r, `sell envelope is for ${envelope.candidateMint ?? "no mint"}, not the position's ${position.mint}`, pf.value.liveGate);
  }

  // A sell is bounded by what the position cost — never more "spend" than the entry. The
  // duplicate-mint control guards against buying a mint twice; selling the mint we HOLD is the
  // point, so the position's own mint is excluded from the session's traded set for this call.
  const spend = String(position.entrySpendLamports);
  const sellInput: MainnetSellInput = { ...input, session: { ...input.session, mintsTraded: input.session.mintsTraded.filter((m) => m !== position.mint) } };
  r = await sendAndConfirm(sellInput, pf.value, r, position.mint, spend, nowMs);
  if (r.outcome !== "confirmed" || !r.signature) return r;

  const caveats = [...r.caveats];
  const value = r.solDeltaLamports !== null && r.solDeltaLamports > 0 ? r.solDeltaLamports : null;
  if (value === null) caveats.push("confirmed, but the SOL delta was not positive/observable — realized value recorded as unknown, never guessed");
  if (r.tokenDelta && BigInt(r.tokenDelta.afterRaw) > 0n) caveats.push(`a token remainder of ${r.tokenDelta.afterRaw} raw units is still held after the sell`);

  let closed: LivePosition;
  try {
    closed = closePosition({
      position,
      closedAt: input.clock(),
      reason: input.reason,
      closeKind: "live-auto",
      valueLamports: value,
      detail: input.detail ?? `sold via ${envelope.builderId}`,
      signature: r.signature,
    });
  } catch (err) {
    return { ...r, caveats: [...caveats, `SELL LANDED but the ledger REFUSED the close (${(err as Error).message}) — reconcile immediately`] };
  }
  return { ...r, position: closed, ledger: ledgerReplace(input.ledger, closed), caveats };
}
