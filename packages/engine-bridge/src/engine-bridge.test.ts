import { describe, it, expect } from "vitest";
import { redactValue } from "@soulmaker/security";
import {
  validateEngineStatusReportV1,
  ENGINE_STATUS_SCHEMA_VERSION,
} from "./validate.js";
import { checkEngineArgs, buildChildEnv } from "./guard.js";
import { locateEngineInvocation } from "./locate.js";
import { fetchEngineStatus } from "./status.js";
import type { EngineProcessRunner, EngineProcessResult, EngineProcessOptions } from "./runner.js";

/**
 * Byte-faithful copy of what `solmaker-engine status --json --created-at
 * 2026-06-12T00:00:00.000Z` actually printed on 2026-06-12 (rustc 1.96.0,
 * debug build). If the Rust artifact shape changes, this fixture and the
 * validator must change in the same commit — that is the parity discipline.
 */
const REAL_ENGINE_OUTPUT = {
  schemaVersion: "engine.status.report.v1",
  banner:
    "RUST ENGINE STATUS — sidecar foundation report. This engine has no signing, sending, wallet, key, or network capability by construction; TypeScript validates every byte it emits before anything reads it.",
  engineName: "solmaker-engine",
  engineVersion: "0.1.0",
  buildProfile: "debug",
  rustcVersion: "rustc 1.96.0 (ac68faa20 2026-05-25)",
  ipcVersion: "engine.ipc.v1",
  safetyMode: "sidecar-read-only",
  signerSupport: "disabled",
  sendSupport: "disabled",
  mainnetSendSupport: "disabled",
  supportedCapabilities: ["json-ipc", "schema-parity", "status"],
  disabledCapabilities: [
    "mainnet-live",
    "seed-phrase-handling",
    "sending",
    "signing",
    "wallet-loading",
  ],
  createdAt: "2026-06-12T00:00:00.000Z",
  caveats: [
    "Foundation sidecar only: status, JSON IPC, and schema parity. No realtime ingestion, quoting, simulation, or execution capability exists in this engine yet.",
    "The engine cannot sign, send, or load wallet/key material — those capabilities have no code path here, and capability scans on both sides enforce that.",
    "createdAt is supplied by the orchestrator (--created-at) so identical invocations stay byte-identical; the engine reads no clock.",
  ],
  neverSends: true,
  phase7LiveTradingReady: false,
} as const;

function fixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(REAL_ENGINE_OUTPUT)) as Record<string, unknown>;
}

