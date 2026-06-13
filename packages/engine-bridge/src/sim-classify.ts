/**
 * Run a simulation result `{ errLabel, logs }` through the Rust engine's
 * `sim-classify` hot path and strictly validate the result — including the
 * PARITY WALL that re-runs the real `classifySimulationFailure` and refuses on
 * disagreement. The input travels over bounded stdin (refused oversized BEFORE
 * any process starts).
 */

import { performance } from "node:perf_hooks";
import { buildChildEnv, checkEngineArgs } from "./guard.js";
import { locateEngineInvocation, type EngineInvocationVia } from "./locate.js";
import { createEngineProcessRunner, type EngineProcessRunner } from "./runner.js";
import type { EngineIpcTiming, EngineUnavailableReason } from "./status.js";
import type { EngineRealtimeRefusedReason } from "./realtime.js";
import {
  validateEngineSimClassificationReportV1,
  type EngineSimClassificationReportV1,
} from "./validate-sim-classify.js";

export type EngineSimClassifyBridgeResult =
  | { readonly kind: "ok"; readonly report: EngineSimClassificationReportV1; readonly via: EngineInvocationVia; readonly timing: EngineIpcTiming }
  | { readonly kind: "unavailable"; readonly reason: EngineUnavailableReason; readonly detail: string }
  | { readonly kind: "refused"; readonly reason: EngineRealtimeRefusedReason; readonly detail: string };

export interface ClassifySimThroughEngineOptions {
  readonly cwd: string;
  /** The program error label (or null) and bounded logs to classify. */
  readonly errLabel: string | null;
  readonly logs: readonly string[];
  readonly createdAt?: string;
  readonly runner?: EngineProcessRunner;
  readonly exists?: (path: string) => boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxInputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB
const DEFAULT_MAX_INPUT_BYTES = 65_536; // 64 KiB — 50 bounded log lines fit easily
const DETAIL_CAP = 600;

function cap(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > DETAIL_CAP ? `${trimmed.slice(0, DETAIL_CAP)}…` : trimmed;
}

/** Invoke `sim-classify --json` over stdin and strictly validate (with the parity wall). */
export async function classifySimThroughEngine(opts: ClassifySimThroughEngineOptions): Promise<EngineSimClassifyBridgeResult> {
  const inputJson = JSON.stringify({ errLabel: opts.errLabel, logs: [...opts.logs] });
  const maxInputBytes = opts.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const inputBytes = Buffer.byteLength(inputJson, "utf8");
  if (inputBytes > maxInputBytes) {
    return { kind: "refused", reason: "input-too-large", detail: `the simulation result is ${inputBytes} bytes — beyond the ${maxInputBytes}-byte ceiling; bound it` };
  }

  const subcommandArgs = ["sim-classify", "--json", ...(opts.createdAt !== undefined ? ["--created-at", opts.createdAt] : [])];
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
    stdinData: inputJson,
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

  const validateStart = performance.now();
  const validation = validateEngineSimClassificationReportV1(parsed, { errLabel: opts.errLabel, logs: opts.logs });
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
