/**
 * The real `simulateTransaction` preview (Sprint 92) — the engine
 * docs/PHASE6_DRY_RUN_BOUNDARY.md designed.
 *
 * Simulates a strictly-validated UNSIGNED envelope with `sigVerify: false` and
 * `replaceRecentBlockhash: true` — which is why no signer, key, or seed phrase ever needs to
 * exist anywhere near this code. The RPC seam exposes EXACTLY one method (`simulateTransaction`);
 * there is no send method to misuse, and the production factory wraps a read connection without
 * ever exposing it.
 *
 * Outcomes are CLOSED: `simulated-ok`, `simulated-failed`, `unavailable`, `refused`. A
 * successful simulation is evidence that the transaction WOULD have executed against a recent
 * snapshot of chain state — it is NEVER live-trading readiness, and the report says so.
 */

import { Connection } from "@solana/web3.js";
import type { RpcResponseAndContext, SimulatedTransactionResponse, VersionedTransaction } from "@solana/web3.js";
import { redactString } from "@soulmaker/security";
import {
  deserializeUnsignedTransaction,
  validateUnsignedTxEnvelope,
  TxPreviewError,
  type UnsignedTxEnvelope,
} from "./envelope.js";

export const TX_SIMULATION_REPORT_SCHEMA_VERSION = "txpreview.simulation.report.v1";

export const TX_SIMULATION_REPORT_BANNER =
  "UNSIGNED TRANSACTION SIMULATION REPORT — the transaction was simulated against recent chain state with signature verification DISABLED; nothing was signed, nothing was sent, and a successful simulation is NOT live-trading readiness.";

export const TX_SIMULATION_OUTCOMES = ["simulated-ok", "simulated-failed", "unavailable", "refused"] as const;
export type TxSimulationOutcome = (typeof TX_SIMULATION_OUTCOMES)[number];

/**
 * S95: the CLOSED failure-classification set. Every simulation report carries exactly one —
 * derived DETERMINISTICALLY from the outcome plus the program error/logs, never guessed:
 *
 *   - `none`                    — simulated-ok.
 *   - `slippage-or-route-error` — the route's slippage tolerance tripped (Jupiter custom 0x1771).
 *   - `compute-exceeded`        — the transaction ran out of compute units.
 *   - `blockhash-error`         — blockhash problems (rare here: the preview replaces it).
 *   - `account-error`           — missing/invalid accounts or insufficient funds for the attempt.
 *   - `program-error`           — an instruction failed for another program-level reason.
 *   - `unclassified-error`      — failed, but the error matches no known pattern (still honest).
 *   - `rpc-unavailable`         — the simulation RPC could not be reached; nothing was evaluated.
 *   - `envelope-refused`        — the input never simulated (failed strict envelope validation).
 */
export const TX_SIMULATION_CLASSIFICATIONS = [
  "none",
  "slippage-or-route-error",
  "compute-exceeded",
  "blockhash-error",
  "account-error",
  "program-error",
  "unclassified-error",
  "rpc-unavailable",
  "envelope-refused",
] as const;
export type TxSimulationClassification = (typeof TX_SIMULATION_CLASSIFICATIONS)[number];

/** Operator guidance per classification: what it means + the exact next safe action. */
export const TX_SIMULATION_CLASSIFICATION_GUIDANCE: Readonly<
  Record<TxSimulationClassification, { message: string; nextAction: string }>
> = Object.freeze({
  none: {
    message: "The transaction simulated successfully against recent chain state.",
    nextAction: "Review the report. simulated-ok is evidence for review — never execution, never live-trading readiness.",
  },
  "slippage-or-route-error": {
    message: "The swap's slippage tolerance tripped during simulation — the route's price moved past your tolerance.",
    nextAction: "Re-quote and rebuild (prices moved). Never raise slippage to force a thin route through; a tripping tolerance is the protection working.",
  },
  "compute-exceeded": {
    message: "The transaction exceeded its compute budget during simulation.",
    nextAction: "Rebuild from a fresh quote (routes change shape). A persistently compute-heavy route is not snipe material.",
  },
  "blockhash-error": {
    message: "A blockhash problem surfaced even though the preview replaces the blockhash — the transaction's lifetime material is suspect.",
    nextAction: "Rebuild the transaction from scratch. Do not retry the same envelope.",
  },
  "account-error": {
    message: "An account the transaction needs is missing, invalid, or underfunded (e.g. the fee payer has no balance at simulation state).",
    nextAction: "Check the wallet's balance and the token accounts involved, then rebuild. An account error at simulation time would also fail at execution time.",
  },
  "program-error": {
    message: "An instruction failed at the program level for a reason other than slippage/compute/accounts.",
    nextAction: "Read the bounded logs in the report. Rebuild from a fresh quote; if the same program fails repeatedly, treat the route as untradeable.",
  },
  "unclassified-error": {
    message: "The simulation failed but the error matches no known pattern.",
    nextAction: "Read errLabel and the logs verbatim. Do not proceed to any execution path on an unclassified failure.",
  },
  "rpc-unavailable": {
    message: "The simulation RPC endpoint could not be reached — nothing was evaluated.",
    nextAction: "Check connectivity / --rpc-url and retry. Simulation evidence is required before anything downstream; never skip it.",
  },
  "envelope-refused": {
    message: "The input failed strict envelope validation and was never simulated (malformed, unknown fields, or carrying a signature).",
    nextAction: "Rebuild the envelope with execution:build. A signed or malformed envelope is refused at every boundary by design.",
  },
});

