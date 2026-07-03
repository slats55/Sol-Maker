/**
 * OPERATOR CANARY RECONCILIATION + PnL ACCOUNTING (`live.operator.reconciliation.v1`, Sprint 109,
 * Part 3).
 *
 * The hardened post-canary accounting layer. It wraps the Part 2 canary reconciliation (signature /
 * status / lamport balances) and adds the operator-grade accounting the release needs:
 *
 *   - PRE/POST wallet snapshots for BOTH sides: SOL lamports and the candidate token's raw units.
 *   - Gross token received, SOL spent, and fees — each `null` (never invented) when not derivable.
 *   - SLIPPAGE EVIDENCE: realized output vs. the quoted expectation, in signed bps, only when both
 *     are known.
 *   - Realized vs. unrealized PnL, honestly: a canary BUY has no realized PnL beyond its known
 *     lamport outflow until the position is closed; the unrealized side needs a price, and a price
 *     needs evidence. `pnlStatus` says exactly which case applies. NO price evidence ⇒ `unknown`.
 *   - RECONCILIATION CONFIDENCE: high / medium / low / none, re-derived from which facts exist,
 *     never asserted by the caller.
 *
 * Pure: no clock, no network, no chain reads. Fixtures in tests; real evidence via the CLI.
 */

import { buildCanaryReconciliation } from "./canary-reconcile.js";
import type { CanaryReconciliationFacts, CanaryReconciliationRecord } from "./canary-reconcile.js";
import { assertNoSecretMaterial } from "./operator-config.js";

export const LIVE_OPERATOR_RECONCILIATION_SCHEMA_VERSION = "live.operator.reconciliation.v1";

/** How much of the accounting could actually be established from evidence. */
export const RECONCILIATION_CONFIDENCE_LEVELS = ["high", "medium", "low", "none"] as const;
export type ReconciliationConfidence = (typeof RECONCILIATION_CONFIDENCE_LEVELS)[number];

/** The honest PnL classification. */
export const PNL_STATUSES = [
  "unrealized-priced", // position open; token amount + price evidence known ⇒ an ESTIMATE exists
  "unrealized-unpriced", // position open; token amount known but NO price evidence ⇒ value unknown
  "realized-loss-known", // the SOL outflow is known exactly; nothing to price (failed/no tokens)
  "unknown", // not enough evidence for any statement
] as const;
export type PnlStatus = (typeof PNL_STATUSES)[number];

export interface OperatorBalanceSnapshot {
  /** Wallet SOL balance in lamports (stringified integer), or null when not captured. */
  solLamports: string | null;
  /** Candidate-token balance in RAW units (stringified integer), or null when not captured. */
  tokenRaw: string | null;
  /** When the snapshot was taken (ISO), or null. */
  capturedAt: string | null;
}

export interface OperatorReconcileInput {
  candidateMint: string;
  /** The Part 2 confirmation facts (signature/status/slot/amounts/fees/lamport balances). */
  canary: CanaryReconciliationFacts;
  pre: OperatorBalanceSnapshot;
  post: OperatorBalanceSnapshot;
  /** Token decimals, if known (needed to turn raw units into display units). */
  tokenDecimals: number | null;
  /** The quoted expected output in raw units (slippage baseline), if a quote was captured. */
  quotedOutRaw: string | null;
  /** Optional price evidence: token price in USD + where it came from. Both or neither. */
  tokenPriceUsd: number | null;
  priceEvidence: string | null;
}

