/**
 * Sprint 103 — the Phase 7 authorization audit builder/validator.
 *
 * The artifact MUST default to `not-authorized` and only reach a better verdict when every safety
 * invariant is verified. These tests pin:
 *   - missing gate evidence / unsafe command surface / missing reconciliation wall / missing
 *     redaction proof all force `not-authorized`;
 *   - a complete dry-run RC alone never authorizes live;
 *   - the all-clean fixture may reach `ready-for-separate-microtrade-authorization` — and even then
 *     the artifact's live-execution locks stay literally false;
 *   - the gate set must cover EXACTLY the fourteen real canonical live-gate ids;
 *   - the validator re-derives the verdict and refuses a tampered status / unknown field / flipped lock.
 */

import { describe, it, expect } from "vitest";
import {
  buildPhase7AuthorizationAudit,
  validatePhase7AuthorizationAudit,
  derivePhase7AuthorizationVerdict,
  canonicalLiveGateIds,
  Phase7AuthorizationAuditError,
  PHASE7_AUTHORIZATION_AUDIT_MODE,
  type BuildPhase7AuthorizationAuditInput,
  type Phase7AuditInvariant,
} from "./phase7-authorization-audit.js";

function verifiedInvariant(evidence: string): Phase7AuditInvariant {
  return { status: "verified", evidence, detail: null };
}

/** A fully-clean audit input: every invariant verified, all fourteen gates verified, prereqs met. */
function cleanInput(): BuildPhase7AuthorizationAuditInput {
  const gates = canonicalLiveGateIds().map((gateId) => ({
    gateId,
    name: `gate ${gateId}`,
    defaultState: "blocked",
    evidenceSource: "packages/execution/src/live-gate.ts",
    failClosedProven: true,
    testCoverageRef: "packages/execution/src/live-gate.test.ts",
    status: "verified" as const,
    blocker: null,
  }));
  return {
    auditId: "s103-audit-fixture",
    repoSha: "e607238",
    auditedAt: "2026-06-13T00:00:00.000Z",
    gates,
    noSendInvariant: verifiedInvariant("apps/cli/src/command-surface-audit.test.ts"),
    signerBoundary: verifiedInvariant("packages/execution/src/signer.ts"),
    rustBoundary: verifiedInvariant("crates/solmaker-engine/tests/safety_scan.rs"),
    artifactRedaction: verifiedInvariant("packages/security/src/redact.ts"),
    releaseCandidate: verifiedInvariant("apps/cli/src/release-candidate-safety.test.ts"),
    reconciliationWall: verifiedInvariant("packages/execution/src/session.ts"),
    commandSurface: { status: "safe", evidence: "apps/cli/src/command-surface-audit.test.ts", detail: null },
    microTradePrerequisites: [
      { id: "devnet-broadcast", description: "a devnet broadcast confirmed + reconciled", met: true, detail: null },
      { id: "written-sign-off", description: "a written Phase 7 sign-off exists", met: true, detail: null },
    ],
  };
}

describe("phase7 audit — defaults and the clean path", () => {
  it("the all-clean fixture reaches ready-for-separate-microtrade-authorization", () => {
    const audit = buildPhase7AuthorizationAudit(cleanInput());
    expect(audit.verdict).toBe("ready-for-separate-microtrade-authorization");
    expect(audit.gateCount).toBe(14);
    expect(audit.remainingBlockers).toEqual([]);
    // ...and even the best verdict authorizes NOTHING.
    expect(audit.liveExecutionAuthorized).toBe(false);
    expect(audit.authorizesLiveTrading).toBe(false);
    expect(audit.requiresSeparateApproval).toBe(true);
    expect(audit.neverSends).toBe(true);
    expect(audit.phase7LiveTradingReady).toBe(false);
    expect(audit.auditedMode).toBe(PHASE7_AUTHORIZATION_AUDIT_MODE);
    expect(() => validatePhase7AuthorizationAudit(audit)).not.toThrow();
  });

  it("an open operational prerequisite drops the verdict to authorized-for-design-only", () => {
    const input = cleanInput();
    input.microTradePrerequisites[0]!.met = false; // devnet broadcast not yet landed
    const audit = buildPhase7AuthorizationAudit(input);
    expect(audit.verdict).toBe("authorized-for-design-only");
    expect(audit.liveExecutionAuthorized).toBe(false);
    expect(audit.nextSafeAction).toMatch(/operational prerequisite/i);
  });
});

