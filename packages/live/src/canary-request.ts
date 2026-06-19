/**
 * The PHANTOM-SIGNABLE CANARY REQUEST (`live.canary.request.v1`, Sprint 107, Part 1).
 *
 * The artifact a browser Phantom flow consumes to (maybe) sign a single tiny real trade. The
 * backend ASSEMBLES it from a real unsigned transaction plus the quote/risk/preflight facts and
 * RE-DERIVES the gate verdict — it never signs, never sends, and never custodies a key. The
 * embedded `envelope` is the real, strictly-validated, UNSIGNED `txpreview.envelope.v1`; the human
 * hands it to Phantom in the browser and confirms (or rejects) the transaction themselves.
 *
 * Honesty contract, pinned as literals on every request:
 *   - `prepared: true`, `signed: false`, `submitted: false`, `confirmed: false` — a request is
 *     always PRE-signature. The post-signature lifecycle (phantom_requested → submitted →
 *     confirmed → reconciled) lives in the browser and is governed by the canary state machine; it
 *     never mutates this artifact.
 *   - `backendCustodiesNoKeys: true`, `requiresPhantomHumanConfirmation: true`.
 *   - `notProfitabilityClaim: true`, `phase7LiveTradingReady: false` — this is not a promise of
 *     profit and the backend authorizes nothing; the human's Phantom signature is the only
 *     authorization, made out-of-band in their own wallet.
 *
 * The builder can only ever emit a PRE-ARM state: blocked_by_policy | blocked_by_risk |
 * quote_ready | preflight_ready. Arming requires preflight_ready, which in turn requires a green
 * simulation — so a request the operator never simulated can never be armed.
 */

import { evaluateSafetyControls } from "@soulmaker/execution";
import type { OperatorSafetyControls, SafetyViolation, SessionState, TradeContext } from "@soulmaker/execution";
import { isSensitiveKey, redactString, redactValue } from "@soulmaker/security";
import { validateUnsignedTxEnvelope } from "@soulmaker/txpreview";
import type { UnsignedTxEnvelope } from "@soulmaker/txpreview";

import type { CanaryState } from "./canary-state.js";
import { evaluateLivePolicy } from "./policy.js";
import type { LiveModePolicy } from "./policy.js";

export const LIVE_CANARY_REQUEST_SCHEMA_VERSION = "live.canary.request.v1";
export const LIVE_CANARY_REQUEST_NETWORK = "mainnet-beta";
export const LIVE_CANARY_REQUEST_CHAIN = "solana";
export const LIVE_CANARY_REQUEST_WALLET_PROVIDER = "phantom";

export const LIVE_CANARY_REQUEST_BANNER =
  "REAL-MONEY LIVE CANARY REQUEST — Solana mainnet-beta. The embedded transaction is UNSIGNED; the " +
  "backend holds no key and authorizes nothing. You sign and confirm this transaction in Phantom " +
  "yourself, or it never happens. This is not financial advice and not a claim of profit. Memecoin " +
  "trading can lose the entire amount.";

const LAMPORTS_PER_SOL = 1_000_000_000;

/** The only states a request artifact may carry (the post-signature lifecycle is browser-side). */
export const LIVE_CANARY_REQUEST_STATES = [
  "blocked_by_policy",
  "blocked_by_risk",
  "quote_ready",
  "preflight_ready",
] as const satisfies readonly CanaryState[];
export type LiveCanaryRequestState = (typeof LIVE_CANARY_REQUEST_STATES)[number];

export interface LiveCanaryQuoteFacts {
  provider: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  slippageBps: number;
  priceImpactPct: number | null;
  quotedAt: string | null;
  ageMs: number | null;
  routeLabels: string[];
}

export interface LiveCanaryRiskFacts {
  score: number;
  decision: string;
  criticalFlagCount: number;
  flagIds: string[];
}

export interface LiveCanaryPreflightFacts {
  simulationOutcome: string | null;
  simulationClassification: string | null;
}

export interface LiveCanaryPolicySummary {
  mode: string;
  maxTradeSol: number;
  maxSlippageBps: number;
  riskScoreCap: number;
  quoteTtlMs: number;
  cooldownMs: number;
  killSwitch: boolean;
}

