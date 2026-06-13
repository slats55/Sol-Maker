/**
 * Sprint 103-B — `paper:phase7:authorization:audit` consuming devnet + sign-off evidence.
 *
 * The audit may optionally read a devnet funding-status, a devnet reconciliation report, and a Phase 7
 * sign-off record. These tests pin the HONEST gating:
 *   - no evidence -> authorized-for-design-only (the repo's real current state; prereqs open);
 *   - a funding-blocked funding-status alone keeps it design-only (funding != broadcast);
 *   - a reconciliation that is NOT verdict=reconciled keeps the broadcast prereq open;
 *   - an unsigned / design-only sign-off keeps the sign-off prereq open;
 *   - ONLY a reconciled devnet broadcast AND a signed-for-controlled-microtrade record reach
 *     ready-for-separate-microtrade-authorization — and even then every live-execution lock holds;
 *   - invalid evidence is refused, never silently ignored.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDevnetFundingStatus,
  buildReconciliationReport,
  buildPhase7HumanSignoff,
  validatePhase7AuthorizationAudit,
  requiredAcknowledgementsFor,
  type BalanceSnapshot,
  type ConfirmationTrackResult,
  type ExpectedEffect,
} from "@soulmaker/execution";
import { phase7AuthorizationAuditReport } from "./commands.js";

const PUBKEY = "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm";
const MICRO_ACKS = requiredAcknowledgementsFor("controlled-mainnet-microtrade-only").map((a) => a.id);
const DESIGN_ACKS = requiredAcknowledgementsFor("design-review-only").map((a) => a.id);

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "p7-evidence-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeJson(tmp: string, name: string, value: unknown): string {
  const path = join(tmp, name);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

function snapshot(label: "pre" | "post", lamports: number): BalanceSnapshot {
  return { label, observedAt: "2026-06-13T00:00:00.000Z", ownerPublicKey: PUBKEY, sol: { lamports, status: "observed", errLabel: null }, token: null };
}

/** A REAL reconciled devnet reconciliation report (confirmed; SOL fell by exactly the fee). */
function reconciledReport() {
  const confirmation: ConfirmationTrackResult = {
    outcome: "confirmed",
    signature: "ReconciledDevnetSig1111111111111111111111111",
    slot: 100,
    errLabel: null,
    polls: 1,
    guidance: "confirmed",
  };
  const expected: ExpectedEffect = { kind: "self-transfer-probe", summary: "self-transfer probe", maxFeeLamports: 10_000 };
  return buildReconciliationReport({
    mode: "devnet-execution",
    network: "devnet",
    sessionId: "test-session",
    command: "execution:devnet:rehearse",
    signature: "ReconciledDevnetSig1111111111111111111111111",
    confirmation,
    pre: snapshot("pre", 1_000_000_000),
    post: snapshot("post", 999_995_000),
    expected,
    feeEstimatedLamports: 5000,
    feeActualLamports: 5000,
    clock: () => "2026-06-13T00:00:02.000Z",
  });
}

function signedMicroRecord() {
  return buildPhase7HumanSignoff({
    repoSha: "e607238",
    targetScope: "controlled-mainnet-microtrade-only",
    acknowledgedIds: MICRO_ACKS,
    operatorLabel: "operator-a",
    signedAtLabel: "2026-06-13",
    maxSpendLamports: 1_000_000,
  });
}

function audit(opts: Record<string, unknown>) {
  const r = phase7AuthorizationAuditReport({}, { repoSha: "test", json: true, ...opts });
  return { exitCode: r.exitCode, text: r.text };
}

