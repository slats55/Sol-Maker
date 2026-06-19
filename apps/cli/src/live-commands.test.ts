import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildUnsignedSelfTransferProbe } from "@soulmaker/txpreview";

import {
  liveCanaryPrepareReport,
  liveChainsReport,
  liveKillSwitchReport,
  livePolicyInspectReport,
  liveSessionReport,
} from "./live-commands.js";

const FIXTURE_PUBKEY = "So11111111111111111111111111111111111111112";
const CANDIDATE_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = "2026-06-18T00:00:00.000Z";
const ctx = { cwd: process.cwd(), env: {} as NodeJS.ProcessEnv, now: () => NOW };

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "live-cli-"));
}

function writeFixtures(dir: string): { risk: string; envelope: string; sim: string; quote: string } {
  const risk = join(dir, "risk.json");
  writeFileSync(risk, JSON.stringify({ mint: CANDIDATE_MINT, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [] }));

  const envelope = join(dir, "envelope.json");
  writeFileSync(envelope, JSON.stringify(buildUnsignedSelfTransferProbe({ feePayerPublicKey: FIXTURE_PUBKEY, network: "mainnet-beta" })));

  const sim = join(dir, "sim.json");
  writeFileSync(sim, JSON.stringify({ outcome: "simulated-ok", classification: "none" }));

  const quote = join(dir, "quote.json");
  writeFileSync(
    quote,
    JSON.stringify({
      provider: "jupiter-lite-api",
      inputMint: FIXTURE_PUBKEY,
      outputMint: CANDIDATE_MINT,
      inAmountRaw: "1000000",
      outAmountRaw: "999000",
      slippageBps: 50,
      priceImpactPct: 0.2,
      quotedAt: NOW,
      ageMs: 1000,
      routeLabels: ["jupiter"],
    }),
  );
  return { risk, envelope, sim, quote };
}