export interface LiveCanaryRequest {
  schemaVersion: typeof LIVE_CANARY_REQUEST_SCHEMA_VERSION;
  banner: string;
  createdAt: string;
  chain: typeof LIVE_CANARY_REQUEST_CHAIN;
  network: typeof LIVE_CANARY_REQUEST_NETWORK;
  walletProvider: typeof LIVE_CANARY_REQUEST_WALLET_PROVIDER;
  mode: string;
  state: LiveCanaryRequestState;
  candidate: { mint: string; symbol: string | null };
  policy: LiveCanaryPolicySummary;
  quote: LiveCanaryQuoteFacts | null;
  risk: LiveCanaryRiskFacts | null;
  preflight: LiveCanaryPreflightFacts;
  spendLamports: string | null;
  /** The real UNSIGNED transaction for Phantom. null when blocked before a transaction was built. */
  envelope: UnsignedTxEnvelope | null;
  blockingReasons: string[];
  warnings: string[];
  /** Pinned honesty literals. */
  prepared: true;
  signed: false;
  submitted: false;
  confirmed: false;
  backendCustodiesNoKeys: true;
  requiresPhantomHumanConfirmation: true;
  notProfitabilityClaim: true;
  phase7LiveTradingReady: false;
}

export class LiveCanaryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveCanaryRequestError";
  }
}

