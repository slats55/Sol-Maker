/**
 * UNSIGNED SELL REQUEST + POSITION RECONCILIATION (Sprint 109).
 *
 * The sell-side mirror of the buy canary: `live.canary.sell_request.v1` is an operator-review
 * artifact describing ONE proposed exit — which position, what a REAL fresh sell-side quote says
 * the tokens would fetch, the estimated (never claimed) PnL, and the full refusal trail. Like the
 * buy request it is structurally incapable of selling:
 *
 *   - It embeds at most a real UNSIGNED `txpreview.envelope.v1`; the human signs in Phantom.
 *   - `signed / submitted / confirmed` are pinned false; the backend custodies no key.
 *   - It REFUSES (never warns) on: a closed/unknown position, a stale or missing sell quote, an
 *     unverifiable token balance (unless the operator explicitly asks for an EMERGENCY REVIEW,
 *     which produces a blocked, review-only artifact — still no request), a missing/expired
 *     operator approval, and a live policy that is not green for a canary.
 *   - PnL is an ESTIMATE from the quote and says so; reconciliation stays the honest accounting.
 *
 * `live.position.reconciliation.v1` compares what the LEDGER expects a position to hold with what
 * a provider/wallet OBSERVED. An unobservable balance is verdict `unknown` — never invented.
 *
 * Pure: the caller supplies every timestamp and observation; no clock, no network, no I/O.
 */

import { isSensitiveKey } from "@soulmaker/security";
import type { UnsignedTxEnvelope } from "@soulmaker/txpreview";

import type { LiveCanaryQuoteFacts } from "./canary-request.js";
import type { OperatorApprovalEvaluation } from "./operator-approval.js";
import { evaluateLivePolicy } from "./policy.js";
import type { LiveModePolicy } from "./policy.js";
import type { LivePosition } from "./position.js";

export const LIVE_SELL_REQUEST_SCHEMA_VERSION = "live.canary.sell_request.v1";
export const LIVE_POSITION_RECONCILIATION_SCHEMA_VERSION = "live.position.reconciliation.v1";

export const LIVE_SELL_REQUEST_BANNER =
  "SELL REVIEW — the embedded transaction (if any) is UNSIGNED; the backend holds no key and cannot " +
  "sell. You sign and submit in Phantom yourself, or nothing happens. PnL figures are ESTIMATES from " +
  "a quote, not results. Not financial advice; not a claim of profit.";

/** The only states a sell request can carry. It can never claim to have sold. */
export const LIVE_SELL_REQUEST_STATES = ["blocked", "review_ready", "envelope_ready"] as const;
export type LiveSellRequestState = (typeof LIVE_SELL_REQUEST_STATES)[number];

export const SELL_REQUEST_BLOCK_CODES = [
  "position-not-open",
  "position-kind-unknown",
  "token-balance-unverified",
  "sell-quote-missing",
  "sell-quote-stale",
  "sell-quote-age-unknown",
  "sell-quote-mint-mismatch",
  "approval-missing",
  "approval-inactive",
  "policy-not-green",
  "emergency-review-only",
] as const;
export type SellRequestBlockCode = (typeof SELL_REQUEST_BLOCK_CODES)[number];

export interface LiveSellRequest {
  schemaVersion: typeof LIVE_SELL_REQUEST_SCHEMA_VERSION;
  banner: string;
  createdAt: string;
  chain: "solana";
  network: "mainnet-beta";
  walletProvider: "phantom";
  state: LiveSellRequestState;
  /** Whether this artifact was produced in emergency review mode (blocked, review-only). */
  emergencyReview: boolean;
  position: {
    positionId: string;
    kind: string;
    mint: string;
    symbol: string | null;
    openedAt: string;
    entrySpendLamports: number;
    tokenAmountRaw: string | null;
  };
  /** The REAL fresh sell-side quote facts (token → SOL). */
  quote: LiveCanaryQuoteFacts | null;
  /** Expected SOL out per the quote (raw lamport integer string), when a quote exists. */
  expectedSolOutLamports: string | null;
  /** ESTIMATED PnL vs entry, per the quote — an estimate, never a result. */
  estimatedPnlLamports: number | null;
  estimatedPnlPct: number | null;
  approval: { supplied: boolean; active: boolean; reasons: string[] };
  /** The real UNSIGNED sell transaction for Phantom, when the operator supplied one. */
  envelope: UnsignedTxEnvelope | null;
  blockingReasons: SellRequestBlockCode[];
  warnings: string[];
  /** Pinned honesty literals. */
  prepared: true;
  signed: false;
  submitted: false;
  confirmed: false;
  backendCustodiesNoKeys: true;
  requiresPhantomHumanConfirmation: true;
  notProfitabilityClaim: true;
}