export interface OperatorReconciliationRecord {
  schemaVersion: typeof LIVE_OPERATOR_RECONCILIATION_SCHEMA_VERSION;
  candidateMint: string;
  /** The embedded Part 2 reconciliation record (validated, re-derived verdict). */
  canary: CanaryReconciliationRecord;
  pre: OperatorBalanceSnapshot;
  post: OperatorBalanceSnapshot;
  tokenDecimals: number | null;
  /** post.tokenRaw − pre.tokenRaw when both known; else null. */
  grossTokenReceivedRaw: string | null;
  /** pre.solLamports − post.solLamports when both known (positive = SOL left the wallet); else null. */
  solSpentLamports: string | null;
  /** Echoed fee facts (from the canary facts; null when unknown). */
  feesLamports: string | null;
  priorityFeeLamports: string | null;
  /** Realized output vs. quoted expectation in signed bps (negative = received less); null unless both known. */
  quotedOutRaw: string | null;
  slippageRealizedBps: number | null;
  /** Honest PnL classification + the numbers that back it (null = not derivable). */
  pnlStatus: PnlStatus;
  unrealizedValueUsd: number | null;
  tokenPriceUsd: number | null;
  priceEvidence: string | null;
  pnlNote: string;
  /** Re-derived from which facts exist. Never caller-asserted. */
  confidence: ReconciliationConfidence;
  confidenceReasons: string[];
  notes: string[];
  /** Pinned honesty literals. */
  notProfitabilityClaim: true;
  backendCustodiesNoKeys: true;
  backendNeverSends: true;
}

export class OperatorReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorReconcileError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIntString(value: unknown): value is string {
  return typeof value === "string" && /^-?[0-9]{1,20}$/.test(value);
}

function optIntString(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  if (!isIntString(value)) throw new OperatorReconcileError(`${name} must be a stringified integer or null`);
  return value;
}

function snapshot(value: OperatorBalanceSnapshot | undefined, name: string): OperatorBalanceSnapshot {
  if (value === undefined || value === null) return { solLamports: null, tokenRaw: null, capturedAt: null };
  return {
    solLamports: optIntString(value.solLamports, `${name}.solLamports`),
    tokenRaw: optIntString(value.tokenRaw, `${name}.tokenRaw`),
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : null,
  };
}

/**
 * Build the operator reconciliation record. Every derived number requires its inputs; a missing
 * input yields `null` plus an honest note — nothing is estimated silently.
 */
