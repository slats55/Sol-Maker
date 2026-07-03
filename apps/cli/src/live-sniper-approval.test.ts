/**
 * The operator-approval wall around the armed sniper loop (Sprint 108 Final RC).
 *
 * The predecessor `--armed` boolean was refused by the S102/S103 safety walls and the Phase-7
 * command-surface probe. These tests pin its replacement: arming the loop's escalation session
 * requires a TIME-BOXED `live.operator.approval.v1` created by typing the exact confirm phrase.
 * An expired approval is exactly as powerless as none, and no mode other than armed_canary can
 * use one at all. Nothing here signs or sends — the strongest loop output is a RECOMMENDATION.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPERATOR_APPROVAL_CONFIRM_PHRASE, validateOperatorApproval } from "@soulmaker/live";
import { liveSniperApproveReport, liveSniperRunReport } from "./live-sniper-commands.js";

const MINT = "So11111111111111111111111111111111111111112";
const T0 = "2026-06-18T12:00:00.000Z";
const T0_MS = Date.parse(T0);

function isoAt(offsetMs: number): string {
  return new Date(T0_MS + offsetMs).toISOString();
}

/** A temp workspace with a paper config + green-path candidate/risk/quote fixtures. */
function workspace(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "live-approval-"));
  writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }));
  writeFileSync(
    join(dir, "snapshot.json"),
    JSON.stringify({
      observations: [{ mint: MINT, symbol: "WSOL", sourceProviderId: "jupiter-recent-tokens", sourceKind: "live", liquidityUsdHint: 50_000 }],
    }),
  );
  writeFileSync(join(dir, "risk.json"), JSON.stringify({ score: 0, decision: "PASS_FOR_PAPER_EVALUATION", flags: [] }));
  writeFileSync(join(dir, "quote.json"), JSON.stringify({ priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 1.0, provider: "jupiter" }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runOpts(dir: string, approvalPath?: string) {
  return {
    mode: "armed_canary",
    snapshotPath: "snapshot.json",
    riskPairs: [`${MINT}=risk.json`],
    quotePairs: [`${MINT}=quote.json`],
    approvalPath,
    spendSol: "0.005",
    json: true,
  };
}

describe("live:sniper:approve — the deliberate human act", () => {
  it("refuses without --confirm and names the exact required phrase", () => {
    const r = liveSniperApproveReport({ now: () => T0 }, { operator: "op" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain(OPERATOR_APPROVAL_CONFIRM_PHRASE);
  });

  it("refuses a wrong phrase", () => {
    const r = liveSniperApproveReport({ now: () => T0 }, { operator: "op", confirm: "yes please" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/Refusing/);
  });

  it("refuses a TTL above the ceiling (never clamps)", () => {
    const r = liveSniperApproveReport({ now: () => T0 }, { operator: "op", confirm: OPERATOR_APPROVAL_CONFIRM_PHRASE, ttlMinutes: "120" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/ceiling/);
  });

  it("writes a valid, time-boxed approval artifact", () => {
    const { dir, cleanup } = workspace();
    try {
      const r = liveSniperApproveReport({ cwd: dir, now: () => T0 }, { operator: "op-one", confirm: OPERATOR_APPROVAL_CONFIRM_PHRASE, out: "approval.json" });
      expect(r.exitCode, r.text).toBe(0);
      const approval = validateOperatorApproval(JSON.parse(readFileSync(join(dir, "approval.json"), "utf8")));
      expect(approval.operatorLabel).toBe("op-one");
      expect(approval.cannotSend).toBe(true);
      expect(Date.parse(approval.expiresAt)).toBe(T0_MS + 10 * 60_000);
    } finally {
      cleanup();
    }
  });
});

describe("live:sniper:run — approval gating (recommendation only; never a send)", () => {
  function approve(dir: string): void {
    const r = liveSniperApproveReport({ cwd: dir, now: () => T0 }, { operator: "op", confirm: OPERATOR_APPROVAL_CONFIRM_PHRASE, out: "approval.json" });
    expect(r.exitCode, r.text).toBe(0);
  }

  it("armed_canary + ACTIVE approval + green candidate → prepare_canary_request is RECOMMENDED", () => {
    const { dir, cleanup } = workspace();
    try {
      approve(dir);
      const r = liveSniperRunReport({ cwd: dir, now: () => isoAt(5 * 60_000) }, runOpts(dir, "approval.json"));
      expect(r.exitCode, r.text).toBe(0);
      const report = JSON.parse(r.text) as { operatorApproval: { supplied: boolean; active: boolean }; results: Array<{ action: string; loopNeverSends: boolean }> };
      expect(report.operatorApproval).toMatchObject({ supplied: true, active: true, expired: false });
      expect(report.results[0]?.action, r.text).toBe("prepare_canary_request");
      expect(report.results[0]?.loopNeverSends).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("armed_canary WITHOUT an approval can never recommend a canary (not-armed)", () => {
    const { dir, cleanup } = workspace();
    try {
      const r = liveSniperRunReport({ cwd: dir, now: () => isoAt(5 * 60_000) }, runOpts(dir, undefined));
      expect(r.exitCode, r.text).toBe(0);
      const report = JSON.parse(r.text) as { operatorApproval: { supplied: boolean; active: boolean }; results: Array<{ action: string; blockingReasons: string[] }> };
      expect(report.operatorApproval).toMatchObject({ supplied: false, active: false });
      expect(report.results[0]?.action).not.toBe("prepare_canary_request");
      expect(report.results[0]?.blockingReasons).toContain("escalation:not-armed");
    } finally {
      cleanup();
    }
  });

  it("an EXPIRED approval is exactly as powerless as none", () => {
    const { dir, cleanup } = workspace();
    try {
      approve(dir);
      const r = liveSniperRunReport({ cwd: dir, now: () => isoAt(11 * 60_000) }, runOpts(dir, "approval.json"));
      expect(r.exitCode, r.text).toBe(0);
      const report = JSON.parse(r.text) as { operatorApproval: { active: boolean; expired: boolean; reasons: string[] }; results: Array<{ action: string; blockingReasons: string[] }> };
      expect(report.operatorApproval.active).toBe(false);
      expect(report.operatorApproval.expired).toBe(true);
      expect(report.operatorApproval.reasons).toContain("approval-expired");
      expect(report.results[0]?.action).not.toBe("prepare_canary_request");
      expect(report.results[0]?.blockingReasons).toContain("escalation:not-armed");
    } finally {
      cleanup();
    }
  });

  it("a tampered approval (hand-widened window) is refused outright", () => {
    const { dir, cleanup } = workspace();
    try {
      approve(dir);
      const raw = JSON.parse(readFileSync(join(dir, "approval.json"), "utf8")) as Record<string, unknown>;
      raw.expiresAt = isoAt(24 * 3_600_000);
      writeFileSync(join(dir, "approval.json"), JSON.stringify(raw));
      const r = liveSniperRunReport({ cwd: dir, now: () => isoAt(60_000) }, runOpts(dir, "approval.json"));
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/Refusing/);
    } finally {
      cleanup();
    }
  });

  it("an approval can never help a non-armed mode reach a canary (mode gate holds)", () => {
    const { dir, cleanup } = workspace();
    try {
      approve(dir);
      const r = liveSniperRunReport({ cwd: dir, now: () => isoAt(60_000) }, { ...runOpts(dir, "approval.json"), mode: "paper_shadow" });
      expect(r.exitCode, r.text).toBe(0);
      const report = JSON.parse(r.text) as { results: Array<{ action: string; canaryPreparable: boolean }> };
      expect(report.results[0]?.action).not.toBe("prepare_canary_request");
      expect(report.results[0]?.canaryPreparable).toBe(false);
    } finally {
      cleanup();
    }
  });
});
