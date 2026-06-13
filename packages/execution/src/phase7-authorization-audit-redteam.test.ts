/**
 * Sprint 103 — red-team the Phase 7 authorization audit artifact.
 *
 * The audit is the ONE artifact that could imply live readiness, so it gets the hardest treatment.
 * These attacks must never make the artifact claim more than its evidence supports, never echo a
 * secret, and never corrupt output:
 *   - control characters / NUL / BOM / line separators are refused;
 *   - secret-shaped evidence (base58/base64/hex blobs, bearer/mnemonic) is refused or redacted;
 *   - overlarge strings / lists are refused;
 *   - no tampered status / verdict / lock survives the validator;
 *   - hostile evidence can never promote the verdict to ready / authorize live.
 *
 * Control characters below are constructed with \u escapes ON PURPOSE — no literal control byte is
 * ever embedded in this source (see the Write-tool NUL-byte hazard).
 */

import { describe, it, expect } from "vitest";
import {
  buildPhase7AuthorizationAudit,
  validatePhase7AuthorizationAudit,
  canonicalLiveGateIds,
  type BuildPhase7AuthorizationAuditInput,
} from "./phase7-authorization-audit.js";

const NUL = "\u0000";
const BOM = "\ufeff";
const LINE_SEP = "\u2028";

function cleanInput(): BuildPhase7AuthorizationAuditInput {
  const gates = canonicalLiveGateIds().map((gateId) => ({
    gateId,
    name: `gate ${gateId}`,
    defaultState: "blocked",
    evidenceSource: "packages/execution/src/live-gate.ts",
    failClosedProven: true,
    testCoverageRef: "t.test.ts",
    status: "verified" as const,
    blocker: null,
  }));
  const verified = { status: "verified" as const, evidence: "e", detail: null };
  return {
    auditId: "rt",
    repoSha: "deadbeef",
    auditedAt: "2026-06-13T00:00:00.000Z",
    gates,
    noSendInvariant: verified,
    signerBoundary: verified,
    rustBoundary: verified,
    artifactRedaction: verified,
    releaseCandidate: verified,
    reconciliationWall: verified,
    commandSurface: { status: "safe", evidence: "e", detail: null },
    microTradePrerequisites: [{ id: "p", description: "p", met: true, detail: null }],
  };
}

describe("phase7 audit red-team — control characters / NUL / BOM", () => {
  it("a NUL byte in any string field is refused", () => {
    const input = cleanInput();
    input.auditId = `audit${NUL}id`;
    expect(() => buildPhase7AuthorizationAudit(input)).toThrow(/control character, NUL, or BOM/);
  });

  it("a BOM in a prose field is refused", () => {
    const input = cleanInput();
    input.commandSurface = { status: "safe", evidence: "e", detail: `clean${BOM}surface` };
    expect(() => buildPhase7AuthorizationAudit(input)).toThrow(/control character, NUL, or BOM/);
  });

  it("a line separator in an evidence path is refused", () => {
    const input = cleanInput();
    input.signerBoundary = { status: "verified", evidence: `path${LINE_SEP}b`, detail: null };
    expect(() => buildPhase7AuthorizationAudit(input)).toThrow(/control character, NUL, or BOM/);
  });
});

describe("phase7 audit red-team — secret-shaped + blob injection", () => {
  it("a long base58 key blob in an evidence (identifier) field is refused", () => {
    const input = cleanInput();
    input.releaseCandidate = { status: "verified", evidence: "5".repeat(96), detail: null };
    expect(() => buildPhase7AuthorizationAudit(input)).toThrow(/secret-shaped/);
  });

  it("a long hex blob in an identifier field is refused", () => {
    const input = cleanInput();
    input.auditId = "a".repeat(64); // 64 hex chars -> matches the redactor's hex-blob pattern
    expect(() => buildPhase7AuthorizationAudit(input)).toThrow(/secret-shaped/);
  });

  it("a base58 blob smuggled into PROSE is redacted, never echoed verbatim", () => {
    const blob = "z".repeat(96);
    const input = cleanInput();
    input.commandSurface = { status: "safe", evidence: "e", detail: `surface ${blob} clean` };
    const audit = buildPhase7AuthorizationAudit(input);
    expect(audit.commandSurface.detail).not.toContain(blob);
    expect(audit.commandSurface.detail).toContain("[REDACTED]");
  });
});

describe("phase7 audit red-team — overlarge inputs", () => {
  it("an overlarge identifier is refused", () => {
    const input = cleanInput();
    input.auditId = "a".repeat(500);
    expect(() => buildPhase7AuthorizationAudit(input)).toThrow(/exceeds/);
  });

  it("too many gates are refused", () => {
    const input = cleanInput();
    input.gates = Array.from({ length: 65 }, (_, i) => ({ ...input.gates[0]!, gateId: `g${i}` }));
    expect(() => buildPhase7AuthorizationAudit(input)).toThrow(/exceeds/);
  });
});

describe("phase7 audit red-team — no tampered artifact survives the validator", () => {
  it("promoting the verdict of a genuinely not-authorized artifact is caught", () => {
    const input = cleanInput();
    input.gates = input.gates.slice(0, 10); // missing canonical ids
    const forged = buildPhase7AuthorizationAudit(input) as unknown as Record<string, unknown>;
    expect(forged.verdict).toBe("not-authorized");
    forged.verdict = "ready-for-separate-microtrade-authorization";
    expect(() => validatePhase7AuthorizationAudit(forged)).toThrow(/re-derived from the echoed evidence/);
  });

  it("a duplicate gate id cannot be laundered into a ready verdict", () => {
    const audit = buildPhase7AuthorizationAudit(cleanInput()) as unknown as Record<string, unknown>;
    const gates = audit.gates as Array<{ gateId: string }>;
    gates[1]!.gateId = gates[0]!.gateId; // duplicate -> no longer covers all 14 canonical ids
    expect(() => validatePhase7AuthorizationAudit(audit)).toThrow(/re-derived from the echoed evidence/);
  });

  it("injecting a control character into a built artifact is refused on validation", () => {
    const audit = buildPhase7AuthorizationAudit(cleanInput()) as unknown as Record<string, unknown>;
    audit.auditId = `x${NUL}y`;
    expect(() => validatePhase7AuthorizationAudit(audit)).toThrow(/control character/);
  });

  it("a stray send-result field is refused (closed schema, no send evidence can ride along)", () => {
    for (const field of ["signature", "sendResult", "txid", "slot", "armed"]) {
      const audit = buildPhase7AuthorizationAudit(cleanInput()) as unknown as Record<string, unknown>;
      audit[field] = "x";
      expect(() => validatePhase7AuthorizationAudit(audit), field).toThrow(/unknown field/i);
    }
  });
});
