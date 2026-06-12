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
): Omit<TxSimulationReport, "outcome" | "errLabel" | "logs" | "unitsConsumed" | "slot"> {
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
      logs,
      unitsConsumed,
      slot,
    };
  }
  return {
    ...baseReport(preview.endpointHost, envelope, simulatedAt),
    outcome: "simulated-failed",
    errLabel: redactString(JSON.stringify(value.err)).slice(0, 300),
    logs,
    unitsConsumed,
    slot,
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
  if (report.logs.length > 0) {
    lines.push("", `logs (${report.logs.length}, bounded):`);
    for (const log of report.logs.slice(0, 10)) lines.push(`  ${log}`);
    if (report.logs.length > 10) lines.push(`  … ${report.logs.length - 10} more (see --json)`);
  }
  lines.push("");
  for (const caveat of report.caveats) lines.push(`CAVEAT: ${caveat}`);
  return redactString(lines.join("\n"));
}
