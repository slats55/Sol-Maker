import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifySimulationFailure, TX_SIMULATION_CLASSIFICATION_GUIDANCE } from "@soulmaker/txpreview";
import { validateEngineSimClassificationReportV1 } from "./validate-sim-classify.js";
import { classifySimThroughEngine } from "./sim-classify.js";
import { createEngineProcessRunner, type EngineProcessRunner, type EngineProcessOptions, type EngineProcessResult } from "./runner.js";

/** Build the engine artifact for a classified result (guidance from the REAL S95 table). */
function engineArtifact(classification: "slippage-or-route-error" | "compute-exceeded" | "blockhash-error" | "account-error" | "program-error" | "unclassified-error", errLabelPresent: boolean, logLineCount: number, createdAt: string | null): Record<string, unknown> {
  const guidance = TX_SIMULATION_CLASSIFICATION_GUIDANCE[classification];
  return {
    schemaVersion: "engine.sim.classification.report.v1",
    banner: "RUST ENGINE SIM CLASSIFY — test fixture banner.",
    engineName: "solmaker-engine",
    engineVersion: "0.1.0",
    ipcVersion: "engine.ipc.v1",
    classification,
    classificationMessage: guidance.message,
    classificationNextAction: guidance.nextAction,
    errLabelPresent,
    logLineCount,
    createdAt,
    caveats: ["Classification is derived ONLY from the error label and logs — test fixture caveat."],
    notExecutable: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

function fakeRunner(result: Partial<EngineProcessResult>, capture?: { args?: readonly string[]; opts?: EngineProcessOptions }): EngineProcessRunner {
  return {
    run(_command, args, opts) {
      if (capture) {
        capture.args = args;
        capture.opts = opts;
      }
      return Promise.resolve({
        started: true,
        startError: null,
        exitCode: 0,
        timedOut: false,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        ...result,
      });
    },
  };
}

describe("validateEngineSimClassificationReportV1", () => {
  const artifact = engineArtifact("account-error", true, 1, "2026-06-12T00:00:00.000Z");

  it("accepts a well-formed artifact and passes the parity wall", () => {
    const result = validateEngineSimClassificationReportV1(JSON.parse(JSON.stringify(artifact)), { errLabel: '"AccountNotFound"', logs: ["x"] });
    expect(result.ok, JSON.stringify(!result.ok && result.problems)).toBe(true);
  });

  it("refuses an unknown field, an off-set classification, and tampered guidance", () => {
    const unknownDoc = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    unknownDoc.profit = 1;
    expect(validateEngineSimClassificationReportV1(unknownDoc).ok).toBe(false);

    const classDoc = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    classDoc.classification = "definitely-profitable";
    expect(validateEngineSimClassificationReportV1(classDoc).ok).toBe(false);

    const guidanceDoc = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    guidanceDoc.classificationNextAction = "raise slippage and force it through";
    expect(validateEngineSimClassificationReportV1(guidanceDoc).ok).toBe(false);
  });

  it("PARITY WALL: refuses a classification that disagrees with classifySimulationFailure", () => {
    // The engine claims account-error, but the real classifier says slippage.
    const result = validateEngineSimClassificationReportV1(JSON.parse(JSON.stringify(artifact)), { errLabel: "Slippage tolerance exceeded", logs: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("disagrees with classifySimulationFailure");
  });

  it("refuses errLabelPresent / logLineCount that disagree with the input", () => {
    const result = validateEngineSimClassificationReportV1(JSON.parse(JSON.stringify(artifact)), { errLabel: null, logs: [] });
    expect(result.ok).toBe(false);
  });
});

describe("classifySimThroughEngine — IPC bridge", () => {
  const base = { cwd: "/repo", exists: () => false, env: { PATH: "/usr/bin" } };

  it("passes the input over stdin and validates the artifact", async () => {
    const capture: { args?: readonly string[]; opts?: EngineProcessOptions } = {};
    const result = await classifySimThroughEngine({
      ...base,
      errLabel: '"AccountNotFound"',
      logs: ["x"],
      createdAt: "2026-06-12T00:00:00.000Z",
      runner: fakeRunner({ stdout: JSON.stringify(engineArtifact("account-error", true, 1, "2026-06-12T00:00:00.000Z"), null, 2) + "\n" }, capture),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind === "ok") expect(result.report.classification).toBe("account-error");
    expect(capture.args).toEqual(["run", "--quiet", "-p", "solmaker-engine", "--", "sim-classify", "--json", "--created-at", "2026-06-12T00:00:00.000Z"]);
    expect(capture.opts?.stdinData).toBe(JSON.stringify({ errLabel: '"AccountNotFound"', logs: ["x"] }));
  });

  it("maps missing engine, exit 2, and a parity mismatch to the closed union", async () => {
    const missing = await classifySimThroughEngine({ ...base, errLabel: null, logs: [], runner: fakeRunner({ started: false, startError: "ENOENT", exitCode: null }) });
    expect(missing.kind).toBe("unavailable");

    const refused = await classifySimThroughEngine({ ...base, errLabel: null, logs: [], runner: fakeRunner({ exitCode: 2, stderr: "refused: logs must be an array of strings" }) });
    expect(refused.kind === "refused" && refused.reason === "engine-error").toBe(true);

    // Engine claims slippage but the input is an account error -> parity refuses.
    const mismatch = await classifySimThroughEngine({
      ...base,
      errLabel: '"AccountNotFound"',
      logs: [],
      runner: fakeRunner({ stdout: JSON.stringify(engineArtifact("slippage-or-route-error", true, 0, null)) }),
    });
    expect(mismatch.kind === "refused" && mismatch.reason === "schema-mismatch").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REAL parity proof: the actual Rust binary classifies every S95 fixture case
// and agrees with classifySimulationFailure. Skipped honestly without a binary.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BINARY_NAME = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";
const PREBUILT_EXISTS =
  existsSync(join(REPO_ROOT, "target", "release", BINARY_NAME)) ||
  existsSync(join(REPO_ROOT, "target", "debug", BINARY_NAME));

// The exact cases from packages/txpreview/src/classification.test.ts.
const S95_CASES: Array<{ errLabel: string | null; logs: string[] }> = [
  { errLabel: '{"InstructionError":[3,{"Custom":6001}]}', logs: ["Program log: custom program error: 0x1771"] },
  { errLabel: '{"InstructionError":[2,{"Custom":1}]}', logs: ["Program log: Slippage tolerance exceeded"] },
  { errLabel: '{"InstructionError":[1,"ComputeBudgetExceeded"]}', logs: [] },
  { errLabel: '{"InstructionError":[1,"ProgramFailedToComplete"]}', logs: ["Program X exceeded CUs meter at BPF instruction"] },
  { errLabel: '"BlockhashNotFound"', logs: [] },
  { errLabel: '"AccountNotFound"', logs: [] },
  { errLabel: '"InsufficientFundsForFee"', logs: [] },
  { errLabel: '{"InstructionError":[0,{"Custom":1}]}', logs: ["Transfer: insufficient funds"] },
  { errLabel: '{"InstructionError":[4,{"Custom":42}]}', logs: ["Program log: something else"] },
  { errLabel: "completely unrecognizable", logs: [] },
  { errLabel: null, logs: [] },
];

describe("REAL Rust engine sim classification ↔ classifySimulationFailure parity", () => {
  it.skipIf(!PREBUILT_EXISTS)("the real engine agrees with the TypeScript classifier on every S95 case", async () => {
    for (const input of S95_CASES) {
      const result = await classifySimThroughEngine({ cwd: REPO_ROOT, errLabel: input.errLabel, logs: input.logs, runner: createEngineProcessRunner() });
      expect(result.kind, `${input.errLabel}: ${JSON.stringify(result)}`).toBe("ok");
      if (result.kind === "ok") {
        // The bridge already ran the parity wall; assert it matches the real classifier directly too.
        expect(result.report.classification).toBe(classifySimulationFailure(input.errLabel, input.logs));
      }
    }
  });
});