export function buildOperatorReconciliation(input: OperatorReconcileInput): OperatorReconciliationRecord {
  assertNoSecretMaterial({ ...input, canary: { ...input.canary, signature: null } }, "reconciliation input");
  const canary = buildCanaryReconciliation({ candidateMint: input.candidateMint, facts: input.canary });
  const pre = snapshot(input.pre, "pre");
  const post = snapshot(input.post, "post");
  const notes: string[] = [...canary.notes];

  if (input.tokenDecimals !== null && (!Number.isInteger(input.tokenDecimals) || input.tokenDecimals < 0 || input.tokenDecimals > 18)) {
    throw new OperatorReconcileError("tokenDecimals must be an integer 0–18 or null");
  }
  if ((input.tokenPriceUsd === null) !== (input.priceEvidence === null)) {
    throw new OperatorReconcileError("tokenPriceUsd and priceEvidence must be supplied together — a price without evidence is not accepted");
  }
  if (input.tokenPriceUsd !== null && (!Number.isFinite(input.tokenPriceUsd) || input.tokenPriceUsd <= 0)) {
    throw new OperatorReconcileError("tokenPriceUsd must be a positive finite number or null");
  }

  // Gross token received (post − pre), only when both sides were captured.
  let grossTokenReceivedRaw: string | null = null;
  if (isIntString(pre.tokenRaw) && isIntString(post.tokenRaw)) {
    grossTokenReceivedRaw = (BigInt(post.tokenRaw) - BigInt(pre.tokenRaw)).toString();
  } else {
    notes.push("token balances not captured on both sides — gross token received is unknown");
  }

  // SOL spent (pre − post; positive = outflow), only when both sides were captured.
  let solSpentLamports: string | null = null;
  if (isIntString(pre.solLamports) && isIntString(post.solLamports)) {
    solSpentLamports = (BigInt(pre.solLamports) - BigInt(post.solLamports)).toString();
  } else {
    notes.push("SOL balances not captured on both sides — exact SOL spent is unknown");
  }

  // Realized slippage vs. the quoted expectation (signed bps; negative = worse than quoted).
  const quotedOutRaw = optIntString(input.quotedOutRaw, "quotedOutRaw");
  let slippageRealizedBps: number | null = null;
  if (quotedOutRaw !== null && grossTokenReceivedRaw !== null && BigInt(quotedOutRaw) > 0n && BigInt(grossTokenReceivedRaw) >= 0n) {
    const quoted = BigInt(quotedOutRaw);
    const got = BigInt(grossTokenReceivedRaw);
    slippageRealizedBps = Number(((got - quoted) * 10_000n) / quoted);
  } else if (quotedOutRaw !== null) {
    notes.push("quoted output known but realized output is not — realized slippage is unknown");
  }

  // Honest PnL classification.
  let pnlStatus: PnlStatus;
  let unrealizedValueUsd: number | null = null;
  let pnlNote: string;
  const gotTokens = grossTokenReceivedRaw !== null && BigInt(grossTokenReceivedRaw) > 0n;
  if (gotTokens && input.tokenPriceUsd !== null && input.tokenDecimals !== null) {
    const units = Number(BigInt(grossTokenReceivedRaw!)) / Math.pow(10, input.tokenDecimals);
    unrealizedValueUsd = units * input.tokenPriceUsd;
    pnlStatus = "unrealized-priced";
    pnlNote = `position OPEN — unrealized value ≈ $${unrealizedValueUsd.toFixed(6)} at the evidenced price (${input.priceEvidence}); an estimate, not realized PnL, not a profit claim`;
  } else if (gotTokens) {
    pnlStatus = "unrealized-unpriced";
    pnlNote = "position OPEN and tokens were received, but no price evidence was supplied — unrealized PnL is UNKNOWN and is not estimated";
  } else if (solSpentLamports !== null && canary.status !== "unknown") {
    pnlStatus = "realized-loss-known";
    pnlNote = `no tokens received; the known SOL outflow is ${solSpentLamports} lamports (fees included where captured) — this is the realized cost, not a strategy result`;
  } else {
    pnlStatus = "unknown";
    pnlNote = "insufficient evidence for ANY PnL statement — reported as unknown, never estimated";
  }

  // Confidence, re-derived from which facts exist.
  const confidenceReasons: string[] = [];
  const hasSignature = canary.signature !== null;
  const settled = canary.status === "confirmed" || canary.status === "finalized";
  const bothSol = isIntString(pre.solLamports) && isIntString(post.solLamports);
  const bothTok = isIntString(pre.tokenRaw) && isIntString(post.tokenRaw);
  if (hasSignature) confidenceReasons.push("signature-recorded");
  if (settled) confidenceReasons.push(`status-${canary.status}`);
  if (bothSol) confidenceReasons.push("sol-balances-captured");
  if (bothTok) confidenceReasons.push("token-balances-captured");
  let confidence: ReconciliationConfidence;
  if (hasSignature && settled && bothSol && bothTok) confidence = "high";
  else if (hasSignature && settled && (bothSol || bothTok)) confidence = "medium";
  else if (hasSignature || bothSol || bothTok) confidence = "low";
  else confidence = "none";
  if (confidence !== "high") confidenceReasons.push("missing facts keep confidence below high — capture both balance snapshots and a settled status");

  return {
    schemaVersion: LIVE_OPERATOR_RECONCILIATION_SCHEMA_VERSION,
    candidateMint: canary.candidateMint,
    canary,
    pre,
    post,
    tokenDecimals: input.tokenDecimals,
    grossTokenReceivedRaw,
    solSpentLamports,
    feesLamports: canary.feesLamports,
    priorityFeeLamports: canary.priorityFeeLamports,
    quotedOutRaw,
    slippageRealizedBps,
    pnlStatus,
    unrealizedValueUsd,
    tokenPriceUsd: input.tokenPriceUsd,
    priceEvidence: input.priceEvidence,
    pnlNote,
    confidence,
    confidenceReasons,
    notes,
    notProfitabilityClaim: true,
    backendCustodiesNoKeys: true,
    backendNeverSends: true,
  };
}