describe("phase7 audit — evidence integration", () => {
  it("no evidence: authorized-for-design-only with both prerequisites open", () => {
    const r = audit({});
    expect(r.exitCode).toBe(0);
    const a = validatePhase7AuthorizationAudit(JSON.parse(r.text));
    expect(a.verdict).toBe("authorized-for-design-only");
    expect(a.microTradePrerequisites.every((p) => !p.met)).toBe(true);
  });

  it("a funding-blocked funding-status alone keeps it design-only (funding is not a broadcast)", () => {
    withTmp((tmp) => {
      const fs = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "observed", lamports: 0 } });
      const path = writeJson(tmp, "funding.json", fs);
      const a = validatePhase7AuthorizationAudit(JSON.parse(audit({ devnetFundingStatusPath: path }).text));
      expect(a.verdict).toBe("authorized-for-design-only");
      const broadcast = a.microTradePrerequisites.find((p) => p.id === "devnet-broadcast-confirmed")!;
      expect(broadcast.met).toBe(false);
      expect(broadcast.detail).toContain("unfunded");
    });
  });

  it("a non-reconciled reconciliation keeps the broadcast prerequisite open", () => {
    withTmp((tmp) => {
      // funding-blocked reconciliation: verdict != reconciled
      const recon = buildReconciliationReport({
        mode: "devnet-execution",
        network: "devnet",
        sessionId: "s",
        fundingBlocked: true,
        expected: { kind: "self-transfer-probe", summary: "probe", maxFeeLamports: 10_000 },
        clock: () => "2026-06-13T00:00:00.000Z",
      });
      const path = writeJson(tmp, "recon.json", recon);
      const a = validatePhase7AuthorizationAudit(JSON.parse(audit({ devnetReconciliationPath: path }).text));
      expect(a.verdict).toBe("authorized-for-design-only");
      expect(a.microTradePrerequisites.find((p) => p.id === "devnet-broadcast-confirmed")!.met).toBe(false);
    });
  });

  it("an unsigned / design-only sign-off keeps the sign-off prerequisite open", () => {
    withTmp((tmp) => {
      const designOnly = buildPhase7HumanSignoff({
        targetScope: "design-review-only",
        acknowledgedIds: DESIGN_ACKS,
        operatorLabel: "operator-a",
        signedAtLabel: "2026-06-13",
      });
      const path = writeJson(tmp, "signoff.json", designOnly);
      const a = validatePhase7AuthorizationAudit(JSON.parse(audit({ signOffRecordPath: path }).text));
      expect(a.verdict).toBe("authorized-for-design-only");
      const signoff = a.microTradePrerequisites.find((p) => p.id === "written-sign-off")!;
      expect(signoff.met).toBe(false);
      expect(signoff.detail).toContain("signed-for-s104-design");
    });
  });

  it("a reconciled broadcast WITHOUT a sign-off is still design-only — and every live lock holds", () => {
    withTmp((tmp) => {
      // Sprint 103-C: the real funded devnet proof satisfies the devnet prerequisite, but the
      // written human sign-off is still open. The verdict must stay design-only and NO live lock
      // may flip just because the devnet broadcast landed.
      const path = writeJson(tmp, "recon.json", reconciledReport());
      const a = validatePhase7AuthorizationAudit(JSON.parse(audit({ devnetReconciliationPath: path }).text));
      expect(a.verdict).toBe("authorized-for-design-only");
      expect(a.microTradePrerequisites.find((p) => p.id === "devnet-broadcast-confirmed")!.met).toBe(true);
      expect(a.microTradePrerequisites.find((p) => p.id === "written-sign-off")!.met).toBe(false);
      // The intermediate state (devnet met, sign-off missing) keeps every live-execution lock down.
      expect(a.liveExecutionAuthorized).toBe(false);
      expect(a.authorizesLiveTrading).toBe(false);
      expect(a.requiresSeparateApproval).toBe(true);
      expect(a.neverSends).toBe(true);
      expect(a.phase7LiveTradingReady).toBe(false);
    });
  });

  it("a reconciled broadcast AND a signed-for-controlled-microtrade record reach READY — locks still hold", () => {
    withTmp((tmp) => {
      const reconPath = writeJson(tmp, "recon.json", reconciledReport());
      const signoffPath = writeJson(tmp, "signoff.json", signedMicroRecord());
      const fundingPath = writeJson(tmp, "funding.json", buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "observed", lamports: 1_000_000_000 } }));
      const r = audit({ devnetReconciliationPath: reconPath, signOffRecordPath: signoffPath, devnetFundingStatusPath: fundingPath });
      const a = validatePhase7AuthorizationAudit(JSON.parse(r.text));
      expect(a.verdict).toBe("ready-for-separate-microtrade-authorization");
      expect(a.microTradePrerequisites.every((p) => p.met)).toBe(true);
      // The strongest verdict STILL authorizes nothing.
      expect(a.liveExecutionAuthorized).toBe(false);
      expect(a.authorizesLiveTrading).toBe(false);
      expect(a.requiresSeparateApproval).toBe(true);
      expect(a.neverSends).toBe(true);
      expect(a.phase7LiveTradingReady).toBe(false);
    });
  });

  it("refuses invalid evidence rather than silently ignoring it", () => {
    withTmp((tmp) => {
      const bad = writeJson(tmp, "bad.json", { schemaVersion: "not.a.real.schema", verdict: "reconciled" });
      const r = phase7AuthorizationAuditReport({}, { repoSha: "test", devnetReconciliationPath: bad });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("Refusing");

      const badSignoff = writeJson(tmp, "badsig.json", { schemaVersion: "phase7.human_signoff.record.v1" });
      const r2 = phase7AuthorizationAuditReport({}, { repoSha: "test", signOffRecordPath: badSignoff });
      expect(r2.exitCode).toBe(1);
      expect(r2.text).toContain("Refusing");
    });
  });

  it("a mainnet reconciliation is refused (devnet only)", () => {
    withTmp((tmp) => {
      const recon = reconciledReport() as unknown as Record<string, unknown>;
      recon.network = "mainnet-beta";
      const path = writeJson(tmp, "recon.json", recon);
      const r = phase7AuthorizationAuditReport({}, { repoSha: "test", devnetReconciliationPath: path });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("not devnet");
    });
  });
});
