/**
 * Run a replay events document through the Rust engine's `realtime-normalize`
 * hot path and strictly validate the result. The document travels over the
 * child's stdin (BOUNDED on both sides — the bridge refuses oversized input
 * before any process starts; the engine refuses beyond its own 2 MiB ceiling),
 * so no path, label, or event content ever rides in an argument. The result is
 * the same closed union the status bridge speaks: `ok` (validated artifact),
 * `unavailable` (no Rust engine — honest, never a project failure), or
 * `refused` (the engine answered but the answer is not trustworthy).
 */

import { performance } from "node:perf_hooks";
import { buildChildEnv, checkEngineArgs } from "./guard.js";
import { locateEngineInvocation, type EngineInvocationVia } from "./locate.js";
import { createEngineProcessRunner, type EngineProcessRunner } from "./runner.js";
import type { EngineIpcTiming, EngineUnavailableReason, EngineRefusedReason } from "./status.js";
import {
  validateEngineRealtimeObservationsReportV1,
  type EngineRealtimeObservationsReportV1,
} from "./validate-realtime.js";

export type EngineRealtimeRefusedReason = EngineRefusedReason | "input-too-large";

export type EngineRealtimeBridgeResult =
  | {
      readonly kind: "ok";
      readonly report: EngineRealtimeObservationsReportV1;
      readonly via: EngineInvocationVia;
      readonly timing: EngineIpcTiming;
    }
  | { readonly kind: "unavailable"; readonly reason: EngineUnavailableReason; readonly detail: string }
  | { readonly kind: "refused"; readonly reason: EngineRealtimeRefusedReason; readonly detail: string };

export interface NormalizeReplayThroughEngineOptions {
  /** Workspace root (where target/ and Cargo.toml live). */
  readonly cwd: string;
  /** The replay events JSON document, verbatim (the engine parses it). */
  readonly replayEventsJson: string;
  /** Orchestrator-supplied timestamp the engine echoes into the artifact. */
  readonly createdAt?: string;
  /** Injected in tests so the suite never spawns a process. */
  readonly runner?: EngineProcessRunner;
  /** Injected in tests to control binary discovery. */
  readonly exists?: (path: string) => boolean;
  /** Injected in tests; defaults to process.env, filtered by the allowlist. */
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxInputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4_194_304; // 4 MiB — 500 observations with caveats fit well under this
const DEFAULT_MAX_INPUT_BYTES = 2_097_152; // 2 MiB — mirrors the engine's own stdin ceiling
const DETAIL_CAP = 600;

function cap(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > DETAIL_CAP ? `${trimmed.slice(0, DETAIL_CAP)}…` : trimmed;
}

/** Invoke `realtime-normalize --json` over stdin and strictly validate the artifact. */
export async function normalizeReplayThroughEngine(
  opts: NormalizeReplayThroughEngineOptions,
): Promise<EngineRealtimeBridgeResult> {
  const maxInputBytes = opts.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const inputBytes = Buffer.byteLength(opts.replayEventsJson, "utf8");
  if (inputBytes > maxInputBytes) {
    return {
      kind: "refused",
      reason: "input-too-large",
      detail: `the replay document is ${inputBytes} bytes — beyond the ${maxInputBytes}-byte ceiling; bound it`,
    };
  }

  const subcommandArgs = [
    "realtime-normalize",
    "--json",
    ...(opts.createdAt !== undefined ? ["--created-at", opts.createdAt] : []),
  ];
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
    stdinData: opts.replayEventsJson,
  });
  const spawnMs = performance.now() - spawnStart;

  if (!result.started) {
    return {
      kind: "unavailable",
      reason: "rust-engine-missing",
      detail:
        invocation.via === "cargo-run"
          ? `no prebuilt engine binary under target/ and cargo could not start (${result.startError ?? "unknown"}); install Rust via https://rustup.rs and run pnpm rust:build — the TypeScript replay path is fully functional without it`
          : `the engine binary at ${invocation.command} could not start (${result.startError ?? "unknown"})`,
    };
  }
  if (result.timedOut) {
    return {
      kind: "refused",
      reason: "engine-timeout",
      detail: `the engine did not finish within ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
    };
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    return {
      kind: "refused",
      reason: "output-too-large",
      detail: `engine output exceeded ${opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES} bytes and was refused`,
    };
  }
  if (result.exitCode !== 0) {
    return {
      kind: "refused",
      reason: "engine-error",
      detail: cap(`engine exited ${result.exitCode ?? "without a code"}: ${result.stderr || "(no stderr)"}`),
    };
  }

  const parseStart = performance.now();
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { kind: "refused", reason: "invalid-json", detail: cap(`stdout is not valid JSON: ${result.stdout || "(empty)"}`) };
  }
  const parseMs = performance.now() - parseStart;

  const validateStart = performance.now();
  const validation = validateEngineRealtimeObservationsReportV1(parsed);
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