describe("live:policy:inspect", () => {
  it("the default (paper) policy is blocked from everything live", () => {
    const r = livePolicyInspectReport(ctx, { json: true });
    const parsed = JSON.parse(r.text);
    expect(parsed.policy.mode).toBe("paper");
    expect(parsed.evaluation.prepareAllowed).toBe(false);
    expect(parsed.evaluation.blockingReasons).toContain("live-disabled");
  });

  it("a fully configured live_canary policy is prepare + arm allowed", () => {
    const r = livePolicyInspectReport(ctx, { mode: "live_canary", liveEnabled: true, json: true });
    const parsed = JSON.parse(r.text);
    expect(parsed.evaluation.prepareAllowed).toBe(true);
    expect(parsed.evaluation.canaryArmAllowed).toBe(true);
  });

  it("refuses a cap above the hard ceiling", () => {
    const r = livePolicyInspectReport(ctx, { mode: "live_canary", liveEnabled: true, maxTradeSol: "1" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/hard ceiling/);
  });
});

describe("live:chains", () => {
  it("solana is live-capable; other chains are not implemented", () => {
    const r = liveChainsReport(ctx, { json: true });
    const parsed = JSON.parse(r.text);
    const solana = parsed.chains.find((c: { chainId: string }) => c.chainId === "solana-mainnet");
    expect(solana.liveStatus).toBe("live_capable");
    expect(parsed.chains.filter((c: { liveStatus: string }) => c.liveStatus === "live_capable")).toHaveLength(1);
  });
});

describe("live:kill-switch", () => {
  it("reflects an environment emergency stop", () => {
    const r = liveKillSwitchReport({ cwd: process.cwd(), env: { SOULMAKER_EMERGENCY_STOP: "1" } as NodeJS.ProcessEnv }, { json: true });
    const parsed = JSON.parse(r.text);
    expect(parsed.emergencyStop).toBe(true);
    expect(parsed.liveBlocked).toBe(true);
  });
});

describe("live:canary:prepare", () => {
  it("assembles a preflight_ready request from real artifacts", () => {
    const dir = tmp();
    const fx = writeFixtures(dir);
    const r = liveCanaryPrepareReport(ctx, {
      candidateMint: CANDIDATE_MINT,
      riskPath: fx.risk,
      envelopePath: fx.envelope,
      quotePath: fx.quote,
      simulationPath: fx.sim,
      spendLamports: "1000000",
      auditLog: join(dir, "audit.jsonl"),
      mode: "live_canary",
      liveEnabled: true,
      json: true,
    });
    const parsed = JSON.parse(r.text);
    expect(parsed.schemaVersion).toBe("live.canary.request.v1");
    expect(parsed.state).toBe("preflight_ready");
    expect(parsed.signed).toBe(false);
    expect(parsed.envelope.network).toBe("mainnet-beta");
    expect(r.exitCode).toBe(0);
  });

  it("blocks (and can fail) when the policy is paper / live-disabled", () => {
    const dir = tmp();
    const fx = writeFixtures(dir);
    const r = liveCanaryPrepareReport(ctx, {
      candidateMint: CANDIDATE_MINT,
      riskPath: fx.risk,
      envelopePath: fx.envelope,
      quotePath: fx.quote,
      simulationPath: fx.sim,
      spendLamports: "1000000",
      json: true,
      failOnBlocked: true,
    });
    const parsed = JSON.parse(r.text);
    expect(parsed.state).toBe("blocked_by_policy");
    expect(parsed.blockingReasons).toContain("live-disabled");
    expect(r.exitCode).toBe(2);
  });

  it("blocks by risk when the risk report is a REJECT", () => {
    const dir = tmp();
    const fx = writeFixtures(dir);
    const rejectRisk = join(dir, "reject.json");
    writeFileSync(rejectRisk, JSON.stringify({ mint: CANDIDATE_MINT, score: 90, decision: "REJECT", flags: [{ id: "freeze-authority", severity: "critical" }] }));
    const r = liveCanaryPrepareReport(ctx, {
      candidateMint: CANDIDATE_MINT,
      riskPath: rejectRisk,
      envelopePath: fx.envelope,
      quotePath: fx.quote,
      simulationPath: fx.sim,
      spendLamports: "1000000",
      mode: "live_canary",
      liveEnabled: true,
      json: true,
    });
    expect(JSON.parse(r.text).state).toBe("blocked_by_risk");
  });

  it("refuses without --candidate-mint", () => {
    const r = liveCanaryPrepareReport(ctx, { riskPath: "x.json" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/--candidate-mint is required/);
  });

  it("refuses without --risk", () => {
    const r = liveCanaryPrepareReport(ctx, { candidateMint: CANDIDATE_MINT });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/--risk is required/);
  });

  it("writes the request to --out and refuses to overwrite", () => {
    const dir = tmp();
    const fx = writeFixtures(dir);
    const out = join(dir, "request.json");
    const base = {
      candidateMint: CANDIDATE_MINT,
      riskPath: fx.risk,
      envelopePath: fx.envelope,
      quotePath: fx.quote,
      simulationPath: fx.sim,
      spendLamports: "1000000",
      mode: "live_canary",
      liveEnabled: true,
      out,
    };
    const first = liveCanaryPrepareReport(ctx, base);
    expect(first.text).toMatch(/wrote /);
    const second = liveCanaryPrepareReport(ctx, base);
    expect(second.exitCode).toBe(1);
    expect(second.text).toMatch(/already exists/);
  });
});

describe("live:session:report", () => {
  it("reports an honest empty state with no log", () => {
    const r = liveSessionReport(ctx, { json: true });
    expect(JSON.parse(r.text).entries).toBe(0);
  });

  it("tallies states from a JSONL log", () => {
    const dir = tmp();
    const log = join(dir, "session.jsonl");
    writeFileSync(log, [JSON.stringify({ state: "confirmed" }), JSON.stringify({ state: "user_rejected" }), JSON.stringify({ state: "confirmed" })].join("\n"));
    const r = liveSessionReport(ctx, { sessionLog: log, json: true });
    const parsed = JSON.parse(r.text);
    expect(parsed.entries).toBe(3);
    expect(parsed.byState.confirmed).toBe(2);
    expect(parsed.byState.user_rejected).toBe(1);
  });
});
