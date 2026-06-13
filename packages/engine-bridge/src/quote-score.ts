/**
 * Run a TypeScript-produced `routequote.fetch.report.v1` through the Rust
 * engine's `quote-score` hot path and strictly validate the result. The
 * document travels over bounded stdin (refused oversized BEFORE any process
 * starts); the scoring instant and the explicit age cap travel as closed-
 * vocabulary arguments. The result is the same closed union the other bridge
 * paths speak: `ok` (validated artifact), `unavailable` (no Rust engine —
 * honest, never a project failure), or `refused`.
 */

import { performance } from "node:perf_hooks";
import { buildChildEnv, checkEngineArgs } from "./guard.js";
import { locateEngineInvocation, type EngineInvocationVia } from "./locate.js";
import { createEngineProcessRunner, type EngineProcessRunner } from "./runner.js";
import type { EngineIpcTiming, EngineUnavailableReason } from "./status.js";
import type { EngineRealtimeRefusedReason } from "./realtime.js";
import {
  validateEngineQuoteScoreReportV1,
  type EngineQuoteScoreReportV1,
} from "./validate-quote-score.js";

export type EngineQuoteScoreBridgeResult =
  | {
      readonly kind: "ok";
      readonly report: EngineQuoteScoreReportV1;
      readonly via: EngineInvocationVia;
      readonly timing: EngineIpcTiming;
    }
  | { readonly kind: "unavailable"; readonly reason: EngineUnavailableReason; readonly detail: string }
  | { readonly kind: "refused"; readonly reason: EngineRealtimeRefusedReason; readonly detail: string };

export interface ScoreQuotesThroughEngineOptions {
  /** Workspace root (where target/ and Cargo.toml live). */
  readonly cwd: string;
  /** The routequote.fetch.report.v1 JSON document, verbatim. */
  readonly fetchReportJson: string;
  /** The scoring instant (ISO UTC) — orchestrator-supplied, REQUIRED. */
  readonly scoredAt: string;
  /** The explicit quote age cap in ms — REQUIRED (no default cap by design). */
  readonly maxQuoteAgeMs: number;
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
const DEFAULT_MAX_OUTPUT_BYTES = 4_194_304; // 4 MiB
const DEFAULT_MAX_INPUT_BYTES = 2_097_152; // 2 MiB — mirrors the engine's stdin ceiling
const DETAIL_CAP = 600;

function cap(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > DETAIL_CAP ? `${trimmed.slice(0, DETAIL_CAP)}…` : trimmed;
}

/** Invoke `quote-score --json` over stdin and strictly validate the artifact. */
export async function scoreQuotesThroughEngine(
  opts: ScoreQuotesThroughEngineOptions,
): Promise<EngineQuoteScoreBridgeResult> {
  const maxInputBytes = opts.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const inputBytes = Buffer.byteLength(opts.fetchReportJson, "utf8");
  if (inputBytes > maxInputBytes) {
    return {
      kind: "refused",
      reason: "input-too-large",
      detail: `the fetch report is ${inputBytes} bytes — beyond the ${maxInputBytes}-byte ceiling; bound it`,
    };
  }
  if (!Number.isInteger(opts.maxQuoteAgeMs) || opts.maxQuoteAgeMs <= 0 || opts.maxQuoteAgeMs > 999_999_999) {
    return {
      kind: "refused",
      reason: "unsafe-args",
      detail: "maxQuoteAgeMs must be a positive integer (no default cap exists by design)",
    };
  }

  const subcommandArgs = [
    "quote-score",
    "--json",
    "--scored-at",
    opts.scoredAt,
    "--max-quote-age-ms",
    String(opts.maxQuoteAgeMs),
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
    stdinData: opts.fetchReportJson,
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
  const validation = validateEngineQuoteScoreReportV1(parsed);
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