describe("phase7 audit — any safety gap forces not-authorized", () => {
  it("missing gate evidence (no test coverage ref) → not-authorized", () => {
    const input = cleanInput();
    input.gates[3]!.testCoverageRef = null;
    const audit = buildPhase7AuthorizationAudit(input);
    expect(audit.verdict).toBe("not-authorized");
    expect(audit.remainingBlockers.join(" ")).toMatch(/no test coverage reference/);
  });

  it("a gate whose fail-closed behavior is unproven → not-authorized", () => {
    const input = cleanInput();
    input.gates[7]!.failClosedProven = false;
    expect(buildPhase7AuthorizationAudit(input).verdict).toBe("not-authorized");
  });

  it("an unsafe command surface → not-authorized", () => {
    const input = cleanInput();
    input.commandSurface = { status: "unsafe", evidence: "scan", detail: "a mainnet send command appeared" };
    const audit = buildPhase7AuthorizationAudit(input);
    expect(audit.verdict).toBe("not-authorized");
    expect(audit.remainingBlockers.join(" ")).toMatch(/command-surface/);
  });

  it("a missing reconciliation wall → not-authorized", () => {
    const input = cleanInput();
    input.reconciliationWall = { status: "unverified", evidence: "session.ts", detail: "wall not proven" };
    const audit = buildPhase7AuthorizationAudit(input);
    expect(audit.verdict).toBe("not-authorized");
    expect(audit.remainingBlockers.join(" ")).toMatch(/reconciliation-wall/);
  });

  it("a missing redaction proof → not-authorized", () => {
    const input = cleanInput();
    input.artifactRedaction = { status: "failed", evidence: "redact.ts", detail: "a secret leaked" };
    const audit = buildPhase7AuthorizationAudit(input);
    expect(audit.verdict).toBe("not-authorized");
    expect(audit.remainingBlockers.join(" ")).toMatch(/artifact-redaction/);
  });

  it("a failed no-send invariant → not-authorized", () => {
    const input = cleanInput();
    input.noSendInvariant = { status: "failed", evidence: "x", detail: "a send seam became reachable" };
    expect(buildPhase7AuthorizationAudit(input).verdict).toBe("not-authorized");
  });

  it("an explicit additional blocker → not-authorized even with everything else clean", () => {
    const input = cleanInput();
    input.additionalBlockers = ["a reviewer flagged an unresolved live-path concern"];
    const audit = buildPhase7AuthorizationAudit(input);
    expect(audit.verdict).toBe("not-authorized");
    expect(audit.remainingBlockers).toContain("a reviewer flagged an unresolved live-path concern");
  });

  it("a complete release-candidate alone (every other invariant unverified) does NOT authorize live", () => {
    const input = cleanInput();
    // Only the RC is verified; everything else is unverified — a green dry-run RC must not rescue it.
    const unverified: Phase7AuditInvariant = { status: "unverified", evidence: "x", detail: null };
    input.noSendInvariant = unverified;
    input.signerBoundary = unverified;
    input.rustBoundary = unverified;
    input.artifactRedaction = unverified;
    input.reconciliationWall = unverified;
    const audit = buildPhase7AuthorizationAudit(input);
    expect(audit.releaseCandidate.status).toBe("verified");
    expect(audit.verdict).toBe("not-authorized");
  });
});