export class LiveSellRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveSellRequestError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const RAW_INT_RE = /^[0-9]{1,30}$/;

export interface BuildLiveSellRequestInput {
  position: LivePosition;
  /** Sell-side quote facts: inputMint must be the position mint (token → SOL). */
  quote: LiveCanaryQuoteFacts | null;
  policy: LiveModePolicy;
  /** Evaluated operator approval (null = none supplied). */
  approvalEvaluation: OperatorApprovalEvaluation | null;
  /** The real UNSIGNED sell envelope, when the operator built one. */
  envelope?: UnsignedTxEnvelope | null;
  createdAt: string;
  nowMs: number;
  /** EMERGENCY REVIEW mode: produce a blocked, review-only artifact even without quote/balance. */
  emergencyReview?: boolean;
}

/**
 * Build a sell request. Defaults to BLOCKED; `envelope_ready` requires an open position with a
 * verified token amount, a fresh matching quote, an ACTIVE approval, a canary-green policy, and a
 * supplied unsigned envelope. `review_ready` is the same minus the envelope.
 */
export function buildLiveSellRequest(input: BuildLiveSellRequestInput): LiveSellRequest {
  const p = input.position;
  const emergency = input.emergencyReview === true;
  const blockingReasons: SellRequestBlockCode[] = [];
  const warnings: string[] = [];
  const block = (c: SellRequestBlockCode): void => {
    if (!blockingReasons.includes(c)) blockingReasons.push(c);
  };

  if (p.status !== "open") block("position-not-open");
  if (p.kind !== "paper" && p.kind !== "live_canary") block("position-kind-unknown");
  if (p.kind === "paper") {
    warnings.push("this is a PAPER position — a sell review here is a REHEARSAL; there is nothing on-chain to sell");
  }

  // Token balance must be verifiable from the position record; unknown is refused, not guessed.
  if (p.tokenAmountRaw === null || !RAW_INT_RE.test(p.tokenAmountRaw)) {
    block("token-balance-unverified");
  }

  // Quote checks: present, for the right mint, and FRESH per the policy quote TTL.
  const quote = input.quote;
  let expectedSolOutLamports: string | null = null;
  let estimatedPnlLamports: number | null = null;
  let estimatedPnlPct: number | null = null;
  if (quote === null) {
    block("sell-quote-missing");
  } else {
    if (quote.inputMint !== p.mint) block("sell-quote-mint-mismatch");
    if (quote.ageMs === null) block("sell-quote-age-unknown");
    else if (quote.ageMs < 0 || quote.ageMs > input.policy.freshness.quoteTtlMs) block("sell-quote-stale");
    if (RAW_INT_RE.test(quote.outAmountRaw)) {
      expectedSolOutLamports = quote.outAmountRaw;
      const out = Number(quote.outAmountRaw);
      if (Number.isSafeInteger(out) && p.entrySpendLamports > 0) {
        estimatedPnlLamports = out - p.entrySpendLamports;
        estimatedPnlPct = Math.round((estimatedPnlLamports / p.entrySpendLamports) * 10_000) / 100;
      }
    }
  }

  // Approval: required, and must be ACTIVE (an expired approval is exactly as powerless as none).
  const approvalEval = input.approvalEvaluation;
  if (approvalEval === null) block("approval-missing");
  else if (!approvalEval.active) block("approval-inactive");

  // Live policy must be canary-green for a live position's sell request. A paper rehearsal still
  // evaluates the policy so the rehearsal exercises the same wall.
  const policyEval = evaluateLivePolicy(input.policy);
  if (!policyEval.canaryArmAllowed) block("policy-not-green");

  if (emergency) {
    block("emergency-review-only");
    warnings.push(
      "EMERGENCY REVIEW: this artifact is for operator orientation only. To exit NOW, open Phantom yourself and swap the token back to SOL; then record the close with live:sniper:reconcile.",
    );
  }

  const envelope = input.envelope ?? null;
  let state: LiveSellRequestState;
  if (blockingReasons.length > 0) state = "blocked";
  else if (envelope !== null) state = "envelope_ready";
  else state = "review_ready";

  return {
    schemaVersion: LIVE_SELL_REQUEST_SCHEMA_VERSION,
    banner: LIVE_SELL_REQUEST_BANNER,
    createdAt: input.createdAt,
    chain: "solana",
    network: "mainnet-beta",
    walletProvider: "phantom",
    state,
    emergencyReview: emergency,
    position: {
      positionId: p.positionId,
      kind: p.kind,
      mint: p.mint,
      symbol: p.symbol,
      openedAt: p.openedAt,
      entrySpendLamports: p.entrySpendLamports,
      tokenAmountRaw: p.tokenAmountRaw,
    },
    quote,
    expectedSolOutLamports,
    estimatedPnlLamports,
    estimatedPnlPct,
    approval: {
      supplied: approvalEval !== null,
      active: approvalEval?.active === true,
      reasons: approvalEval?.reasons ?? [],
    },
    envelope: blockingReasons.length > 0 ? null : envelope,
    blockingReasons,
    warnings,
    prepared: true,
    signed: false,
    submitted: false,
    confirmed: false,
    backendCustodiesNoKeys: true,
    requiresPhantomHumanConfirmation: true,
    notProfitabilityClaim: true,
  };
}

