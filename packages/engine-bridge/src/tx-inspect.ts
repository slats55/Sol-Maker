/**
 * Run a strictly-UNSIGNED `txpreview.envelope.v1` through the Rust engine's
 * `tx-inspect` hot path and strictly validate the result — including the
 * PARITY WALL that re-derives the shape facts with the real `@solana/web3.js`
 * decoder and refuses unless they match. The envelope travels over bounded
 * stdin (refused oversized BEFORE any process starts). Returns the same closed
 * union the other bridge paths speak.
 */

import { performance } from "node:perf_hooks";
import { buildChildEnv, checkEngineArgs } from "./guard.js";
import { locateEngineInvocation, type EngineInvocationVia } from "./locate.js";
import { createEngineProcessRunner, type EngineProcessRunner } from "./runner.js";
import type { EngineIpcTiming, EngineUnavailableReason } from "./status.js";
import type { EngineRealtimeRefusedReason } from "./realtime.js";
import { validateEngineTxInspectReportV1, type EngineTxInspectReportV1 } from "./validate-tx-inspect.js";

export type EngineTxInspectBridgeResult =
  | { readonly kind: "ok"; readonly report: EngineTxInspectReportV1; readonly via: EngineInvocationVia; readonly timing: EngineIpcTiming }
  | { readonly kind: "unavailable"; readonly reason: EngineUnavailableReason; readonly detail: string }
  | { readonly kind: "refused"; readonly reason: EngineRealtimeRefusedReason; readonly detail: string };

export interface InspectTxThroughEngineOptions {
  readonly cwd: string;
  /** The txpreview.envelope.v1 JSON document, verbatim (the engine parses it). */
  readonly envelopeJson: string;
  readonly createdAt?: string;
  readonly runner?: EngineProcessRunner;
  readonly exists?: (path: string) => boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxInputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB — a shape report is tiny
const DEFAULT_MAX_INPUT_BYTES = 65_536; // 64 KiB — an envelope is ~6 KB at most
const DETAIL_CAP = 600;

function cap(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > DETAIL_CAP ? `${trimmed.slice(0, DETAIL_CAP)}…` : trimmed;
}

/** Invoke `tx-inspect --json` over stdin and strictly validate (with the parity wall). */
export async function inspectTxThroughEngine(opts: InspectTxThroughEngineOptions): Promise<EngineTxInspectBridgeResult> {
  const maxInputBytes = opts.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const inputBytes = Buffer.byteLength(opts.envelopeJson, "utf8");
  if (inputBytes > maxInputBytes) {
    return { kind: "refused", reason: "input-too-large", detail: `the envelope is ${inputBytes} bytes — beyond the ${maxInputBytes}-byte ceiling; bound it` };
  }

  const subcommandArgs = ["tx-inspect", "--json", ...(opts.createdAt !== undefined ? ["--created-at", opts.createdAt] : [])];
  const argProblem = checkEngineArgs(subcommandArgs);
  if (argProblem !== null) {
    return { kind: "refused", reason: "unsafe-args", detail: argProblem };
  }

  const invocation = locateEngineInvocation(opts.cwd, opts.exists);
  const runner = opts.runner ?? createEngineProcessRunner();

  const spawnStart = performance.now();
  const result = await runner.run(invocation.command, [...invocation.baseArgs, ...subcommandArgs], {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    cwd: opts.cwd,
    env: buildChildEnv(opts.env ?? process.env),
    stdinData: opts.envelopeJson,
  });
  const spawnMs = performance.now() - spawnStart;

  if (!result.started) {
    return {
      kind: "unavailable",
      reason: "rust-engine-missing",
      detail:
        invocation.via === "cargo-run"
          ? `no prebuilt engine binary under target/ and cargo could not start (${result.startError ?? "unknown"}); install Rust via https://rustup.rs and run pnpm rust:build`
          : `the engine binary at ${invocation.command} could not start (${result.startError ?? "unknown"})`,
    };
  }
  if (result.timedOut) {
    return { kind: "refused", reason: "engine-timeout", detail: `the engine did not finish within ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` };
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    return { kind: "refused", reason: "output-too-large", detail: `engine output exceeded ${opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES} bytes and was refused` };
  }
  if (result.exitCode !== 0) {
    return { kind: "refused", reason: "engine-error", detail: cap(`engine exited ${result.exitCode ?? "without a code"}: ${result.stderr || "(no stderr)"}`) };
  }

  const parseStart = performance.now();
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { kind: "refused", reason: "invalid-json", detail: cap(`stdout is not valid JSON: ${result.stdout || "(empty)"}`) };
  }
  const parseMs = performance.now() - parseStart;

  // The parity wall needs the original envelope; parse the same bytes we piped.
  let envelopeValue: unknown;
  try {
    envelopeValue = JSON.parse(opts.envelopeJson);
  } catch {
    envelopeValue = undefined;
  }

  const validateStart = performance.now();
  const validation = validateEngineTxInspectReportV1(parsed, envelopeValue);
  const validateMs = performance.now() - validateStart;
  if (!validation.ok) {
    return { kind: "refused", reason: "schema-mismatch", detail: cap(validation.problems.join("; ")) };
  }

  return {
    kind: "ok",
    report: validation.report,
    via: invocation.via,
    timing: {
      spawnMs: Math.round(spawnMs * 100) / 100,
      parseMs: Math.round(parseMs * 100) / 100,
      validateMs: Math.round(validateMs * 100) / 100,
    },
  };
}
