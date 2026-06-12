/**
 * The REFUSAL-FIRST send path (Sprint 92) — the only code in the repository that can submit a
 * transaction, and the hardest to reach:
 *
 *   1. The execution mode must be `devnet-execution` or `mainnet-live-armed` — every other
 *      mode (paper, readonly, mainnet-dry-run, mainnet-live-blocked) refuses structurally.
 *   2. `mainnet-live-armed` is re-verified here: the full fourteen-check gate result must be
 *      present with every check satisfied — a stale or partial gate refuses.
 *   3. Every operator safety control must pass for THIS trade in THIS session.
 *   4. The envelope must validate as strictly UNSIGNED, and its network must match both the
 *      signer boundary and the mode.
 *   Only then: refresh the blockhash, sign through the boundary, submit once.
 *
 * Submission is not confirmation — the report says so, and nothing here retries or chases.
 */

import { Connection, VersionedTransaction } from "@solana/web3.js";
import { redactString } from "@soulmaker/security";
import { validateUnsignedTxEnvelope, deserializeUnsignedTransaction, TxPreviewError } from "@soulmaker/txpreview";
import type { ExecutionMode } from "./modes.js";
import type { MainnetLiveGateResult } from "./live-gate.js";
import type { OperatorSafetyControls, TradeContext, SessionState, SafetyViolation } from "./safety-controls.js";
import { evaluateSafetyControls } from "./safety-controls.js";
import type { TransactionSigningBoundary } from "./signer.js";

export const EXECUTION_ATTEMPT_REPORT_SCHEMA_VERSION = "execution.attempt.report.v1";

export const EXECUTION_REFUSAL_CODES = [
  "execution-refused-mode",
  "execution-refused-live-gate-not-armed",
  "execution-refused-safety-controls",
  "execution-refused-envelope-invalid",
  "execution-refused-network-mismatch",
  "execution-refused-signer-missing",
  "execution-refused-rpc-unavailable",
] as const;
export type ExecutionRefusalCode = (typeof EXECUTION_REFUSAL_CODES)[number];

/** The ONLY RPC capabilities the send path accepts. */
export interface SendRpcLike {
  getLatestBlockhash(): Promise<{ blockhash: string }>;
  sendRawTransaction(bytes: Uint8Array, options: { skipPreflight: false }): Promise<string>;
}

export interface SendRpc {
  readonly endpointHost: string;
  readonly rpc: SendRpcLike;
}

/** Production factory: wrap a `Connection` exposing ONLY the two send-path methods. */
export function createSendRpc(rpcUrl: string): SendRpc {
  if (!rpcUrl || rpcUrl.trim().length === 0) {
    throw new Error("createSendRpc requires a non-empty rpcUrl");
  }
  const connection = new Connection(rpcUrl, "confirmed");
  let endpointHost: string;
  try {
    endpointHost = new URL(rpcUrl).host;
  } catch {
    endpointHost = redactString(rpcUrl);
  }
  return Object.freeze({
    endpointHost,
    rpc: Object.freeze({
      getLatestBlockhash: async () => {
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        return { blockhash };
      },
      sendRawTransaction: (bytes: Uint8Array, options: { skipPreflight: false }) =>
        connection.sendRawTransaction(bytes, options),
    }),
  });
}

export interface ExecutionAttemptInput {
  mode: ExecutionMode;
  /** REQUIRED for mainnet-live-armed; ignored otherwise. */
  mainnetLiveGate?: MainnetLiveGateResult | null;
  signer?: TransactionSigningBoundary | null;
  envelopeValue: unknown;
  rpc: SendRpcLike;
  endpointHost: string;
  controls: OperatorSafetyControls;
  trade: TradeContext;
  session: SessionState;
  nowMs: number;
  clock?: () => string;
}

export interface ExecutionAttemptReport {
  schemaVersion: string;
  outcome: "refused" | "submitted";
  mode: ExecutionMode;
  network: string | null;
  endpointHost: string;
  attemptedAt: string;
  refusalCode: ExecutionRefusalCode | null;
  refusalDetail: string | null;
  safetyViolations: SafetyViolation[];
  /** The transaction signature when submitted; null otherwise. Public chain data. */
  signature: string | null;
  signerPublicKey: string | null;
  caveats: string[];
  phase7LiveTradingReady: false;
}

const ATTEMPT_CAVEATS: readonly string[] = [
  "Submission is NOT confirmation — verify the signature on an explorer / via RPC before treating it as landed.",
  "This attempt path never retries, never chases, and never loosens a safety control.",
];