const SELL_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "banner",
  "createdAt",
  "chain",
  "network",
  "walletProvider",
  "state",
  "emergencyReview",
  "position",
  "quote",
  "expectedSolOutLamports",
  "estimatedPnlLamports",
  "estimatedPnlPct",
  "approval",
  "envelope",
  "blockingReasons",
  "warnings",
  "prepared",
  "signed",
  "submitted",
  "confirmed",
  "backendCustodiesNoKeys",
  "requiresPhantomHumanConfirmation",
  "notProfitabilityClaim",
]);

/** Strictly validate a persisted sell request (closed schema; send-shaped fields refused). */
export function validateLiveSellRequest(value: unknown): LiveSellRequest {
  if (!isObject(value)) throw new LiveSellRequestError("sell request must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new LiveSellRequestError(`sell request carries sensitive-named field "${key}"`);
    if (!SELL_KEYS.has(key)) throw new LiveSellRequestError(`sell request carries unknown field "${key}" — the v1 schema is CLOSED (a signature/send-result can never ride here)`);
  }
  if (value.schemaVersion !== LIVE_SELL_REQUEST_SCHEMA_VERSION) {
    throw new LiveSellRequestError(`sell request.schemaVersion must be "${LIVE_SELL_REQUEST_SCHEMA_VERSION}"`);
  }
  for (const [literal, expected] of [
    ["prepared", true],
    ["signed", false],
    ["submitted", false],
    ["confirmed", false],
    ["backendCustodiesNoKeys", true],
    ["requiresPhantomHumanConfirmation", true],
    ["notProfitabilityClaim", true],
  ] as const) {
    if (value[literal] !== expected) throw new LiveSellRequestError(`sell request.${literal} must be the literal ${String(expected)}`);
  }
  if (!(LIVE_SELL_REQUEST_STATES as readonly string[]).includes(value.state as string)) {
    throw new LiveSellRequestError(`sell request.state must be one of ${LIVE_SELL_REQUEST_STATES.join("|")}`);
  }
  return value as unknown as LiveSellRequest;
}

