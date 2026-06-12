/**
 * Fetch + validate the engine status artifact over the JSON IPC contract.
 * The result is a closed discriminated union: `ok` (validated artifact),
 * `unavailable` (no Rust engine on this machine — honest, never a project
 * failure), or `refused` (the engine answered but the answer is not
 * trustworthy: timeout, oversized output, bad JSON, schema mismatch).
 */

import { performance } from "node:perf_hooks";
import { buildChildEnv, checkEngineArgs } from "./guard.js";
import { locateEngineInvocation, type EngineInvocationVia } from "./locate.js";
import { createEngineProcessRunner, type EngineProcessRunner } from "./runner.js";
import { validateEngineStatusReportV1, type EngineStatusReportV1 } from "./validate.js";

/** IPC overhead measurements — process + parse + validate ONLY. This is never a trading-latency claim. */
export interface EngineIpcTiming {
  readonly spawnMs: number;
  readonly parseMs: number;
  readonly validateMs: number;
}

export type EngineUnavailableReason = "rust-engine-missing";

export type EngineRefusedReason =
  | "engine-timeout"
  | "engine-error"
  | "output-too-large"
  | "invalid-json"
  | "schema-mismatch"
  | "unsafe-args";

export type EngineStatusBridgeResult =
  | { readonly kind: "ok"; readonly report: EngineStatusReportV1; readonly via: EngineInvocationVia; readonly timing: EngineIpcTiming }
  | { readonly kind: "unavailable"; readonly reason: EngineUnavailableReason; readonly detail: string }
  | { readonly kind: "refused"; readonly reason: EngineRefusedReason; readonly detail: string };

export interface FetchEngineStatusOptions {
  /** Workspace root (where target/ and Cargo.toml live). */
  readonly cwd: string;
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
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB — the status artifact is ~2 KB
const DETAIL_CAP = 600;

function cap(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > DETAIL_CAP ? `${trimmed.slice(0, DETAIL_CAP)}…` : trimmed;
}

/** Invoke the engine's `status --json` and strictly validate the artifact. */
export async function fetchEngineStatus(opts: FetchEngineStatusOptions): Promise<EngineStatusBridgeResult> {
  const subcommandArgs = [
    "status",
    "--json",
    ...(opts.createdAt !== undefined ? ["--created-at", opts.createdAt] : []),
  ];
  // baseArgs below are bridge-internal constants (cargo selector); the closed
  // vocabulary applies to everything variable — the subcommand argument list.
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
  });
  const spawnMs = performance.now() - spawnStart;

  if (!result.started) {
    return {
      kind: "unavailable",
      reason: "rust-engine-missing",
      detail:
        invocation.via === "cargo-run"
          ? `no prebuilt engine binary under target/ and cargo could not start (${result.startError ?? "unknown"}); install Rust via https://rustup.rs and run pnpm rust:build — the TypeScript system is fully functional without it`
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
  const validation = validateEngineStatusReportV1(parsed);
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