describe("phase7 audit — the gate set must cover the real fourteen", () => {
  it("a gate set missing a canonical id cannot reach a clean verdict", () => {
    const input = cleanInput();
    input.gates = input.gates.slice(0, 13); // drop one
    expect(buildPhase7AuthorizationAudit(input).verdict).toBe("not-authorized");
  });

  it("a gate set with a duplicate / wrong id cannot reach a clean verdict", () => {
    const input = cleanInput();
    input.gates[0]!.gateId = input.gates[1]!.gateId; // duplicate -> no longer covers all 14
    expect(buildPhase7AuthorizationAudit(input).verdict).toBe("not-authorized");
  });

  it("the canonical gate ids are exactly the fourteen live-gate conditions", () => {
    const ids = canonicalLiveGateIds();
    expect(ids.length).toBe(14);
    expect(ids).toContain("audit-and-redaction");
    expect(ids).toContain("signer-boundary");
    expect(new Set(ids).size).toBe(14);
  });
});

describe("phase7 audit — derivation is pure and default-blocked", () => {
  it("an all-false evidence object derives not-authorized", () => {
    expect(
      derivePhase7AuthorizationVerdict({
        commandSurfaceSafe: false,
        invariantsVerified: false,
        gatesCoverCanonicalFourteen: false,
        gatesAllVerified: false,
        noOpenBlockers: false,
        prerequisitesPresent: false,
        prerequisitesAllMet: false,
      }),
    ).toBe("not-authorized");
  });

  it("safety verified but no prerequisites present → design-only (never ready)", () => {
    expect(
      derivePhase7AuthorizationVerdict({
        commandSurfaceSafe: true,
        invariantsVerified: true,
        gatesCoverCanonicalFourteen: true,
        gatesAllVerified: true,
        noOpenBlockers: true,
        prerequisitesPresent: false,
        prerequisitesAllMet: true,
      }),
    ).toBe("authorized-for-design-only");
  });
});

describe("phase7 audit — the validator is a parity + tamper wall", () => {
  it("an unknown field is refused (closed schema)", () => {
    const audit = buildPhase7AuthorizationAudit(cleanInput()) as unknown as Record<string, unknown>;
    audit.liveSendApproved = true;
    expect(() => validatePhase7AuthorizationAudit(audit)).toThrow(/unknown field/i);
  });

  it("a tampered verdict that outruns the evidence is refused", () => {
    const input = cleanInput();
    input.commandSurface = { status: "unsafe", evidence: "x", detail: "leak" };
    const audit = buildPhase7AuthorizationAudit(input) as unknown as Record<string, unknown>;
    expect(audit.verdict).toBe("not-authorized");
    audit.verdict = "ready-for-separate-microtrade-authorization"; // lie
    expect(() => validatePhase7AuthorizationAudit(audit)).toThrow(/re-derived from the echoed evidence/);
  });

  it("each flipped safety lock is refused", () => {
    for (const [field, bad] of [
      ["liveExecutionAuthorized", true],
      ["authorizesLiveTrading", true],
      ["requiresSeparateApproval", false],
      ["neverSends", false],
      ["phase7LiveTradingReady", true],
    ] as const) {
      const audit = buildPhase7AuthorizationAudit(cleanInput()) as unknown as Record<string, unknown>;
      audit[field] = bad;
      expect(() => validatePhase7AuthorizationAudit(audit), field).toThrow(Phase7AuthorizationAuditError);
    }
  });

  it("a secret-shaped evidence string is refused at build time", () => {
    const input = cleanInput();
    input.signerBoundary = { status: "verified", evidence: "5".repeat(96), detail: null };
    expect(() => buildPhase7AuthorizationAudit(input)).toThrow(/secret-shaped/);
  });

  it("a flipped auditedMode is refused", () => {
    const audit = buildPhase7AuthorizationAudit(cleanInput()) as unknown as Record<string, unknown>;
    audit.auditedMode = "live-authorization-granted";
    expect(() => validatePhase7AuthorizationAudit(audit)).toThrow(/auditedMode/);
  });
});
