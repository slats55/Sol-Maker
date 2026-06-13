/**
 * Sprint 103-B — the sniper operator demo manifest builder/validator.
 *
 * Pins: provenance labels are preserved; counts + allArtifactsValid are RE-DERIVED; every stage must
 * reference a present artifact role; the live-disabled + neverSends locks hold; closed-schema parity.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperOperatorDemoManifest,
  validateSniperOperatorDemoManifest,
  SniperOperatorDemoManifestError,
  type BuildSniperOperatorDemoManifestInput,
} from "./operator-demo-manifest.js";

function input(overrides: Partial<BuildSniperOperatorDemoManifestInput> = {}): BuildSniperOperatorDemoManifestInput {
  return {
    demoId: "demo-1",
    generatedAt: "2026-06-13T00:00:00.000Z",
    artifacts: [
      { role: "phase7-authorization-audit", fileName: "phase7-authorization-audit.json", schemaVersion: "phase7.authorization.audit.v1", evidenceClass: "real-readonly", present: true, valid: true, summary: "the real repo Phase 7 audit" },
      { role: "phase7-human-signoff", fileName: "phase7-signoff-template.json", schemaVersion: "phase7.human_signoff.record.v1", evidenceClass: "real-readonly", present: true, valid: true, summary: "a blank sign-off template" },
      { role: "devnet-funding-status", fileName: "devnet-funding-status.json", schemaVersion: "execution.devnet.funding_status.v1", evidenceClass: "fixture", present: true, valid: true, summary: "an honest funding-blocked snapshot" },
      { role: "mainnet-dry-run-release-candidate", fileName: "release-candidate.json", schemaVersion: "sniper.mainnet_dryrun.release_candidate.v1", evidenceClass: "fictional-example", present: true, valid: true, summary: "a no-send release candidate over fictional mints" },
    ],
    stages: [
      { stage: "candidate-ranking", description: "candidates scored + ranked", evidencedBy: "mainnet-dry-run-release-candidate" },
      { stage: "phase7-audit", description: "the read-only authorization audit", evidencedBy: "phase7-authorization-audit" },
      { stage: "devnet-funding", description: "devnet funding status", evidencedBy: "devnet-funding-status" },
      { stage: "live-disabled", description: "live execution disabled", evidencedBy: "phase7-human-signoff" },
    ],
    ...overrides,
  };
}

describe("sniper operator demo manifest", () => {
  it("builds a valid manifest with re-derived counts and live disabled", () => {
    const m = buildSniperOperatorDemoManifest(input());
    expect(m.artifactCount).toBe(4);
    expect(m.realReadonlyCount).toBe(2);
    expect(m.fixtureCount).toBe(1);
    expect(m.fictionalExampleCount).toBe(1);
    expect(m.allArtifactsValid).toBe(true);
    expect(m.liveExecutionDisabled).toBe(true);
    expect(m.neverSends).toBe(true);
    expect(m.phase7LiveTradingReady).toBe(false);
    expect(() => validateSniperOperatorDemoManifest(m)).not.toThrow();
  });

  it("allArtifactsValid is false when any artifact is missing/invalid", () => {
    const i = input();
    i.artifacts[2]!.valid = false;
    const m = buildSniperOperatorDemoManifest(i);
    expect(m.allArtifactsValid).toBe(false);
    expect(m.nextSafeAction).toContain("missing or invalid");
  });

  it("refuses a stage that references a non-present artifact role", () => {
    const i = input();
    i.stages[0]!.evidencedBy = "no-such-role";
    expect(() => buildSniperOperatorDemoManifest(i)).toThrow(/not a present artifact role/);
  });

  it("refuses an unknown evidenceClass and duplicate roles", () => {
    const i = input();
    (i.artifacts[0] as unknown as Record<string, unknown>).evidenceClass = "live-trade";
    expect(() => buildSniperOperatorDemoManifest(i)).toThrow(SniperOperatorDemoManifestError);

    const dup = input();
    dup.artifacts[1]!.role = dup.artifacts[0]!.role;
    expect(() => buildSniperOperatorDemoManifest(dup)).toThrow(/unique/);
  });

  it("validator refuses an unknown field, a tampered count, and a flipped lock", () => {
    const m = buildSniperOperatorDemoManifest(input()) as unknown as Record<string, unknown>;
    const unknown = { ...m, extra: "x" };
    expect(() => validateSniperOperatorDemoManifest(unknown)).toThrow(/CLOSED/);

    const badCount = { ...m, realReadonlyCount: 99 };
    expect(() => validateSniperOperatorDemoManifest(badCount)).toThrow(/re-derived/);

    const flipped = { ...m, liveExecutionDisabled: false };
    expect(() => validateSniperOperatorDemoManifest(flipped)).toThrow(/liveExecutionDisabled/);
  });
});
