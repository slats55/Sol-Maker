/**
 * CANARY CONFIRMATION + RECONCILIATION (`live.canary.reconciliation.v1`, Sprint 108, Part 2).
 *
 * After a human signs and submits a canary in Phantom, this builds the typed reconciliation record
 * from the facts the operator captured (signature, on-chain status, slot, amounts, fees, balances).
 * It is the honest accounting layer:
 *   - PnL is reported as `unknown` unless it can be computed from supplied balances/amounts — it is
 *     NEVER fabricated. A would-be profit is not a claim of profit.
 *   - A `confirmed` / `finalized` status REQUIRES a signature: a transaction cannot be confirmed
 *     without one, and the builder refuses to claim otherwise.
 *   - The schema is CLOSED and refuses any secret-named field. A real 88-char signature is PUBLIC
 *     data, but committed EXAMPLES use a short fixture so the secret-blob scanner never trips.
 *
 * Pure: the caller supplies all timestamps and facts; no clock, no network, no chain reads.
 */

import { isSensitiveKey } from "@soulmaker/security";

export const LIVE_CANARY_RECONCILIATION_SCHEMA_VERSION = "live.canary.reconciliation.v1";

/** Honest on-chain status vocabulary. `unknown` is a real outcome, never hidden. */
export const CANARY_RECONCILIATION_STATUSES = ["submitted", "processed", "confirmed", "finalized", "failed", "timed_out", "unknown"] as const;
export type CanaryReconciliationStatus = (typeof CANARY_RECONCILIATION_STATUSES)[number];

/** Reconciliation verdicts — whether the operator can safely consider this canary closed. */
export const CANARY_RECONCILIATION_VERDICTS = ["reconciled", "reconciled-failed", "pending", "needs-manual-review"] as const;
export type CanaryReconciliationVerdict = (typeof CANARY_RECONCILIATION_VERDICTS)[number];

export interface CanaryReconciliationFacts {
  /** Phantom-returned transaction signature (public). Null if the human never submitted. */
  signature: string | null;
  submittedAt: string | null;
  lastStatusAt: string | null;
  status: CanaryReconciliationStatus;
  slot: number | null;
  err: string | null;
  inputAmountRaw: string | null;
  outputAmountRaw: string | null;
  solSpentLamports: string | null;
  feesLamports: string | null;
  priorityFeeLamports: string | null;
  /** Lamport balances if the operator captured them (enables a real PnL). */
  balanceBeforeLamports: string | null;
  balanceAfterLamports: string | null;
}

export interface CanaryReconciliationRecord {
  schemaVersion: typeof LIVE_CANARY_RECONCILIATION_SCHEMA_VERSION;
  network: "mainnet-beta";
  candidateMint: string;
  signature: string | null;
  submittedAt: string | null;
  lastStatusAt: string | null;
  status: CanaryReconciliationStatus;
  slot: number | null;
  err: string | null;
  inputAmountRaw: string | null;
  outputAmountRaw: string | null;
  solSpentLamports: string | null;
  feesLamports: string | null;
  priorityFeeLamports: string | null;
  balanceBeforeLamports: string | null;
  balanceAfterLamports: string | null;
  /** Net lamport delta when both balances are known; else null. */
  netLamports: string | null;
  /** Whether a real PnL could be computed (never fabricated). */
  pnlKnown: boolean;
  pnlNote: string;
  verdict: CanaryReconciliationVerdict;
  notes: string[];
  /** Pinned honesty literals. */
  notProfitabilityClaim: true;
  backendCustodiesNoKeys: true;
}

export class CanaryReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanaryReconciliationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIntString(value: string | null): value is string {
  return typeof value === "string" && /^-?[0-9]{1,20}$/.test(value);
}

export interface BuildCanaryReconciliationInput {
  candidateMint: string;
  facts: CanaryReconciliationFacts;
}