function refusedReport(
  input: Pick<ExecutionAttemptInput, "mode" | "endpointHost">,
  attemptedAt: string,
  code: ExecutionRefusalCode,
  detail: string,
  safetyViolations: SafetyViolation[] = [],
): ExecutionAttemptReport {
  return {
    schemaVersion: EXECUTION_ATTEMPT_REPORT_SCHEMA_VERSION,
    outcome: "refused",
    mode: input.mode,
    network: null,
    endpointHost: input.endpointHost,
    attemptedAt,
    refusalCode: code,
    refusalDetail: redactString(detail).slice(0, 400),
    safetyViolations,
    signature: null,
    signerPublicKey: null,
    caveats: [...ATTEMPT_CAVEATS],
    phase7LiveTradingReady: false,
  };
}

/** Attempt one gated execution. NEVER throws — every failure is an honest refusal report. */
export async function attemptExecution(input: ExecutionAttemptInput): Promise<ExecutionAttemptReport> {
  const clock = input.clock ?? ((): string => new Date().toISOString());
  const attemptedAt = clock();

  // 1) Mode wall.
  if (input.mode !== "devnet-execution" && input.mode !== "mainnet-live-armed") {
    return refusedReport(input, attemptedAt, "execution-refused-mode", `execution mode "${input.mode}" can never send — only devnet-execution or mainnet-live-armed`);
  }

  // 2) Mainnet re-verification: the FULL armed gate, re-checked here, condition by condition.
  if (input.mode === "mainnet-live-armed") {
    const gate = input.mainnetLiveGate;
    if (!gate || gate.armed !== true || gate.checks.length < 14 || gate.checks.some((c) => !c.satisfied)) {
      return refusedReport(input, attemptedAt, "execution-refused-live-gate-not-armed", "the fourteen-condition mainnet live gate is not fully armed — blocked");
    }
  }

  // 3) Safety controls for THIS trade in THIS session.
  const safety = evaluateSafetyControls(input.controls, input.trade, input.session, input.nowMs);
  if (!safety.allowed) {
    return refusedReport(input, attemptedAt, "execution-refused-safety-controls", `${safety.violations.length} safety control violation(s)`, safety.violations);
  }

  // 4) Envelope: strictly UNSIGNED, networks consistent with the mode and the signer.
  let envelopeNetwork: string;
  let tx: VersionedTransaction;
  try {
    const envelope = validateUnsignedTxEnvelope(input.envelopeValue);
    envelopeNetwork = envelope.network;
    tx = deserializeUnsignedTransaction(envelope);
  } catch (err) {
    const detail = err instanceof TxPreviewError ? err.message : "envelope validation failed";
    return refusedReport(input, attemptedAt, "execution-refused-envelope-invalid", detail);
  }
  const expectedNetwork = input.mode === "devnet-execution" ? "devnet" : "mainnet-beta";
  if (envelopeNetwork !== expectedNetwork) {
    return refusedReport(input, attemptedAt, "execution-refused-network-mismatch", `mode ${input.mode} requires a ${expectedNetwork} envelope; got ${envelopeNetwork}`);
  }
  if (!input.signer) {
    return refusedReport(input, attemptedAt, "execution-refused-signer-missing", "no signer boundary was provided");
  }
  if (input.signer.network !== expectedNetwork) {
    return refusedReport(input, attemptedAt, "execution-refused-network-mismatch", `the signer boundary is for ${input.signer.network}; the mode requires ${expectedNetwork}`);
  }

  // 5) Only now: real blockhash, sign through the boundary, submit ONCE.
  let signature: string;
  try {
    const { blockhash } = await input.rpc.getLatestBlockhash();
    tx.message.recentBlockhash = blockhash;
    input.signer.signTransactionInPlace(tx);
    signature = await input.rpc.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  } catch (err) {
    return refusedReport(input, attemptedAt, "execution-refused-rpc-unavailable", `submission failed: ${(err as Error).message ?? "unknown"}`);
  }

  return {
    schemaVersion: EXECUTION_ATTEMPT_REPORT_SCHEMA_VERSION,
    outcome: "submitted",
    mode: input.mode,
    network: envelopeNetwork,
    endpointHost: input.endpointHost,
    attemptedAt,
    refusalCode: null,
    refusalDetail: null,
    safetyViolations: [],
    signature,
    signerPublicKey: input.signer.publicKeyBase58,
    caveats: [...ATTEMPT_CAVEATS],
    phase7LiveTradingReady: false,
  };
}