export interface BuildLiveCanaryRequestInput {
  policy: LiveModePolicy;
  createdAt: string;
  nowMs: number;
  candidate: { mint: string; symbol?: string | null };
  quote: LiveCanaryQuoteFacts | null;
  risk: LiveCanaryRiskFacts | null;
  preflight: LiveCanaryPreflightFacts;
  /** Planned spend in lamports (integer string). */
  spendLamports: string | null;
  /** The real unsigned transaction for Phantom; null if no transaction was built (e.g. blocked early). */
  envelope: UnsignedTxEnvelope | null;
  /** Whether an audit log path accompanies this attempt. */
  auditLogPathProvided: boolean;
  /** Session counters for cooldown / per-day / duplicate-mint checks. */
  session?: Partial<SessionState>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Map a {@link LiveModePolicy} onto the execution package's proven {@link OperatorSafetyControls}. */
export function policyToSafetyControls(policy: LiveModePolicy): OperatorSafetyControls {
  return {
    killSwitchActive: policy.killSwitch,
    emergencyStopFilePresent: policy.emergencyStopFilePresent,
    maxSpendPerTradeLamports: String(Math.floor(policy.caps.maxTradeSol * LAMPORTS_PER_SOL)),
    maxTradesPerSession: policy.caps.maxDailyTrades,
    sessionLossCapSol: policy.caps.maxDailyLossSol,
    slippageCapBps: policy.caps.maxSlippageBps,
    riskScoreCap: policy.caps.riskScoreCap,
    quoteAgeCapMs: policy.freshness.quoteTtlMs,
    allowedMints: policy.tokenAllowlist,
    blockedMints: policy.tokenDenylist,
    allowedProviders: null,
    networkLock: LIVE_CANARY_REQUEST_NETWORK,
    auditLogRequired: policy.requireAuditLog,
    cooldownMs: policy.cooldownMs,
    duplicateMintProtection: true,
  };
}

const RISK_SAFETY_CODES = new Set(["safety-risk-over-cap", "safety-risk-missing"]);

/**
 * Assemble a {@link LiveCanaryRequest} from real facts, re-deriving the gate verdict and state.
 * Pure (no clock/network): the caller supplies `createdAt` and `nowMs`.
 */
export function buildLiveCanaryRequest(input: BuildLiveCanaryRequestInput): LiveCanaryRequest {
  const { policy } = input;
  if (typeof input.candidate?.mint !== "string" || input.candidate.mint.length === 0 || input.candidate.mint.length > 44) {
    throw new LiveCanaryRequestError("candidate.mint must be a non-empty base58 mint string");
  }
  const symbol = input.candidate.symbol ?? null;
  if (symbol !== null && (typeof symbol !== "string" || symbol.length > 40 || redactString(symbol) !== symbol)) {
    throw new LiveCanaryRequestError("candidate.symbol must be a short, redaction-safe string or null");
  }

  // Re-validate the embedded envelope (proves it is unsigned and mainnet-beta) if one was built.
  let envelope: UnsignedTxEnvelope | null = null;
  if (input.envelope !== null) {
    envelope = validateUnsignedTxEnvelope(input.envelope);
    if (envelope.network !== LIVE_CANARY_REQUEST_NETWORK) {
      throw new LiveCanaryRequestError(`a live canary envelope must be ${LIVE_CANARY_REQUEST_NETWORK}, got ${envelope.network}`);
    }
  }

  const policyEval = evaluateLivePolicy(policy);
  const blockingReasons: string[] = [...policyEval.blockingReasons];
  const warnings: string[] = [...policyEval.warnings];

  // ALWAYS run the proven safety-controls evaluator over this prospective trade — never skip it.
  // A missing quote means slippage / freshness / provider are unknown, which the evaluator FAILS
  // CLOSED on (missing-field violations). Skipping the evaluator on a null quote would LOOSEN the
  // gate (a null quote could otherwise reach preflight_ready uncapped), which the "checks only
  // tighten" invariant forbids.
  const rawAgeMs = input.quote
    ? input.quote.ageMs ?? (input.quote.quotedAt !== null ? input.nowMs - Date.parse(input.quote.quotedAt) : null)
    : null;
  const trade: TradeContext = {
    mint: input.candidate.mint,
    provider: input.quote?.provider ?? "unknown",
    network: LIVE_CANARY_REQUEST_NETWORK,
    spendLamports: input.spendLamports,
    slippageBps: input.quote?.slippageBps ?? null,
    riskScore: input.risk?.score ?? null,
    quoteAgeMs: typeof rawAgeMs === "number" && Number.isFinite(rawAgeMs) ? rawAgeMs : null,
    auditLogPathProvided: input.auditLogPathProvided,
  };
  const session: SessionState = {
    tradesCount: input.session?.tradesCount ?? 0,
    sessionLossSol: input.session?.sessionLossSol ?? 0,
    lastTradeAtMs: input.session?.lastTradeAtMs ?? null,
    mintsTraded: input.session?.mintsTraded ?? [],
  };
  const safetyViolations: SafetyViolation[] = evaluateSafetyControls(policyToSafetyControls(policy), trade, session, input.nowMs).violations;
  if (input.quote === null) {
    warnings.push("no quote facts supplied — slippage/freshness caps cannot be verified; the request fails closed");
  }

  // Classify risk-blocking separately so the state can distinguish risk from policy.
  const riskRejected =
    (input.risk !== null && (input.risk.decision === "REJECT" || input.risk.criticalFlagCount > 0)) ||
    safetyViolations.some((v) => RISK_SAFETY_CODES.has(v.code));
  for (const v of safetyViolations) blockingReasons.push(v.code);

  // Preflight: a failed/refused simulation is a hard block; only "simulated-ok" reaches preflight_ready.
  const sim = input.preflight.simulationOutcome;
  const simFailed = sim === "simulated-failed" || sim === "refused";
  if (simFailed) blockingReasons.push("preflight-simulation-failed");

  // State precedence: a configuration that can't even prepare is policy-blocked; otherwise a risk
  // rejection dominates; otherwise any remaining safety/preflight block is a policy block; otherwise
  // a green simulation reaches preflight_ready and anything short of that stays quote_ready.
  let state: LiveCanaryRequestState;
  if (!policyEval.prepareAllowed) {
    state = "blocked_by_policy";
  } else if (riskRejected) {
    state = "blocked_by_risk";
  } else if (blockingReasons.length > 0) {
    state = "blocked_by_policy";
  } else if (sim === "simulated-ok" && envelope !== null) {
    state = "preflight_ready";
  } else {
    state = "quote_ready";
  }

  const request: LiveCanaryRequest = {
    schemaVersion: LIVE_CANARY_REQUEST_SCHEMA_VERSION,
    banner: LIVE_CANARY_REQUEST_BANNER,
    createdAt: input.createdAt,
    chain: LIVE_CANARY_REQUEST_CHAIN,
    network: LIVE_CANARY_REQUEST_NETWORK,
    walletProvider: LIVE_CANARY_REQUEST_WALLET_PROVIDER,
    mode: policy.mode,
    state,
    candidate: { mint: input.candidate.mint, symbol },
    policy: {
      mode: policy.mode,
      maxTradeSol: policy.caps.maxTradeSol,
      maxSlippageBps: policy.caps.maxSlippageBps,
      riskScoreCap: policy.caps.riskScoreCap,
      quoteTtlMs: policy.freshness.quoteTtlMs,
      cooldownMs: policy.cooldownMs,
      killSwitch: policy.killSwitch,
    },
    quote: input.quote,
    risk: input.risk,
    preflight: input.preflight,
    spendLamports: input.spendLamports,
    envelope,
    blockingReasons: dedupe(blockingReasons),
    warnings: dedupe(warnings),
    prepared: true,
    signed: false,
    submitted: false,
    confirmed: false,
    backendCustodiesNoKeys: true,
    requiresPhantomHumanConfirmation: true,
    notProfitabilityClaim: true,
    phase7LiveTradingReady: false,
  };
  return request;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Redact a canary request for serialization (defense-in-depth) WITHOUT corrupting the embedded
 * envelope. `redactValue`'s base58/base64 length heuristic can mangle `envelope.txBase64` (an
 * unsigned, validated, PUBLIC transaction blob), so the validated envelope is preserved verbatim.
 * The request is built/validated as a closed schema that already refuses any secret-named field, so
 * nothing secret can ride along on it.
 */
export function redactCanaryRequestForOutput(request: LiveCanaryRequest): unknown {
  const redacted = redactValue(request) as Record<string, unknown>;
  redacted.envelope = request.envelope;
  return redacted;
}

/** Strictly validate a value as a {@link LiveCanaryRequest} (closed schema; honesty literals re-checked). */
export function validateLiveCanaryRequest(value: unknown): LiveCanaryRequest {
  if (!isObject(value)) throw new LiveCanaryRequestError("request must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new LiveCanaryRequestError(`request carries sensitive-named field "${key}" — key material can never ride along`);
  }
  if (value.schemaVersion !== LIVE_CANARY_REQUEST_SCHEMA_VERSION) {
    throw new LiveCanaryRequestError(`request.schemaVersion must be "${LIVE_CANARY_REQUEST_SCHEMA_VERSION}"`);
  }
  if (value.network !== LIVE_CANARY_REQUEST_NETWORK) throw new LiveCanaryRequestError(`request.network must be "${LIVE_CANARY_REQUEST_NETWORK}"`);
  if (value.chain !== LIVE_CANARY_REQUEST_CHAIN) throw new LiveCanaryRequestError(`request.chain must be "${LIVE_CANARY_REQUEST_CHAIN}"`);
  if (value.walletProvider !== LIVE_CANARY_REQUEST_WALLET_PROVIDER) throw new LiveCanaryRequestError(`request.walletProvider must be "${LIVE_CANARY_REQUEST_WALLET_PROVIDER}"`);
  if (typeof value.state !== "string" || !(LIVE_CANARY_REQUEST_STATES as readonly string[]).includes(value.state)) {
    throw new LiveCanaryRequestError(`request.state must be one of ${LIVE_CANARY_REQUEST_STATES.join("|")} (post-signature states live in the browser)`);
  }
  for (const [literal, expected] of [
    ["prepared", true],
    ["signed", false],
    ["submitted", false],
    ["confirmed", false],
    ["backendCustodiesNoKeys", true],
    ["requiresPhantomHumanConfirmation", true],
    ["notProfitabilityClaim", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[literal] !== expected) throw new LiveCanaryRequestError(`request.${literal} must be the literal ${String(expected)}`);
  }
  if (value.envelope !== null && value.envelope !== undefined) {
    const env = validateUnsignedTxEnvelope(value.envelope);
    if (env.network !== LIVE_CANARY_REQUEST_NETWORK) throw new LiveCanaryRequestError("request.envelope must be mainnet-beta");
  }
  return value as unknown as LiveCanaryRequest;
}
