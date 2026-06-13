/**
 * Sprint 103 — the paper:phase7:authorization:audit command, run against the REAL repo evidence.
 *
 * The command machine-verifies the cheap structural facts at runtime; this test pins that, against
 * the actual repository, every safety invariant verifies and the honest verdict is
 * `authorized-for-design-only` (safety proven; the devnet broadcast + written sign-off prerequisites
 * are still open). It also pins that no flag can make the artifact claim live readiness.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePhase7AuthorizationAudit } from "@soulmaker/execution";
import { phase7AuthorizationAuditReport } from "./commands.js";

describe("paper:phase7:authorization:audit — real repo evidence", () => {
  it("verifies every safety invariant and reaches authorized-for-design-only (prereqs open)", () => {
    const r = phase7AuthorizationAuditReport({}, { repoSha: "test", json: true });
    expect(r.exitCode).toBe(0);
    const audit = validatePhase7AuthorizationAudit(JSON.parse(r.text));
    expect(audit.verdict).toBe("authorized-for-design-only");
    expect(audit.gateCount).toBe(14);
    expect(audit.gates.every((g) => g.status === "verified")).toBe(true);
    for (const inv of [
      audit.noSendInvariant,
      audit.signerBoundary,
      audit.rustBoundary,
      audit.artifactRedaction,
      audit.releaseCandidate,
      audit.reconciliationWall,
    ]) {
      expect(inv.status).toBe("verified");
    }
    expect(audit.commandSurface.status).toBe("safe");
    // The open prerequisites are the ONLY thing between design-only and ready.
    expect(audit.microTradePrerequisites.every((p) => !p.met)).toBe(true);
    expect(audit.remainingBlockers).toEqual([]);
  });

  it("the artifact never claims live, whatever the verdict", () => {
    const r = phase7AuthorizationAuditReport({}, { json: true, devnetBroadcastConfirmed: true, signOffPresent: true });
    const audit = validatePhase7AuthorizationAudit(JSON.parse(r.text));
    expect(audit.verdict).toBe("ready-for-separate-microtrade-authorization");
    expect(audit.liveExecutionAuthorized).toBe(false);
    expect(audit.authorizesLiveTrading).toBe(false);
    expect(audit.requiresSeparateApproval).toBe(true);
    expect(audit.neverSends).toBe(true);
    expect(audit.phase7LiveTradingReady).toBe(false);
  });

  it("--fail-on-not-ready exits non-zero when the repo is only design-ready", () => {
    const r = phase7AuthorizationAuditReport({}, { failOnNotReady: true });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/AUTHORIZED-FOR-DESIGN-ONLY/);
  });

  it("--out writes the artifact and refuses to overwrite without --force", () => {
    const tmp = mkdtempSync(join(tmpdir(), "phase7-audit-"));
    try {
      const out = join(tmp, "phase7-authorization-audit.json");
      const first = phase7AuthorizationAuditReport({}, { outPath: out, json: true });
      expect(first.exitCode).toBe(0);
      expect(existsSync(out)).toBe(true);
      // The written file is itself a valid, narrow-able artifact.
      validatePhase7AuthorizationAudit(JSON.parse(readFileSync(out, "utf8")));
      // A second write without --force refuses.
      const refuse = phase7AuthorizationAuditReport({}, { outPath: out });
      expect(refuse.exitCode).toBe(1);
      expect(refuse.text).toMatch(/already exists/);
      // With --force it overwrites.
      const forced = phase7AuthorizationAuditReport({}, { outPath: out, force: true });
      expect(forced.exitCode).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the text report shows the verdict, the gate count, and the no-live disclaimers", () => {
    const r = phase7AuthorizationAuditReport({});
    expect(r.text).toMatch(/PHASE 7 LIVE-AUTHORIZATION AUDIT/);
    expect(r.text).toMatch(/14\/14 verified/);
    expect(r.text).toMatch(/authorizes NO live trading/i);
  });
});