// ---------------------------------------------------------------------------
// Position reconciliation (expected vs observed; unknown stays unknown)
// ---------------------------------------------------------------------------

export const POSITION_RECONCILIATION_VERDICTS = ["matches", "mismatch", "unknown"] as const;
export type PositionReconciliationVerdict = (typeof POSITION_RECONCILIATION_VERDICTS)[number];

export interface PositionReconciliationRecord {
  schemaVersion: typeof LIVE_POSITION_RECONCILIATION_SCHEMA_VERSION;
  reconciledAt: string;
  positionId: string;
  mint: string;
  kind: string;
  status: string;
  /** What the ledger expects the position to hold (raw integer string; null = never recorded). */
  expectedTokenAmountRaw: string | null;
  /** What a provider/wallet actually observed (null = could not be observed). */
  observedTokenAmountRaw: string | null;
  /** Where the observation came from; "none" when nothing was observable. */
  observationSource: string;
  verdict: PositionReconciliationVerdict;
  notes: string[];
  /** Pinned honesty literals. */
  balancesNeverInvented: true;
  notProfitabilityClaim: true;
}

export interface ReconcilePositionInput {
  position: LivePosition;
  /** The real observation, or null when the balance could not be read. */
  observedTokenAmountRaw: string | null;
  observationSource: string | null;
  reconciledAt: string;
}

/**
 * Compare the ledger's expectation with a real observation. A paper position expects NOTHING
 * on-chain (it never held funds) — an observation of 0/none MATCHES it. An unobservable balance is
 * verdict `unknown`, never a made-up number.
 */
export function reconcilePosition(input: ReconcilePositionInput): PositionReconciliationRecord {
  const p = input.position;
  const observed = input.observedTokenAmountRaw !== null && RAW_INT_RE.test(input.observedTokenAmountRaw) ? input.observedTokenAmountRaw : null;
  const notes: string[] = [];
  let verdict: PositionReconciliationVerdict;

  if (p.kind === "paper") {
    notes.push("paper position: it NEVER held funds, so the honest on-chain expectation is zero/none");
    if (observed === null) {
      verdict = "unknown";
      notes.push("no wallet observation was supplied — the on-chain state is honestly unknown");
    } else if (/^0+$/.test(observed)) {
      verdict = "matches";
    } else {
      verdict = "mismatch";
      notes.push("a real balance exists where a paper position expects none — investigate before trusting this ledger");
    }
  } else if (observed === null) {
    verdict = "unknown";
    notes.push("the wallet/provider balance could not be observed — reported as unknown, never invented");
  } else if (p.tokenAmountRaw === null) {
    verdict = "unknown";
    notes.push("the ledger never recorded a token amount for this live position — expected value is unknown; record the real fill via live:sniper:reconcile first");
  } else if (p.status === "closed") {
    verdict = /^0+$/.test(observed) ? "matches" : "mismatch";
    if (verdict === "mismatch") notes.push("position is closed in the ledger but tokens remain in the wallet — the close may not have happened on-chain");
  } else {
    verdict = observed === p.tokenAmountRaw ? "matches" : "mismatch";
    if (verdict === "mismatch") notes.push(`ledger expects ${p.tokenAmountRaw} raw, wallet observed ${observed} raw — do NOT trust the ledger value until resolved`);
  }

  return {
    schemaVersion: LIVE_POSITION_RECONCILIATION_SCHEMA_VERSION,
    reconciledAt: input.reconciledAt,
    positionId: p.positionId,
    mint: p.mint,
    kind: p.kind,
    status: p.status,
    expectedTokenAmountRaw: p.kind === "paper" ? "0" : p.tokenAmountRaw,
    observedTokenAmountRaw: observed,
    observationSource: input.observationSource?.trim().slice(0, 60) || "none",
    verdict,
    notes,
    balancesNeverInvented: true,
    notProfitabilityClaim: true,
  };
}