/** Build a reconciliation record. Derives an honest verdict + PnL; refuses to fake confirmation. */
export function buildCanaryReconciliation(input: BuildCanaryReconciliationInput): CanaryReconciliationRecord {
  const f = input.facts;
  if (typeof input.candidateMint !== "string" || input.candidateMint.length === 0 || input.candidateMint.length > 44) {
    throw new CanaryReconciliationError("candidateMint must be a non-empty base58 mint string");
  }
  if (!(CANARY_RECONCILIATION_STATUSES as readonly string[]).includes(f.status)) {
    throw new CanaryReconciliationError(`status must be one of ${CANARY_RECONCILIATION_STATUSES.join("|")}`);
  }
  // A transaction can never be confirmed/finalized without a signature.
  if ((f.status === "confirmed" || f.status === "finalized" || f.status === "processed") && (f.signature === null || f.signature.length === 0)) {
    throw new CanaryReconciliationError(`status "${f.status}" requires a signature — a transaction cannot reach this status without one`);
  }

  const notes: string[] = [];

  // PnL only when both balances are known. Never invent it.
  let netLamports: string | null = null;
  let pnlKnown = false;
  let pnlNote = "PnL unknown — balances/amounts not captured. A would-be outcome is never a claim of profit.";
  if (isIntString(f.balanceBeforeLamports) && isIntString(f.balanceAfterLamports)) {
    const delta = BigInt(f.balanceAfterLamports) - BigInt(f.balanceBeforeLamports);
    netLamports = delta.toString();
    pnlKnown = true;
    pnlNote = `net balance change ${netLamports} lamports (gross of any token holdings acquired; not annualized; not a profit claim)`;
  } else {
    notes.push("balances not both supplied — exact PnL cannot be known and is reported as unknown");
  }

  // Honest verdict.
  let verdict: CanaryReconciliationVerdict;
  if (f.status === "failed" || f.err !== null) verdict = "reconciled-failed";
  else if (f.status === "finalized") verdict = "reconciled";
  else if (f.status === "confirmed") verdict = "reconciled";
  else if (f.status === "timed_out" || f.status === "unknown") verdict = "needs-manual-review";
  else verdict = "pending";

  if (f.signature === null) notes.push("no signature recorded — the human did not submit, or it was not captured");

  return {
    schemaVersion: LIVE_CANARY_RECONCILIATION_SCHEMA_VERSION,
    network: "mainnet-beta",
    candidateMint: input.candidateMint,
    signature: f.signature,
    submittedAt: f.submittedAt,
    lastStatusAt: f.lastStatusAt,
    status: f.status,
    slot: f.slot,
    err: f.err,
    inputAmountRaw: f.inputAmountRaw,
    outputAmountRaw: f.outputAmountRaw,
    solSpentLamports: f.solSpentLamports,
    feesLamports: f.feesLamports,
    priorityFeeLamports: f.priorityFeeLamports,
    balanceBeforeLamports: f.balanceBeforeLamports,
    balanceAfterLamports: f.balanceAfterLamports,
    netLamports,
    pnlKnown,
    pnlNote,
    verdict,
    notes,
    notProfitabilityClaim: true,
    backendCustodiesNoKeys: true,
  };
}

const RECON_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "network",
  "candidateMint",
  "signature",
  "submittedAt",
  "lastStatusAt",
  "status",
  "slot",
  "err",
  "inputAmountRaw",
  "outputAmountRaw",
  "solSpentLamports",
  "feesLamports",
  "priorityFeeLamports",
  "balanceBeforeLamports",
  "balanceAfterLamports",
  "netLamports",
  "pnlKnown",
  "pnlNote",
  "verdict",
  "notes",
  "notProfitabilityClaim",
  "backendCustodiesNoKeys",
]);

/** Strictly validate a value as a {@link CanaryReconciliationRecord} (closed schema). */
export function validateCanaryReconciliation(value: unknown): CanaryReconciliationRecord {
  if (!isObject(value)) throw new CanaryReconciliationError("reconciliation must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new CanaryReconciliationError(`reconciliation carries sensitive-named field "${key}"`);
    if (!RECON_KEYS.has(key)) throw new CanaryReconciliationError(`reconciliation carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_CANARY_RECONCILIATION_SCHEMA_VERSION) {
    throw new CanaryReconciliationError(`reconciliation.schemaVersion must be "${LIVE_CANARY_RECONCILIATION_SCHEMA_VERSION}"`);
  }
  if (value.notProfitabilityClaim !== true) throw new CanaryReconciliationError("reconciliation.notProfitabilityClaim must be the literal true");
  if (value.backendCustodiesNoKeys !== true) throw new CanaryReconciliationError("reconciliation.backendCustodiesNoKeys must be the literal true");
  return value as unknown as CanaryReconciliationRecord;
}
