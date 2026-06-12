/**
 * POST-TRADE RECONCILIATION (Sprint 96) — the accounting layer every execution attempt must pass
 * through afterward: what was submitted, did it land, what did the balances actually do, and does
 * the observed effect match the expected one. Pure where possible; the only IO is the narrow
 * READ-ONLY RPC seam (balances, signature status, transaction fee) — this module can never sign,
 * send, or touch key material.
 *
 * Honesty rules:
 *   - deltas are computed ONLY from actually observed values; unavailable data says unavailable;
 *   - a verdict is never upgraded: unconfirmed stays pending, unobservable stays rpc-unavailable;
 *   - there is no P/L estimation, no faked fee, no faked balance change anywhere in this module.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { redactString } from "@soulmaker/security";
import type { ExecutionMode } from "./modes.js";

export const EXECUTION_RECONCILIATION_REPORT_SCHEMA_VERSION = "execution.reconciliation.report.v1";

export const RECONCILIATION_BANNER =
  "EXECUTION RECONCILIATION REPORT — post-trade accounting over one execution session: signature, confirmation classification, pre/post balance facts, and an expected-vs-actual verdict. Every fact is an actual observation or an honest unavailable; nothing here estimates P/L, fakes a balance change, or upgrades an unconfirmed submission.";

/** Closed verdict set. A verdict outside this list does not exist. */
export const RECONCILIATION_VERDICTS = [
  "reconciled",
  "unreconciled",
  "pending-confirmation",
  "not-sent",
  "funding-blocked",
  "rpc-unavailable",
  "unsupported",
  "error",
] as const;
export type ReconciliationVerdict = (typeof RECONCILIATION_VERDICTS)[number];

/** Verdicts after which a NEW execution attempt is safe (everything else blocks continuation). */
export const RECONCILIATION_CONTINUATION_SAFE_VERDICTS: readonly ReconciliationVerdict[] = [
  "reconciled",
  "not-sent",
  "funding-blocked",
];

// ---------------------------------------------------------------------------
// The narrow READ-ONLY RPC seam (production: a Connection wrapper; tests: a fake)
// ---------------------------------------------------------------------------

export interface ReconciliationRpcLike {
  getBalanceLamports(publicKeyBase58: string): Promise<number>;
  /**
   * Sum of the owner's token accounts for one mint. `null` means NO token account exists for
   * that owner+mint (an observation in itself: the balance is zero by absence).
   */
  getTokenBalance(
    ownerPublicKeyBase58: string,
    mintBase58: string,
  ): Promise<{ amountRaw: string; decimals: number } | null>;
  /** Signature status WITH transaction-history search (post-hoc reconciliation needs it). */
  getSignatureStatus(
    signature: string,
  ): Promise<{ status: "processed" | "confirmed" | "finalized" | null; slot: number | null; errLabel: string | null }>;
  /** Actual fee paid in lamports from confirmed transaction meta; null when unavailable. */
  getTransactionFeeLamports(signature: string): Promise<number | null>;
}

export interface ReconciliationRpc {
  readonly endpointHost: string;
  readonly rpc: ReconciliationRpcLike;
}

/**
 * Production factory: wrap one RPC URL into the read-only reconciliation seam. Balance and
 * status READS are safe on any cluster (mainnet dry-run balance evidence is allowed); nothing
 * exposed from here can sign or submit anything.
 */