/**
 * Classify a failed simulation deterministically from the program error label and logs. Pattern
 * order is fixed (most specific first); anything unmatched is `unclassified-error` — honest over
 * clever. Exported for tests.
 */
export function classifySimulationFailure(errLabel: string | null, logs: readonly string[]): TxSimulationClassification {
  const haystack = `${errLabel ?? ""}\n${logs.join("\n")}`.toLowerCase();
  if (/slippage|0x1771/.test(haystack)) return "slippage-or-route-error";
  if (/computebudgetexceeded|compute budget exceeded|exceeded cus meter|max compute units|consumed \d+ of \d+ compute units.*failed/.test(haystack)) {
    return "compute-exceeded";
  }
  if (/blockhashnotfound|blockhash not found|invalid blockhash/.test(haystack)) return "blockhash-error";
  if (/accountnotfound|account not found|accountinuse|accountloadedtwice|invalidaccount|insufficientfundsforfee|insufficient funds|missing account|could not find account|incorrect program id/.test(haystack)) {
    return "account-error";
  }
  if (/instructionerror|custom program error|program failed|invalidinstructiondata|programfailedtocomplete/.test(haystack)) return "program-error";
  return "unclassified-error";
}

export const TX_SIMULATION_CAVEATS: readonly string[] = [
  "Simulation ran with sigVerify:false over an UNSIGNED transaction — no signer or key exists at this boundary.",
  "replaceRecentBlockhash:true was used — the simulated blockhash is NOT the one a real send would carry.",
  "Chain state moves every slot: a simulation that succeeded now can fail at execution time, and vice versa.",
  "simulated-ok is evidence for review — never execution, never live-trading readiness, never a profit claim.",
];

/**
 * The ONLY RPC capability this module accepts. A real `Connection` satisfies it; the production
 * factory below wraps one without exposing anything else. There is deliberately no send method.
 */
export interface TxSimulateRpcLike {
  simulateTransaction(
    transaction: VersionedTransaction,
    config: { sigVerify: false; replaceRecentBlockhash: true },
  ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>>;
}

export interface TxPreviewRpc {
  readonly endpointHost: string;
  readonly rpc: TxSimulateRpcLike;
}

/** Host only — strips path and any `?api-key=` query so it is safe to display. */
function endpointHostOf(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return redactString(rpcUrl);
  }
}

/** Production factory: wrap a `Connection` exposing ONLY simulateTransaction. */
export function createTxPreviewRpc(rpcUrl: string): TxPreviewRpc {
  if (!rpcUrl || rpcUrl.trim().length === 0) {
    throw new TxPreviewError("createTxPreviewRpc requires a non-empty rpcUrl");
  }
  const connection = new Connection(rpcUrl, "confirmed");
  return Object.freeze({
    endpointHost: endpointHostOf(rpcUrl),
    rpc: Object.freeze({
      simulateTransaction: (tx: VersionedTransaction, config: { sigVerify: false; replaceRecentBlockhash: true }) =>
        connection.simulateTransaction(tx, config),
    }),
  });
}

export interface TxSimulationReport {
  schemaVersion: string;
  banner: string;
  outcome: TxSimulationOutcome;
  network: string;
  endpointHost: string;
  builderId: string;
  feePayerPublicKey: string;
  candidateMint: string | null;
  /** REAL ISO timestamp of the attempt (injected clock). */
  simulatedAt: string;
  /** Stringified program error when simulated-failed; refusal/transport detail otherwise. */
  errLabel: string | null;
  /** S95: deterministic failure classification (closed set; `none` for simulated-ok). */
  classification: TxSimulationClassification;
  /** S95: operator guidance for the classification — plain message + exact next safe action. */
  classificationMessage: string;
  classificationNextAction: string;
  /** Bounded, redacted program logs (max 50 lines, 300 chars each). */
  logs: string[];
  unitsConsumed: number | null;
  slot: number | null;
  sigVerifyDisabled: true;
  replaceRecentBlockhash: true;
  neverSigns: true;
  neverSends: true;
  phase7LiveTradingReady: false;
  caveats: string[];
  routeCaveats: string[];
}

export interface SimulateUnsignedEnvelopeOptions {
  clock?: () => string;
}

function baseReport(
  endpointHost: string,
  envelope: Pick<UnsignedTxEnvelope, "network" | "builderId" | "feePayerPublicKey" | "candidateMint" | "routeCaveats">,
  simulatedAt: string,
): Omit<TxSimulationReport, "outcome" | "errLabel" | "logs" | "unitsConsumed" | "slot" | "classification" | "classificationMessage" | "classificationNextAction"> {
  return {
    schemaVersion: TX_SIMULATION_REPORT_SCHEMA_VERSION,
    banner: TX_SIMULATION_REPORT_BANNER,
    network: envelope.network,
    endpointHost,
    builderId: envelope.builderId,
    feePayerPublicKey: envelope.feePayerPublicKey,
    candidateMint: envelope.candidateMint,
    simulatedAt,
    sigVerifyDisabled: true,
    replaceRecentBlockhash: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    caveats: [...TX_SIMULATION_CAVEATS],
    routeCaveats: [...envelope.routeCaveats],
  };
}