function fakeRunner(result: Partial<EngineProcessResult>, capture?: { command?: string; args?: readonly string[]; opts?: EngineProcessOptions }): EngineProcessRunner {
  return {
    run(command, args, opts) {
      if (capture) {
        capture.command = command;
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

const okStdout = JSON.stringify(REAL_ENGINE_OUTPUT, null, 2) + "\n";

describe("validateEngineStatusReportV1", () => {
  it("accepts the REAL Rust engine output verbatim", () => {
    const result = validateEngineStatusReportV1(fixture());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.schemaVersion).toBe(ENGINE_STATUS_SCHEMA_VERSION);
      expect(result.report.signerSupport).toBe("disabled");
    }
  });

  it("redaction does not alter the validated artifact (no secret-shaped fields exist)", () => {
    expect(redactValue(fixture())).toEqual(fixture());
  });

  it("refuses a non-object", () => {
    for (const bad of [null, 42, "x", [fixture()]]) {
      const result = validateEngineStatusReportV1(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("refuses an unknown field — the schema is CLOSED", () => {
    const doc = fixture();
    doc.newCapabilityFlag = true;
    const result = validateEngineStatusReportV1(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("unknown field");
  });

  it("refuses every missing required field", () => {
    for (const key of Object.keys(fixture())) {
      const doc = fixture();
      delete doc[key];
      expect(validateEngineStatusReportV1(doc).ok, `missing ${key} must refuse`).toBe(false);
    }
  });

  it("refuses signer/send/mainnet markers that are anything but the literal 'disabled'", () => {
    for (const marker of ["signerSupport", "sendSupport", "mainnetSendSupport"]) {
      for (const bad of ["enabled", "experimental", "", true, null, "DISABLED"]) {
        const doc = fixture();
        doc[marker] = bad;
        expect(validateEngineStatusReportV1(doc).ok, `${marker}=${String(bad)} must refuse`).toBe(false);
      }
    }
  });

  it("refuses a supported capability outside the reviewed allowlist", () => {
    const doc = fixture();
    doc.supportedCapabilities = ["status", "signing"];
    const result = validateEngineStatusReportV1(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("allowlist");
  });

  it("refuses when a required disabled capability is missing", () => {
    const doc = fixture();
    doc.disabledCapabilities = ["mainnet-live", "sending", "signing", "wallet-loading"]; // seed-phrase-handling removed
    expect(validateEngineStatusReportV1(doc).ok).toBe(false);
  });

  it("refuses neverSends!==true and phase7LiveTradingReady!==false", () => {
    const doc1 = fixture();
    doc1.neverSends = false;
    expect(validateEngineStatusReportV1(doc1).ok).toBe(false);
    const doc2 = fixture();
    doc2.phase7LiveTradingReady = true;
    expect(validateEngineStatusReportV1(doc2).ok).toBe(false);
  });

  it("refuses a malformed createdAt but accepts null", () => {
    const doc = fixture();
    doc.createdAt = null;
    expect(validateEngineStatusReportV1(doc).ok).toBe(true);
    doc.createdAt = "yesterday";
    expect(validateEngineStatusReportV1(doc).ok).toBe(false);
  });
});

describe("checkEngineArgs — closed argument vocabulary", () => {
  it("accepts the exact status invocation", () => {
    expect(checkEngineArgs(["status", "--json"])).toBeNull();
    expect(checkEngineArgs(["status", "--json", "--created-at", "2026-06-12T00:00:00.000Z"])).toBeNull();
  });

  it("refuses unknown flags, paths, and shell metacharacters", () => {
    expect(checkEngineArgs(["status", "--verbose"])).not.toBeNull();
    expect(checkEngineArgs(["status; rm -rf /"])).not.toBeNull();
    expect(checkEngineArgs(["status", "--json", "$(whoami)"])).not.toBeNull();
    expect(checkEngineArgs(["C:/keys/id.json"])).not.toBeNull();
  });

  it("refuses secret-shaped arguments outright", () => {
    expect(checkEngineArgs(["status", "--created-at", "5".repeat(64)])).not.toBeNull();
    expect(checkEngineArgs(["--seed-phrase"])).not.toBeNull();
    expect(checkEngineArgs(["--keypair"])).not.toBeNull();
    expect(checkEngineArgs(["status", "--created-at", "not-a-timestamp"])).not.toBeNull();
  });
});

describe("buildChildEnv — environment allowlist", () => {
  it("forwards only allowlisted names and drops everything secret-shaped", () => {
    const env = buildChildEnv({
      PATH: "/usr/bin",
      HOME: "/home/op",
      SOLMAKER_ENABLE_LIVE_TRADING: "yes",
      PRIVATE_KEY: "abc",
      SEED_PHRASE: "abc",
      RPC_API_KEY: "abc",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/op" });
  });
});

describe("locateEngineInvocation", () => {
  it("prefers release, then debug, then cargo run", () => {
    const release = locateEngineInvocation("/repo", (p) => p.includes("release"));
    expect(release.via).toBe("prebuilt-release");
    expect(release.baseArgs).toEqual([]);
    const debug = locateEngineInvocation("/repo", (p) => p.includes("debug"));
    expect(debug.via).toBe("prebuilt-debug");
    const cargo = locateEngineInvocation("/repo", () => false);
    expect(cargo.via).toBe("cargo-run");
    expect(cargo.command).toBe("cargo");
    expect(cargo.baseArgs).toEqual(["run", "--quiet", "-p", "solmaker-engine", "--"]);
  });
});

describe("fetchEngineStatus — IPC bridge", () => {
  const base = { cwd: "/repo", exists: () => false, env: { PATH: "/usr/bin" } };

  it("returns the validated artifact with IPC timing on success", async () => {
    const capture: { command?: string; args?: readonly string[]; opts?: EngineProcessOptions } = {};
    const result = await fetchEngineStatus({
      ...base,
      createdAt: "2026-06-12T00:00:00.000Z",
      runner: fakeRunner({ stdout: okStdout }, capture),
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.report.engineName).toBe("solmaker-engine");
      expect(result.via).toBe("cargo-run");
      expect(result.timing.spawnMs).toBeGreaterThanOrEqual(0);
      expect(result.timing.parseMs).toBeGreaterThanOrEqual(0);
      expect(result.timing.validateMs).toBeGreaterThanOrEqual(0);
    }
    // The invocation is an argument ARRAY through the seam — no shell string anywhere.
    expect(capture.args).toEqual([
      "run", "--quiet", "-p", "solmaker-engine", "--",
      "status", "--json", "--created-at", "2026-06-12T00:00:00.000Z",
    ]);
    // The child env was rebuilt from the allowlist, not forwarded wholesale.
    expect(capture.opts?.env).toEqual({ PATH: "/usr/bin" });
  });

  it("reports a missing Rust engine honestly as unavailable, not as an error", async () => {
    const result = await fetchEngineStatus({
      ...base,
      runner: fakeRunner({ started: false, startError: "ENOENT", exitCode: null }),
    });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("rust-engine-missing");
      expect(result.detail).toContain("rustup.rs");
    }
  });

  it("refuses a timeout", async () => {
    const result = await fetchEngineStatus({
      ...base,
      runner: fakeRunner({ timedOut: true, exitCode: null }),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toBe("engine-timeout");
  });

  it("refuses oversized output", async () => {
    const result = await fetchEngineStatus({
      ...base,
      runner: fakeRunner({ stdoutTruncated: true }),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toBe("output-too-large");
  });

  it("refuses a non-zero exit with bounded stderr detail", async () => {
    const result = await fetchEngineStatus({
      ...base,
      runner: fakeRunner({ exitCode: 2, stderr: "refused: unknown argument\n" + "x".repeat(5000) }),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("engine-error");
      expect(result.detail.length).toBeLessThanOrEqual(601);
    }
  });

  it("refuses invalid JSON", async () => {
    const result = await fetchEngineStatus({ ...base, runner: fakeRunner({ stdout: "not json{" }) });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toBe("invalid-json");
  });

  it("refuses a schema mismatch (engine claiming signing enabled)", async () => {
    const doc = fixture();
    doc.signerSupport = "enabled";
    const result = await fetchEngineStatus({
      ...base,
      runner: fakeRunner({ stdout: JSON.stringify(doc) }),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("schema-mismatch");
      expect(result.detail).toContain("disabled");
    }
  });

  it("refuses unsafe args before any process could run", async () => {
    const result = await fetchEngineStatus({
      ...base,
      createdAt: "2026-06-12T00:00:00.000Z ",
      runner: fakeRunner({}),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toBe("unsafe-args");
  });
});
