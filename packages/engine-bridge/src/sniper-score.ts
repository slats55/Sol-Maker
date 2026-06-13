/**
 * Run a TypeScript-produced `sniper.score.input.v1` bundle through the Rust
 * engine's `sniper-score` hot path and strictly validate the result. The bundle
 * travels over bounded stdin (refused oversized BEFORE any process starts); the
 * scoring instant travels as a closed-vocabulary `--created-at` argument. The
 * bridge parses the SAME bytes it sends to build a cross-check, so the validator
 * can confirm Rust neither fabricated, dropped, nor altered a candidate's facts.
 * The result is the same closed union the other bridge paths speak: `ok`
 * (validated artifact), `unavailable` (no Rust engine — honest, never a project
 * failure), or `refused`.
 */

import { performance } from "node:perf_hooks";
import { buildChildEnv, checkEngineArgs } from "./guard.js";
import { locateEngineInvocation, type EngineInvocationVia } from "./locate.js";
import { createEngineProcessRunner, type EngineProcessRunner } from "./runner.js";
import type { EngineIpcTiming, EngineUnavailableReason } from "./status.js";
import type { EngineRealtimeRefusedReason } from "./realtime.js";
import {
  validateEngineSniperScoreReportV1,
  type EngineSniperScoreReportV1,
  type SniperScoreInputCrossCheck,
} from "./validate-sniper-score.js";

export type EngineSniperScoreBridgeResult =
  | {
      readonly kind: "ok";
      readonly report: EngineSniperScoreReportV1;
      readonly via: EngineInvocationVia;
      readonly timing: EngineIpcTiming;
    }
  | { readonly kind: "unavailable"; readonly reason: EngineUnavailableReason; readonly detail: string }
  | { readonly kind: "refused"; readonly reason: EngineRealtimeRefusedReason; readonly detail: string };

export interface ScoreCandidatesThroughEngineOptions {
  /** Workspace root (where target/ and Cargo.toml live). */
  readonly cwd: string;
  /** The sniper.score.input.v1 JSON document, verbatim. */
  readonly scoreInputJson: string;
  /** The scoring instant (ISO UTC) — orchestrator-supplied, REQUIRED. */
  readonly createdAt: string;
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

/** Best-effort cross-check from the EXACT bytes sent to Rust; undefined when unparseable. */
function buildCrossCheck(scoreInputJson: string): SniperScoreInputCrossCheck | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(scoreInputJson);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.candidates)) return undefined;
  const candidates: { candidateId: string; mint: string; facts: Record<string, unknown> }[] = [];
  for (const c of obj.candidates) {
    if (typeof c !== "object" || c === null) return undefined;
    const rec = c as Record<string, unknown>;
    if (typeof rec.candidateId !== "string" || typeof rec.mint !== "string") return undefined;
    const facts = typeof rec.facts === "object" && rec.facts !== null && !Array.isArray(rec.facts) ? (rec.facts as Record<string, unknown>) : {};
    candidates.push({ candidateId: rec.candidateId, mint: rec.mint, facts });
  }
  return {
    mode: typeof obj.mode === "string" ? obj.mode : "",
    network: typeof obj.network === "string" ? obj.network : null,
    candidates,
  };
}

/** Invoke `sniper-score --json` over stdin and strictly validate the artifact. */
export async function scoreCandidatesThroughEngine(
  opts: ScoreCandidatesThroughEngineOptions,
): Promise<EngineSniperScoreBridgeResult> {
  const maxInputBytes = opts.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const inputBytes = Buffer.byteLength(opts.scoreInputJson, "utf8");
  if (inputBytes > maxInputBytes) {
    return {
      kind: "refused",
      reason: "input-too-large",
      detail: `the score input is ${inputBytes} bytes — beyond the ${maxInputBytes}-byte ceiling; bound it`,
    };
  }

  const subcommandArgs = ["sniper-score", "--json", "--created-at", opts.createdAt];
  const argProblem = checkEngineArgs(subcommandArgs);
  if (argProblem !== null) {
    return { kind: "refused", reason: "unsafe-args", detail: argProblem };
  }

  const crossCheck = buildCrossCheck(opts.scoreInputJson);
  const invocation = locateEngineInvocation(opts.cwd, opts.exists);
  const runner = opts.runner ?? createEngineProcessRunner();

  const spawnStart = performance.now();
  const result = await runner.run(invocation.command, [...invocation.baseArgs, ...subcommandArgs], {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    cwd: opts.cwd,
    env: buildChildEnv(opts.env ?? process.env),
    stdinData: opts.scoreInputJson,
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
  const validation = validateEngineSniperScoreReportV1(parsed, crossCheck);
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
