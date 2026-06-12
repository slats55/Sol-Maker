import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineProcessRunner } from "@soulmaker/engine-bridge";
import { engineStatusReport } from "./commands.js";

/** Minimal valid engine artifact matching what the real Rust binary emits. */
function engineArtifact(createdAt: string | null): Record<string, unknown> {
  return {
    schemaVersion: "engine.status.report.v1",
    banner: "RUST ENGINE STATUS — test fixture banner.",
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
    disabledCapabilities: ["mainnet-live", "seed-phrase-handling", "sending", "signing", "wallet-loading"],
    createdAt,
    caveats: ["Foundation sidecar only — test fixture caveat."],
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

const FIXED_NOW = "2026-06-12T00:00:00.000Z";

function okRunner(capture?: { args?: readonly string[]; env?: Record<string, string> }): EngineProcessRunner {
  return {
    run(_command, args, opts) {
      if (capture) {
        capture.args = args;
        capture.env = opts.env;
      }
      // The real engine echoes --created-at verbatim; mirror that honestly.
      const idx = args.indexOf("--created-at");
      const createdAt = idx === -1 ? null : (args[idx + 1] ?? null);
      return Promise.resolve({
        started: true,
        startError: null,
        exitCode: 0,
        timedOut: false,
        stdout: JSON.stringify(engineArtifact(createdAt), null, 2) + "\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    },
  };
}

function missingRunner(): EngineProcessRunner {
  return {
    run() {
      return Promise.resolve({
        started: false,
        startError: "ENOENT",
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    },
  };
}

const baseCtx = {
  cwd: "/repo",
  now: () => FIXED_NOW,
  engineBinaryExists: () => false,
  env: { PATH: "/usr/bin", SOLMAKER_ENABLE_LIVE_TRADING: "yes" } as NodeJS.ProcessEnv,
};

describe("engine:status — Rust sidecar bridge command", () => {
  it("reports the validated artifact with safety markers in the text view", async () => {
    const capture: { args?: readonly string[]; env?: Record<string, string> } = {};
    const { text, exitCode } = await engineStatusReport(
      { ...baseCtx, createEngineRunner: () => okRunner(capture) },
      {},
    );
    expect(exitCode).toBe(0);
    expect(text).toContain("RUST ENGINE STATUS");
    expect(text).toContain("signer: disabled | send: disabled | mainnet send: disabled");
    expect(text).toContain("engine.ipc.v1");
    expect(text).toContain("never a trading-latency claim");
    // The orchestrator-supplied timestamp went through as an argument array.
    expect(capture.args).toContain("--created-at");
    expect(capture.args).toContain(FIXED_NOW);
    // The secret-shaped env var was NOT forwarded to the child.
    expect(capture.env).toEqual({ PATH: "/usr/bin" });
  });

  it("--json prints the artifact verbatim with the registered schemaVersion", async () => {
    const { text, exitCode } = await engineStatusReport(
      { ...baseCtx, createEngineRunner: () => okRunner() },
      { json: true },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe("engine.status.report.v1");
    expect(parsed.signerSupport).toBe("disabled");
    expect(parsed.createdAt).toBe(FIXED_NOW);
  });

  it("--out writes ONLY the validated artifact and refuses overwrite without --force", async () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-status-"));
    try {
      const outPath = join(dir, "engine-status.json");
      const first = await engineStatusReport(
        { ...baseCtx, createEngineRunner: () => okRunner() },
        { outPath },
      );
      expect(first.exitCode).toBe(0);
      const written = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
      expect(written.schemaVersion).toBe("engine.status.report.v1");

      const second = await engineStatusReport(
        { ...baseCtx, createEngineRunner: () => okRunner() },
        { outPath },
      );
      expect(second.exitCode).toBe(1);
      expect(second.text).toContain("Refusing");

      const forced = await engineStatusReport(
        { ...baseCtx, createEngineRunner: () => okRunner() },
        { outPath, force: true },
      );
      expect(forced.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a missing Rust engine is honest and exit 0 by default, exit 1 with --fail-on-unavailable", async () => {
    const ctx = { ...baseCtx, createEngineRunner: () => missingRunner() };
    const soft = await engineStatusReport(ctx, {});
    expect(soft.exitCode).toBe(0);
    expect(soft.text).toContain("UNAVAILABLE");
    expect(soft.text).toContain("rustup.rs");

    const hard = await engineStatusReport(ctx, { failOnUnavailable: true });
    expect(hard.exitCode).toBe(1);

    const json = await engineStatusReport(ctx, { json: true });
    const parsed = JSON.parse(json.text) as Record<string, unknown>;
    expect(parsed.engineStatus).toBe("unavailable");
    expect(parsed.reason).toBe("rust-engine-missing");
  });

  it("an engine emitting a tampered artifact is REFUSED with exit 1", async () => {
    const tampered: EngineProcessRunner = {
      run: () => {
        const doc = engineArtifact(null);
        doc.signerSupport = "enabled";
        return Promise.resolve({
          started: true,
          startError: null,
          exitCode: 0,
          timedOut: false,
          stdout: JSON.stringify(doc),
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      },
    };
    const { text, exitCode } = await engineStatusReport(
      { ...baseCtx, createEngineRunner: () => tampered },
      {},
    );
    expect(exitCode).toBe(1);
    expect(text).toContain("REFUSED");
    expect(text).toContain("schema-mismatch");
  });

  it("does not write --out when the engine is unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-status-"));
    try {
      const outPath = join(dir, "engine-status.json");
      const { exitCode } = await engineStatusReport(
        { ...baseCtx, createEngineRunner: () => missingRunner() },
        { outPath },
      );
      expect(exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prebuilt binary discovery prefers target/release then target/debug", async () => {
    const capture: { command?: string } = {};
    const runner: EngineProcessRunner = {
      run(command, args, _opts) {
        capture.command = command;
        const idx = args.indexOf("--created-at");
        const createdAt = idx === -1 ? null : (args[idx + 1] ?? null);
        return Promise.resolve({
          started: true,
          startError: null,
          exitCode: 0,
          timedOut: false,
          stdout: JSON.stringify(engineArtifact(createdAt)),
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      },
    };
    const { exitCode, text } = await engineStatusReport(
      {
        ...baseCtx,
        createEngineRunner: () => runner,
        engineBinaryExists: (p: string) => p.includes("release"),
      },
      {},
    );
    expect(exitCode).toBe(0);
    expect(text).toContain("via prebuilt-release");
    expect(capture.command).toContain("release");
  });
});