const RECORD_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "candidateMint",
  "canary",
  "pre",
  "post",
  "tokenDecimals",
  "grossTokenReceivedRaw",
  "solSpentLamports",
  "feesLamports",
  "priorityFeeLamports",
  "quotedOutRaw",
  "slippageRealizedBps",
  "pnlStatus",
  "unrealizedValueUsd",
  "tokenPriceUsd",
  "priceEvidence",
  "pnlNote",
  "confidence",
  "confidenceReasons",
  "notes",
  "notProfitabilityClaim",
  "backendCustodiesNoKeys",
  "backendNeverSends",
]);

/** Strictly validate a value as an {@link OperatorReconciliationRecord} (closed; re-derives). */
export function validateOperatorReconciliation(value: unknown): OperatorReconciliationRecord {
  if (!isObject(value)) throw new OperatorReconcileError("operator reconciliation must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!RECORD_KEYS.has(key)) throw new OperatorReconcileError(`operator reconciliation carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_OPERATOR_RECONCILIATION_SCHEMA_VERSION) {
    throw new OperatorReconcileError(`operator reconciliation schemaVersion must be "${LIVE_OPERATOR_RECONCILIATION_SCHEMA_VERSION}"`);
  }
  if (value.notProfitabilityClaim !== true || value.backendCustodiesNoKeys !== true || value.backendNeverSends !== true) {
    throw new OperatorReconcileError("operator reconciliation pinned literals are tampered");
  }
  const canary = value.canary;
  if (!isObject(canary)) throw new OperatorReconcileError("operator reconciliation.canary must be an object");
  const rebuilt = buildOperatorReconciliation({
    candidateMint: value.candidateMint as string,
    canary: {
      signature: (canary.signature ?? null) as string | null,
      submittedAt: (canary.submittedAt ?? null) as string | null,
      lastStatusAt: (canary.lastStatusAt ?? null) as string | null,
      status: canary.status as CanaryReconciliationFacts["status"],
      slot: (canary.slot ?? null) as number | null,
      err: (canary.err ?? null) as string | null,
      inputAmountRaw: (canary.inputAmountRaw ?? null) as string | null,
      outputAmountRaw: (canary.outputAmountRaw ?? null) as string | null,
      solSpentLamports: (canary.solSpentLamports ?? null) as string | null,
      feesLamports: (canary.feesLamports ?? null) as string | null,
      priorityFeeLamports: (canary.priorityFeeLamports ?? null) as string | null,
      balanceBeforeLamports: (canary.balanceBeforeLamports ?? null) as string | null,
      balanceAfterLamports: (canary.balanceAfterLamports ?? null) as string | null,
    },
    pre: value.pre as OperatorBalanceSnapshot,
    post: value.post as OperatorBalanceSnapshot,
    tokenDecimals: (value.tokenDecimals ?? null) as number | null,
    quotedOutRaw: (value.quotedOutRaw ?? null) as string | null,
    tokenPriceUsd: (value.tokenPriceUsd ?? null) as number | null,
    priceEvidence: (value.priceEvidence ?? null) as string | null,
  });
  // Cross-check the caller's derived claims against the re-derivation (tamper evidence).
  if (rebuilt.confidence !== value.confidence) throw new OperatorReconcileError(`confidence mismatch — recorded "${String(value.confidence)}" but facts re-derive "${rebuilt.confidence}"`);
  if (rebuilt.pnlStatus !== value.pnlStatus) throw new OperatorReconcileError(`pnlStatus mismatch — recorded "${String(value.pnlStatus)}" but facts re-derive "${rebuilt.pnlStatus}"`);
  if (rebuilt.grossTokenReceivedRaw !== value.grossTokenReceivedRaw) throw new OperatorReconcileError("grossTokenReceivedRaw mismatch with re-derivation");
  if (rebuilt.solSpentLamports !== value.solSpentLamports) throw new OperatorReconcileError("solSpentLamports mismatch with re-derivation");
  if (rebuilt.slippageRealizedBps !== value.slippageRealizedBps) throw new OperatorReconcileError("slippageRealizedBps mismatch with re-derivation");
  return rebuilt;
}
