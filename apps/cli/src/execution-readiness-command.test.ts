/**
 * Sprint 93 — `execution:readiness` (the honest mainnet readiness checklist).
 *
 * Pins:
 *   - default: verdict blocked, 14 conditions evaluated, EVERY missing condition named with a
 *     next safe action;
 *   - partial evidence (fresh quote + ok simulation + risk under cap + valid wallet + caps +
 *     audit path + env ack + config ready) is STILL blocked — the CLI acknowledgment, signer
 *     boundary, and redaction findings evaluate only at execution time, so this command is
 *     structurally incapable of reporting armed;
 *   - no bypass / force-arm / env-only enable: the registered flag set is closed and the
 *     verdict literal is always "blocked";
 *   - the command never sends and never loads key material.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import { executionReadinessReport } from "./commands.js";

const NOW_ISO = "2026-06-12T12:00:00.000Z";

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "exec-ready-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

interface ReadinessJson {
  verdict: string;
  satisfiedCount: number;
  totalChecks: number;
  conditions: Array<{ gate: string; satisfied: boolean; nextAction: string }>;
  blockedReason: string;
  evidence: Record<string, unknown>;
  phase7LiveTradingReady: boolean;
  neverSends: boolean;
}

function run(tmp: string, env: Record<string, string>, opts: Record<string, unknown>): ReadinessJson {
  const r = executionReadinessReport({ cwd: tmp, env, now: () => NOW_ISO }, { json: true, ...opts });
  expect(r.exitCode, r.text.slice(0, 500)).toBe(0);
  return JSON.parse(r.text) as ReadinessJson;
}

describe("execution:readiness — default blocked, every gap named", () => {
  it("default: verdict blocked, all 14 conditions present, every missing condition has a next action", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
      const report = run(tmp, {}, {});
      expect(report.verdict).toBe("blocked");
      expect(report.totalChecks).toBe(14);
      expect(report.phase7LiveTradingReady).toBe(false);
      expect(report.neverSends).toBe(true);
      const missing = report.conditions.filter((c) => !c.satisfied);
      expect(missing.length).toBeGreaterThanOrEqual(10);
      for (const c of missing) {
        expect(c.nextAction.length, c.gate).toBeGreaterThan(10);
        expect(report.blockedReason).toContain(c.gate);
      }
    });
  });

  it("FULL evidence is still blocked: ack/signer/redaction evaluate only at execution time", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(
        join(tmp, "soulmaker.config.json"),
        JSON.stringify({ mode: "PAPER", phase7LiveTradingReady: true, killSwitch: false }),
      );
      writeFileSync(join(tmp, "quotes.json"), JSON.stringify({ schemaVersion: "routequote.fetch.report.v1", fetchedAt: "2026-06-12T11:59:50.000Z" }));
      writeFileSync(join(tmp, "risk.json"), JSON.stringify({ mint: "So11111111111111111111111111111111111111112", score: 5, decision: "PASS_FOR_PAPER_EVALUATION" }));
      writeFileSync(join(tmp, "sim.json"), JSON.stringify({ schemaVersion: "txpreview.simulation.report.v1", outcome: "simulated-ok", endpointHost: "x", simulatedAt: NOW_ISO }));
      const report = run(
        tmp,
        { SOLMAKER_ENABLE_LIVE_TRADING: "I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK" },
        {
          quoteReportPath: "quotes.json",
          maxQuoteAgeMs: "30000",
          riskPath: "risk.json",
          riskScoreCap: "30",
          simulationPath: "sim.json",
          slippageCapBps: "100",
          wallet: Keypair.generate().publicKey.toBase58(),
          auditLog: "audit.jsonl",
        },
      );
      expect(report.verdict).toBe("blocked");
      expect(report.satisfiedCount).toBe(11); // everything except cli-ack, signer-boundary, audit-and-redaction
      const stillMissing = report.conditions.filter((c) => !c.satisfied).map((c) => c.gate);
      expect(stillMissing).toEqual(["cli-acknowledgment", "signer-boundary", "audit-and-redaction"]);
      // The evidence block reflects what was actually named.
      expect(report.evidence.quoteFreshness).toMatchObject({ verdict: "fresh" });
      expect(report.evidence.risk).toMatchObject({ score: 5, cap: 30 });
      expect(report.evidence.simulation).toMatchObject({ outcome: "simulated-ok" });
    });
  });

  it("a stale quote and a failed simulation each leave their condition unsatisfied (named individually)", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
      writeFileSync(join(tmp, "quotes.json"), JSON.stringify({ schemaVersion: "routequote.fetch.report.v1", fetchedAt: "2026-06-12T11:00:00.000Z" }));
      writeFileSync(join(tmp, "sim.json"), JSON.stringify({ schemaVersion: "txpreview.simulation.report.v1", outcome: "simulated-failed" }));
      const report = run(tmp, {}, { quoteReportPath: "quotes.json", maxQuoteAgeMs: "30000", simulationPath: "sim.json" });
      const byGate = Object.fromEntries(report.conditions.map((c) => [c.gate, c.satisfied]));
      expect(byGate["quote-fresh"]).toBe(false);
      expect(byGate["simulation-ok"]).toBe(false);
      expect((report.evidence.quoteFreshness as { verdict: string }).verdict).toBe("stale");
    });
  });

  it("refuses an operator-supplied prepared artifact as the quote source and a non-simulation artifact as --simulation", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
      writeFileSync(join(tmp, "prepared.json"), JSON.stringify({ schemaVersion: "routequote.prepared.v1", fetchedAt: NOW_ISO }));
      const refusedQuote = executionReadinessReport({ cwd: tmp, env: {} }, { quoteReportPath: "prepared.json", maxQuoteAgeMs: "1000" });
      expect(refusedQuote.exitCode).toBe(1);
      expect(refusedQuote.text).toContain("hand-typed quotes can never satisfy live freshness");

      writeFileSync(join(tmp, "not-sim.json"), JSON.stringify({ schemaVersion: "something.else.v1" }));
      const refusedSim = executionReadinessReport({ cwd: tmp, env: {} }, { simulationPath: "not-sim.json" });
      expect(refusedSim.exitCode).toBe(1);
      expect(refusedSim.text).toContain("txpreview.simulation.report.v1");
    });
  });

  it("an invalid --wallet refuses without echoing key-shaped material", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
      const r = executionReadinessReport({ cwd: tmp, env: {} }, { wallet: "5".repeat(88) });
      expect(r.exitCode).toBe(1);
      expect(r.text).not.toContain("5".repeat(88));
    });
  });

  it("--out writes ONLY the readiness JSON and refuses overwrite without --force", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
      const first = executionReadinessReport({ cwd: tmp, env: {}, now: () => NOW_ISO }, { outPath: "ready.json" });
      expect(first.exitCode).toBe(0);
      const onDisk = JSON.parse(readFileSync(join(tmp, "ready.json"), "utf8")) as ReadinessJson;
      expect(onDisk.verdict).toBe("blocked");
      const second = executionReadinessReport({ cwd: tmp, env: {} }, { outPath: "ready.json" });
      expect(second.exitCode).toBe(1);
      expect(second.text).toContain("already exists");
    });
  });
});

describe("execution:readiness — S94 evidence quality", () => {
  it("echoes the caps in effect, the requested-mode label, and the never-loaded signer boundary", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
      const report = run(tmp, {}, { slippageCapBps: "100", riskScoreCap: "30" }) as ReadinessJson & {
        requestedMode: string;
        caps: Record<string, unknown>;
        evidence: { signerBoundary?: string };
      };
      expect(report.requestedMode).toContain("evaluation only");
      expect(report.caps.slippageCapBps).toBe(100);
      expect(report.caps.riskScoreCap).toBe(30); // echoed even without a risk report (the cap the run was configured with)
      expect(report.evidence.signerBoundary).toContain("not-loaded");
    });
  });

  it("surfaces the Token-2022 extension flags riding on the risk evidence, severities verbatim", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
      writeFileSync(
        join(tmp, "risk.json"),
        JSON.stringify({
          mint: "So11111111111111111111111111111111111111112",
          score: 100,
          decision: "REJECT",
          flags: [
            { id: "transfer-hook-present", severity: "critical" },
            { id: "permanent-delegate-present", severity: "critical" },
            { id: "freeze-authority-present", severity: "high" }, // NOT a token-2022 flag — must not appear
          ],
        }),
      );
      const report = run(tmp, {}, { riskPath: "risk.json", riskScoreCap: "30" }) as ReadinessJson & {
        evidence: { risk: { decision: string; source: string; token2022Flags: Array<{ id: string; severity: string }> } };
      };
      expect(report.evidence.risk.decision).toBe("REJECT");
      expect(report.evidence.risk.source).toContain("operator-named file");
      expect(report.evidence.risk.token2022Flags).toEqual([
        { id: "transfer-hook-present", severity: "critical" },
        { id: "permanent-delegate-present", severity: "critical" },
      ]);
      const byGate = Object.fromEntries(report.conditions.map((c) => [c.gate, c.satisfied]));
      expect(byGate["risk-under-threshold"]).toBe(false);
    });
  });

  it("the human output names network, caps, evidence, signer boundary, and the exact next safe action", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
      const r = executionReadinessReport({ cwd: tmp, env: {}, now: () => NOW_ISO }, {});
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("network:     mainnet-beta");
      expect(r.text).toContain("caps:");
      expect(r.text).toContain("signer boundary: never loaded here");
      expect(r.text).toContain("next safe action:");
    });
  });
});

describe("execution:readiness — no bypass surface", () => {
  it("the registered flag set carries no bypass/force-arm/enable-live flag, and no readiness flag can arm", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
    const block = source.slice(source.indexOf('command("execution:readiness")'), source.indexOf('command("execution:devnet:rehearse")'));
    expect(block.length).toBeGreaterThan(100);
    const flags = [...block.matchAll(/option\("(--[a-z-]+)/g)].map((m) => m[1]);
    expect(flags).toContain("--quote-report");
    for (const flag of flags) {
      expect(flag).not.toMatch(/bypass|arm|enable|live|unsafe|skip-gate|i-understand/);
    }
    // --force exists ONLY as the file-overwrite convention; the verdict literal is hardcoded blocked.
    expect(block).toContain("overwrite an existing --out file");
  });

  it("the report verdict is the literal 'blocked' even with the live env acknowledgment set", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER", phase7LiveTradingReady: true }));
      const report = run(tmp, { SOLMAKER_ENABLE_LIVE_TRADING: "I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK" }, {});
      expect(report.verdict).toBe("blocked");
    });
  });
});