export function createReconciliationRpc(rpcUrl: string): ReconciliationRpc {
  if (!rpcUrl || rpcUrl.trim().length === 0) {
    throw new Error("createReconciliationRpc requires a non-empty rpcUrl");
  }
  const connection = new Connection(rpcUrl, "confirmed");
  let endpointHost = "unknown";
  try {
    endpointHost = new URL(rpcUrl).host;
  } catch {
    /* keep "unknown" — the URL is still used verbatim by Connection */
  }
  return Object.freeze({
    endpointHost,
    rpc: Object.freeze({
      getBalanceLamports: async (publicKeyBase58: string) =>
        connection.getBalance(new PublicKey(publicKeyBase58), "confirmed"),
      getTokenBalance: async (ownerPublicKeyBase58: string, mintBase58: string) => {
        const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(ownerPublicKeyBase58), {
          mint: new PublicKey(mintBase58),
        });
        if (accounts.value.length === 0) return null;
        let total = 0n;
        let decimals: number | null = null;
        for (const entry of accounts.value) {
          const info = entry.account.data.parsed?.info as
            | { tokenAmount?: { amount?: unknown; decimals?: unknown } }
            | undefined;
          const amount = info?.tokenAmount?.amount;
          if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) {
            throw new Error("token account response is malformed (non-integer raw amount)");
          }
          total += BigInt(amount);
          const dec = info?.tokenAmount?.decimals;
          if (typeof dec === "number" && Number.isInteger(dec) && dec >= 0) decimals = dec;
        }
        if (decimals === null) throw new Error("token account response is malformed (no decimals)");
        return { amountRaw: total.toString(), decimals };
      },
      getSignatureStatus: async (signature: string) => {
        const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const status = statuses.value[0];
        if (status === null || status === undefined) return { status: null, slot: null, errLabel: null };
        const confirmationStatus =
          status.confirmationStatus === "processed" ||
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
            ? status.confirmationStatus
            : null;
        return {
          status: confirmationStatus,
          slot: typeof status.slot === "number" ? status.slot : null,
          errLabel: status.err === null ? null : redactString(JSON.stringify(status.err)).slice(0, 300),
        };
      },
      getTransactionFeeLamports: async (signature: string) => {
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        const fee = tx?.meta?.fee;
        return typeof fee === "number" && Number.isFinite(fee) && fee >= 0 ? fee : null;
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Balance snapshots and deltas (Slice 2)
// ---------------------------------------------------------------------------

export type BalanceFactStatus = "observed" | "rpc-unavailable" | "malformed";
export type TokenBalanceFactStatus = "observed" | "no-account" | "rpc-unavailable" | "malformed";

export interface SolBalanceFact {
  lamports: number | null;
  status: BalanceFactStatus;
  errLabel: string | null;
}

export interface TokenBalanceFact {
  mint: string;
  /** Raw integer amount as a string (u64-safe); null when not observed. */
  amountRaw: string | null;
  decimals: number | null;
  status: TokenBalanceFactStatus;
  errLabel: string | null;
}

export interface BalanceSnapshot {
  label: "pre" | "post";
  /** When the value was OBSERVED (not when the snapshot object was assembled). */
  observedAt: string;
  ownerPublicKey: string;
  sol: SolBalanceFact;
  /** Present only when a token mint was supplied for the read. */
  token: TokenBalanceFact | null;
}

export interface ReadBalanceSnapshotInput {
  rpc: Pick<ReconciliationRpcLike, "getBalanceLamports" | "getTokenBalance">;
  ownerPublicKeyBase58: string;
  /** Optional token mint to read alongside SOL. */
  tokenMint?: string | null;
  label: "pre" | "post";
  clock?: () => string;
}

/**
 * Read one balance snapshot. NEVER throws — RPC failures and malformed responses become honest
 * statuses on the facts. Requires only PUBLIC keys; no key material is accepted or readable here.
 */
export async function readBalanceSnapshot(input: ReadBalanceSnapshotInput): Promise<BalanceSnapshot> {
  const clock = input.clock ?? ((): string => new Date().toISOString());
  const observedAt = clock();
  let sol: SolBalanceFact;
  try {
    const lamports = await input.rpc.getBalanceLamports(input.ownerPublicKeyBase58);
    if (typeof lamports === "number" && Number.isFinite(lamports) && Number.isInteger(lamports) && lamports >= 0) {
      sol = { lamports, status: "observed", errLabel: null };
    } else {
      sol = { lamports: null, status: "malformed", errLabel: "balance response is not a non-negative integer" };
    }
  } catch (err) {
    sol = {
      lamports: null,
      status: "rpc-unavailable",
      errLabel: redactString((err as Error).message ?? "balance read failed").slice(0, 300),
    };
  }
  let token: TokenBalanceFact | null = null;
  if (typeof input.tokenMint === "string" && input.tokenMint.length > 0) {
    try {
      const result = await input.rpc.getTokenBalance(input.ownerPublicKeyBase58, input.tokenMint);
      if (result === null) {
        token = { mint: input.tokenMint, amountRaw: null, decimals: null, status: "no-account", errLabel: null };
      } else if (
        typeof result.amountRaw === "string" &&
        /^[0-9]+$/.test(result.amountRaw) &&
        Number.isInteger(result.decimals) &&
        result.decimals >= 0
      ) {
        token = {
          mint: input.tokenMint,
          amountRaw: result.amountRaw,
          decimals: result.decimals,
          status: "observed",
          errLabel: null,
        };
      } else {
        token = {
          mint: input.tokenMint,
          amountRaw: null,
          decimals: null,
          status: "malformed",
          errLabel: "token balance response is malformed",
        };
      }
    } catch (err) {
      token = {
        mint: input.tokenMint,
        amountRaw: null,
        decimals: null,
        status: "rpc-unavailable",
        errLabel: redactString((err as Error).message ?? "token balance read failed").slice(0, 300),
      };
    }
  }
  return { label: input.label, observedAt, ownerPublicKey: input.ownerPublicKeyBase58, sol, token };
}

export interface BalanceDelta {
  /** post - pre in lamports; computed ONLY when both sides were actually observed. */
  solLamports: number | null;
  solStatus: "computed" | "unavailable";
  token: {
    mint: string;
    /** post - pre raw amount as a signed integer string; "no-account" counts as an observed zero. */
    amountRawDelta: string | null;
    status: "computed" | "unavailable";
  } | null;
}

/** Compute deltas from two snapshots. Only actually observed values produce a number. */
export function computeBalanceDelta(pre: BalanceSnapshot, post: BalanceSnapshot): BalanceDelta {
  const solComputable = pre.sol.status === "observed" && post.sol.status === "observed";
  const delta: BalanceDelta = {
    solLamports: solComputable ? (post.sol.lamports as number) - (pre.sol.lamports as number) : null,
    solStatus: solComputable ? "computed" : "unavailable",
    token: null,
  };
  const mint = pre.token?.mint ?? post.token?.mint ?? null;
  if (mint !== null) {
    const side = (fact: TokenBalanceFact | null): bigint | null => {
      if (fact === null) return null;
      if (fact.status === "no-account") return 0n;
      if (fact.status === "observed" && fact.amountRaw !== null) return BigInt(fact.amountRaw);
      return null;
    };
    const preAmount = side(pre.token);
    const postAmount = side(post.token);
    const computable = preAmount !== null && postAmount !== null;
    delta.token = {
      mint,
      amountRawDelta: computable ? (postAmount - preAmount).toString() : null,
      status: computable ? "computed" : "unavailable",
    };
  }
  return delta;
}

// ---------------------------------------------------------------------------
// Confirmation tracking and classification (Slice 3)
// ---------------------------------------------------------------------------

export const CONFIRMATION_OUTCOMES = [
  "confirmed",
  "finalized",
  "timeout",
  "dropped",
  "rpc-unavailable",
  "signature-error",
  "unknown",
] as const;
export type ConfirmationOutcome = (typeof CONFIRMATION_OUTCOMES)[number];

/** Exact operator guidance per classification. NONE of these ever says "resend". */
export const CONFIRMATION_GUIDANCE: Record<ConfirmationOutcome, string> = {
  confirmed: "Confirmed at the reported slot. Proceed to balance reconciliation.",
  finalized: "Finalized at the reported slot. Proceed to balance reconciliation.",
  timeout:
    "Do NOT resend — the submission may still land. Re-run reconciliation until the signature confirms, finalizes, or provably drops; resubmitting risks a duplicate transfer.",
  dropped:
    "The blockhash expired without the signature landing — the transaction did not execute. Reconcile balances to confirm no effect; only then is a NEW attempt safe.",
  "rpc-unavailable":
    "The RPC endpoint could not answer. Retry reconciliation when connectivity returns; never resend on a connectivity gap.",
  "signature-error":
    "The transaction landed WITH AN ERROR (the fee was still charged). Reconcile balances and review the error before any new attempt.",
  unknown:
    "The status response was not recognized. Treat the session as unreconciled and review manually before any new attempt.",
};

/** Bounded polling: defaults are deliberately small for post-hoc checks; the hard cap is final. */
export const CONFIRMATION_DEFAULT_MAX_POLLS = 10;
export const CONFIRMATION_HARD_MAX_POLLS = 60;

export interface ConfirmationTrackResult {
  outcome: ConfirmationOutcome;
  signature: string;
  slot: number | null;
  errLabel: string | null;
  polls: number;
  guidance: string;
}

export interface TrackConfirmationInput {
  signature: string;
  rpc: Pick<ReconciliationRpcLike, "getSignatureStatus">;
  maxPolls?: number;
  pollDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Optional drop detection: the submission's blockhash expiry facts, when known. */
  lastValidBlockHeight?: number | null;
  getBlockHeight?: () => Promise<number>;
}

/**
 * Track one ALREADY-SUBMITTED signature with bounded polling and classify the outcome. This
 * function cannot submit anything (the seam has no send method) and never retries a submission —
 * it only watches and reports.
 */
export async function trackConfirmation(input: TrackConfirmationInput): Promise<ConfirmationTrackResult> {
  const sleep = input.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const maxPolls = Math.min(
    Math.max(Math.trunc(input.maxPolls ?? CONFIRMATION_DEFAULT_MAX_POLLS), 1),
    CONFIRMATION_HARD_MAX_POLLS,
  );
  const delay = input.pollDelayMs ?? 2000;
  const result = (outcome: ConfirmationOutcome, slot: number | null, errLabel: string | null, polls: number): ConfirmationTrackResult => ({
    outcome,
    signature: input.signature,
    slot,
    errLabel,
    polls,
    guidance: CONFIRMATION_GUIDANCE[outcome],
  });

  let sawUnrecognized = false;
  for (let i = 1; i <= maxPolls; i += 1) {
    let status: { status: "processed" | "confirmed" | "finalized" | null; slot: number | null; errLabel: string | null };
    try {
      status = await input.rpc.getSignatureStatus(input.signature);
    } catch (err) {
      return result(
        "rpc-unavailable",
        null,
        redactString((err as Error).message ?? "status read failed").slice(0, 300),
        i,
      );
    }
    if (status.errLabel !== null) return result("signature-error", status.slot, status.errLabel, i);
    if (status.status === "finalized") return result("finalized", status.slot, null, i);
    if (status.status === "confirmed") return result("confirmed", status.slot, null, i);
    if (status.status === null) {
      // Drop detection: only when the caller supplied the blockhash expiry facts.
      if (
        typeof input.lastValidBlockHeight === "number" &&
        Number.isFinite(input.lastValidBlockHeight) &&
        input.getBlockHeight
      ) {
        try {
          const height = await input.getBlockHeight();
          if (height > input.lastValidBlockHeight) return result("dropped", null, null, i);
        } catch {
          /* height read failed — keep polling; timeout stays honest */
        }
      }
    } else if (status.status !== "processed") {
      sawUnrecognized = true;
    }
    if (i < maxPolls) await sleep(delay);
  }
  if (sawUnrecognized) {
    return result("unknown", null, "the status response carried an unrecognized confirmation state", maxPolls);
  }
  return result("timeout", null, null, maxPolls);
}

// ---------------------------------------------------------------------------
// The reconciliation report (Slice 1)
// ---------------------------------------------------------------------------

export const EXPECTED_EFFECT_KINDS = ["self-transfer-probe", "none"] as const;
export type ExpectedEffectKind = (typeof EXPECTED_EFFECT_KINDS)[number];

export interface ExpectedEffect {
  kind: ExpectedEffectKind;
  summary: string;
  /** Acceptable fee burn bound (lamports) for a probe; null when not applicable. */
  maxFeeLamports: number | null;
}

/** Acceptable fee bound when none is supplied: covers the 5000-lamport base fee with headroom. */
export const RECONCILIATION_DEFAULT_MAX_FEE_LAMPORTS = 10_000;

export interface ReconciliationFeeFacts {
  estimatedLamports: number | null;
  actualLamports: number | null;
  source: "transaction-meta" | "estimate" | "unavailable";
}

export interface ReconciliationReport {
  schemaVersion: string;
  banner: string;
  mode: ExecutionMode;
  network: string;
  sessionId: string;
  command: string | null;
  signature: string | null;
  confirmation: ConfirmationTrackResult | null;
  pre: BalanceSnapshot | null;
  post: BalanceSnapshot | null;
  delta: BalanceDelta | null;
  fee: ReconciliationFeeFacts;
  expected: ExpectedEffect;
  /** Built ONLY from observed facts; says "unobservable" when data was unavailable. */
  actualSummary: string;
  verdict: ReconciliationVerdict;
  blockedReason: string | null;
  nextSafeAction: string;
  caveats: string[];
  /** Set TRUE by the writer AFTER the redactor ran over the serialized artifact. */
  redactionApplied: boolean;
  createdAt: string;
  neverSends: true;
  phase7LiveTradingReady: false;
}

const RECONCILIATION_CAVEATS: readonly string[] = [
  "Every balance fact is an actual RPC observation or an honest unavailable — nothing is estimated.",
  "Post-hoc balance reads can include unrelated intervening transfers (e.g. faucet airdrops); reconcile promptly after an attempt.",
  "Nothing here arms, weakens, or substitutes for the fourteen-condition mainnet live gate.",
];

const NEXT_SAFE_ACTION: Record<ReconciliationVerdict, string> = {
  reconciled: "Session accounted for. A new devnet execution attempt may proceed.",
  unreconciled:
    "Review the expected-vs-actual mismatch before ANY new execution attempt; re-run execution:session:reconcile after review, or acknowledge the session explicitly with a reason.",
  "pending-confirmation":
    "Re-run execution:session:reconcile until the signature confirms, finalizes, or provably drops. Do NOT start a new execution attempt and do NOT resend.",
  "not-sent": "Nothing was submitted; a new execution attempt is safe.",
  "funding-blocked":
    "Fund the devnet key externally (faucet.solana.com) and rerun; a retry is safe because nothing was submitted.",
  "rpc-unavailable":
    "Retry execution:session:reconcile when the RPC endpoint answers. Do NOT start a new execution attempt while accounting is unobservable.",
  unsupported:
    "This execution shape is not supported by the reconciliation layer yet; review manually before any new attempt.",
  error: "Manual review is required before any new execution attempt.",
};

export interface BuildReconciliationReportInput {
  mode: ExecutionMode;
  network: string;
  sessionId: string;
  command?: string | null;
  signature?: string | null;
  /** True when the attempt ended funding-blocked (nothing was submitted). */
  fundingBlocked?: boolean;
  confirmation?: ConfirmationTrackResult | null;
  pre?: BalanceSnapshot | null;
  post?: BalanceSnapshot | null;
  expected: ExpectedEffect;
  feeEstimatedLamports?: number | null;
  feeActualLamports?: number | null;
  clock?: () => string;
}

/**
 * Build the reconciliation report. PURE apart from the injected clock: the verdict is a
 * deterministic function of the supplied facts, fail-closed at every fork — missing data can
 * only make the verdict LESS permissive, never more.
 */
export function buildReconciliationReport(input: BuildReconciliationReportInput): ReconciliationReport {
  const clock = input.clock ?? ((): string => new Date().toISOString());
  const delta = input.pre && input.post ? computeBalanceDelta(input.pre, input.post) : null;
  const fee: ReconciliationFeeFacts =
    typeof input.feeActualLamports === "number" && Number.isFinite(input.feeActualLamports)
      ? { estimatedLamports: input.feeEstimatedLamports ?? null, actualLamports: input.feeActualLamports, source: "transaction-meta" }
      : typeof input.feeEstimatedLamports === "number" && Number.isFinite(input.feeEstimatedLamports)
        ? { estimatedLamports: input.feeEstimatedLamports, actualLamports: null, source: "estimate" }
        : { estimatedLamports: null, actualLamports: null, source: "unavailable" };

  const actualSummary = ((): string => {
    if (delta === null || delta.solStatus !== "computed") return "balance effect unobservable (pre/post not both observed)";
    const parts = [`SOL delta ${delta.solLamports} lamports`];
    if (delta.token !== null) {
      parts.push(
        delta.token.status === "computed"
          ? `token ${delta.token.mint} raw delta ${delta.token.amountRawDelta}`
          : `token ${delta.token.mint} delta unavailable`,
      );
    }
    return parts.join("; ");
  })();

  const caveats = [...RECONCILIATION_CAVEATS];
  if (input.mode === "mainnet-dry-run") {
    caveats.unshift(
      "mainnet-dry-run NEVER sends: there is no send result to reconcile — this artifact records that honestly; balance reads (when present) are read-only evidence only.",
    );
  }

  let verdict: ReconciliationVerdict;
  let blockedReason: string | null = null;

  const tokenDeltaClean = (d: BalanceDelta): boolean =>
    d.token === null || (d.token.status === "computed" && d.token.amountRawDelta === "0");

  const compareExpected = (d: BalanceDelta): { verdict: ReconciliationVerdict; reason: string | null } => {
    const sol = d.solLamports as number;
    if (input.expected.kind === "self-transfer-probe") {
      const bound = input.expected.maxFeeLamports ?? RECONCILIATION_DEFAULT_MAX_FEE_LAMPORTS;
      if (sol > 0) return { verdict: "unreconciled", reason: `SOL INCREASED by ${sol} lamports — a probe can only burn its fee` };
      if (-sol > bound) return { verdict: "unreconciled", reason: `SOL decreased by ${-sol} lamports, above the ${bound}-lamport fee bound` };
      if (fee.actualLamports !== null && -sol !== fee.actualLamports) {
        return { verdict: "unreconciled", reason: `SOL delta ${sol} does not equal the actual fee -${fee.actualLamports}` };
      }
      if (!tokenDeltaClean(d)) return { verdict: "unreconciled", reason: "an unexpected token balance change was observed" };
      return { verdict: "reconciled", reason: null };
    }
    // kind "none": the expected effect is NO balance change at all.
    if (sol !== 0) return { verdict: "unreconciled", reason: `expected no effect but SOL delta is ${sol} lamports` };
    if (!tokenDeltaClean(d)) return { verdict: "unreconciled", reason: "expected no effect but a token balance change was observed" };
    return { verdict: "reconciled", reason: null };
  };

  if (!EXPECTED_EFFECT_KINDS.includes(input.expected.kind)) {
    verdict = "unsupported";
    blockedReason = "the expected-effect kind is not supported by this reconciliation layer";
  } else if (input.fundingBlocked === true) {
    verdict = "funding-blocked";
    blockedReason = "funding was unavailable — nothing was submitted";
  } else if (typeof input.signature !== "string" || input.signature.length === 0) {
    verdict = "not-sent";
    blockedReason =
      input.mode === "mainnet-dry-run" ? "mainnet-dry-run never sends — no send result exists to reconcile" : null;
  } else if (!input.confirmation) {
    verdict = "pending-confirmation";
    blockedReason = "the signature was submitted but no confirmation result is available yet";
  } else {
    switch (input.confirmation.outcome) {
      case "rpc-unavailable":
        verdict = "rpc-unavailable";
        blockedReason = "the confirmation status could not be read";
        break;
      case "timeout":
        verdict = "pending-confirmation";
        blockedReason = "the signature did not confirm within the bounded polls — submission is not confirmation";
        break;
      case "unknown":
        verdict = "error";
        blockedReason = "the confirmation status response was not recognized — manual review required";
        break;
      case "signature-error":
        verdict = "error";
        blockedReason = `the transaction landed with an error: ${input.confirmation.errLabel ?? "no detail"}`;
        break;
      case "dropped": {
        if (delta === null || delta.solStatus !== "computed") {
          verdict = "rpc-unavailable";
          blockedReason = "the transaction dropped but the no-effect check is unobservable (balances unavailable)";
        } else {
          const dropped = compareExpected({ ...delta });
          // A dropped transaction must have had NO effect — compare against "none" regardless
          // of what the attempt intended.
          const noEffect = delta.solLamports === 0 && tokenDeltaClean(delta);
          verdict = noEffect ? "reconciled" : "unreconciled";
          blockedReason = noEffect
            ? null
            : `the transaction dropped but a balance change was observed (${actualSummary}); ${dropped.reason ?? "review required"}`;
        }
        break;
      }
      case "confirmed":
      case "finalized": {
        if (delta === null || delta.solStatus !== "computed") {
          verdict = "rpc-unavailable";
          blockedReason = "the transaction confirmed but pre/post balances were not both observable";
        } else {
          const compared = compareExpected(delta);
          verdict = compared.verdict;
          blockedReason = compared.reason;
        }
        break;
      }
      default:
        verdict = "error";
        blockedReason = "unrecognized confirmation outcome — manual review required";
    }
  }

  return {
    schemaVersion: EXECUTION_RECONCILIATION_REPORT_SCHEMA_VERSION,
    banner: RECONCILIATION_BANNER,
    mode: input.mode,
    network: input.network,
    sessionId: input.sessionId,
    command: input.command ?? null,
    signature: input.signature ?? null,
    confirmation: input.confirmation ?? null,
    pre: input.pre ?? null,
    post: input.post ?? null,
    delta,
    fee,
    expected: input.expected,
    actualSummary,
    verdict,
    blockedReason,
    nextSafeAction: NEXT_SAFE_ACTION[verdict],
    caveats,
    redactionApplied: false,
    createdAt: clock(),
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}