/**
 * Validate + simulate one unsigned envelope. NEVER throws on envelope or transport problems —
 * they map onto `refused` / `unavailable`. Throws only on caller programming errors (a broken
 * rpc seam).
 */
export async function simulateUnsignedEnvelope(
  preview: TxPreviewRpc,
  envelopeValue: unknown,
  options: SimulateUnsignedEnvelopeOptions = {},
): Promise<TxSimulationReport> {
  const clock = options.clock ?? ((): string => new Date().toISOString());
  const simulatedAt = clock();

  let envelope: UnsignedTxEnvelope;
  let tx: VersionedTransaction;
  try {
    envelope = validateUnsignedTxEnvelope(envelopeValue);
    tx = deserializeUnsignedTransaction(envelope);
  } catch (err) {
    const detail = err instanceof TxPreviewError ? err.message : "envelope validation failed";
    return {
      ...baseReport(preview.endpointHost, {
        network: "devnet",
        builderId: "unknown",
        feePayerPublicKey: "unknown",
        candidateMint: null,
        routeCaveats: [],
      }, simulatedAt),
      outcome: "refused",
      errLabel: redactString(detail).slice(0, 300),
      ...classificationFields("envelope-refused"),
      logs: [],
      unitsConsumed: null,
      slot: null,
    };
  }

  let response: RpcResponseAndContext<SimulatedTransactionResponse>;
  try {
    response = await preview.rpc.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  } catch (err) {
    return {
      ...baseReport(preview.endpointHost, envelope, simulatedAt),
      outcome: "unavailable",
      errLabel: redactString(`simulation RPC unreachable: ${(err as Error).message ?? "unknown"}`).slice(0, 300),
      ...classificationFields("rpc-unavailable"),
      logs: [],
      unitsConsumed: null,
      slot: null,
    };
  }

  const value = response.value;
  const logs = (value.logs ?? []).slice(0, 50).map((l) => redactString(String(l)).slice(0, 300));
  const unitsConsumed = typeof value.unitsConsumed === "number" ? value.unitsConsumed : null;
  const slot = typeof response.context?.slot === "number" ? response.context.slot : null;

  if (value.err === null || value.err === undefined) {
    return {
      ...baseReport(preview.endpointHost, envelope, simulatedAt),
      outcome: "simulated-ok",
      errLabel: null,
      ...classificationFields("none"),
      logs,
      unitsConsumed,
      slot,
    };
  }
  const errLabel = redactString(JSON.stringify(value.err)).slice(0, 300);
  return {
    ...baseReport(preview.endpointHost, envelope, simulatedAt),
    outcome: "simulated-failed",
    errLabel,
    ...classificationFields(classifySimulationFailure(errLabel, logs)),
    logs,
    unitsConsumed,
    slot,
  };
}

/** The three classification fields for one classification value (S95). */
function classificationFields(
  classification: TxSimulationClassification,
): Pick<TxSimulationReport, "classification" | "classificationMessage" | "classificationNextAction"> {
  const guidance = TX_SIMULATION_CLASSIFICATION_GUIDANCE[classification];
  return {
    classification,
    classificationMessage: guidance.message,
    classificationNextAction: guidance.nextAction,
  };
}

/** Human-readable, redacted text summary of a simulation report. */
export function formatTxSimulationReport(report: TxSimulationReport): string {
  const lines: string[] = [];
  lines.push(report.banner);
  lines.push("");
  lines.push(`outcome:     ${report.outcome}`);
  lines.push(`network:     ${report.network} (${report.endpointHost})`);
  lines.push(`builder:     ${report.builderId}`);
  lines.push(`fee payer:   ${report.feePayerPublicKey} (public key)`);
  lines.push(`simulated:   ${report.simulatedAt}`);
  if (report.slot !== null) lines.push(`slot:        ${report.slot}`);
  if (report.unitsConsumed !== null) lines.push(`compute:     ${report.unitsConsumed} units`);
  if (report.errLabel !== null) lines.push(`error:       ${report.errLabel}`);
  if (report.classification !== "none") {
    lines.push(`class:       ${report.classification} — ${report.classificationMessage}`);
    lines.push(`next:        ${report.classificationNextAction}`);
  }
  if (report.logs.length > 0) {
    lines.push("", `logs (${report.logs.length}, bounded):`);
    for (const log of report.logs.slice(0, 10)) lines.push(`  ${log}`);
    if (report.logs.length > 10) lines.push(`  … ${report.logs.length - 10} more (see --json)`);
  }
  lines.push("");
  for (const caveat of report.caveats) lines.push(`CAVEAT: ${caveat}`);
  return redactString(lines.join("\n"));
}
