/**
 * Sprint 103-B — typed views for the devnet funding-status, Phase 7 sign-off, and operator demo
 * manifest schemas, plus registry recognition.
 */

import { describe, expect, it } from "vitest";
import { hasTypedView, renderTypedArtifactView } from "../src/components/artifact-views.js";
import { renderToString } from "../src/lib/html.js";
import { normalizeArtifact } from "../src/lib/local-artifact.js";
import { isKnownSchema } from "../src/lib/report-types.js";

function typed(raw: unknown): string {
  const view = renderTypedArtifactView(normalizeArtifact(raw), raw);
  expect(view).not.toBeNull();
  return renderToString(view!);
}

describe("S103-B schemas are recognized and ship typed views", () => {
  it.each([
    "execution.devnet.funding_status.v1",
    "phase7.human_signoff.record.v1",
    "sniper.operator_demo.manifest.v1",
  ])("%s is in the registry with a typed view", (id) => {
    expect(isKnownSchema(id)).toBe(true);
    expect(hasTypedView(id)).toBe(true);
  });
});

describe("execution.devnet.funding_status.v1 typed view", () => {
  it("renders the status, balance, and re-derived funded flag with the no-mainnet framing", () => {
    const html = typed({
      schemaVersion: "execution.devnet.funding_status.v1",
      network: "devnet",
      publicKey: "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm",
      fundingSourceStatus: "unfunded",
      lamports: 0,
      solBalance: 0,
      minimumRequiredLamports: 100000,
      funded: false,
      canBroadcastDevnetProbe: false,
      faucetAttemptSummary: null,
      nextSafeAction: "Fund the key with valueless DEVNET SOL",
      caveats: ["Devnet SOL is valueless"],
      neverMainnet: true,
      phase7LiveTradingReady: false,
    });
    expect(html).toContain("never touches mainnet");
    expect(html).toContain("unfunded");
    expect(html).toContain("8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm");
    expect(html).toContain("100");
    expect(html).toContain("Fund the key");
  });
});

describe("phase7.human_signoff.record.v1 typed view", () => {
  it("renders the status, scope, acknowledgements checklist, and the no-authorization framing", () => {
    const html = typed({
      schemaVersion: "phase7.human_signoff.record.v1",
      recordId: "demo",
      repoSha: "e607238",
      targetScope: "controlled-mainnet-microtrade-only",
      signoffStatus: "template-only",
      grantedScope: "none",
      requiredAcknowledgements: [
        { id: "read-dossier", text: "I have read the dossier." },
        { id: "burner-wallet-only", text: "Burner wallet only." },
      ],
      acknowledgedAcknowledgementIds: ["read-dossier"],
      missingAcknowledgements: ["burner-wallet-only"],
      operatorLabel: null,
      signedAtLabel: null,
      maxSpendLamports: null,
      maxSpendSol: null,
      nextSafeAction: "A human must read the dossier and re-run with acknowledgements.",
      authorizesLiveExecution: false,
      requiresSeparateExecutionSprint: true,
      neverSends: true,
      phase7LiveTradingReady: false,
    });
    expect(html).toContain("authorizes NO live trade by itself");
    expect(html).toContain("template-only");
    expect(html).toContain("read-dossier");
    expect(html).toContain("Burner wallet only.");
    expect(html).toContain("✓");
    expect(html).toContain("✗");
  });
});

describe("sniper.operator_demo.manifest.v1 typed view", () => {
  it("renders the artifact + stage tables, the provenance counts, and the live-disabled framing", () => {
    const html = typed({
      schemaVersion: "sniper.operator_demo.manifest.v1",
      demoId: "showcase",
      generatedAt: "2026-06-13T00:00:00.000Z",
      liveExecutionDisabled: true,
      whyLiveDisabled: "the fourteen-condition gate defaults blocked",
      pipelineStages: [{ stage: "phase7-audit", description: "the read-only audit", evidencedBy: "phase7-authorization-audit" }],
      stageCount: 1,
      artifacts: [
        { role: "phase7-authorization-audit", fileName: "phase7-authorization-audit.json", schemaVersion: "phase7.authorization.audit.v1", evidenceClass: "real-readonly", present: true, valid: true, summary: "the real audit" },
        { role: "release-candidate", fileName: "release-candidate.json", schemaVersion: "sniper.mainnet_dryrun.release_candidate.v1", evidenceClass: "fictional-example", present: true, valid: true, summary: "fictional RC" },
      ],
      artifactCount: 2,
      realReadonlyCount: 1,
      fixtureCount: 0,
      fictionalExampleCount: 1,
      allArtifactsValid: true,
      nextSafeAction: "Inspect with web:inspect --dir",
      caveats: ["fictional mints"],
      neverSends: true,
      phase7LiveTradingReady: false,
    });
    expect(html).toContain("live execution is disabled");
    expect(html).toContain("showcase");
    expect(html).toContain("phase7-authorization-audit");
    expect(html).toContain("real-readonly");
    expect(html).toContain("fictional-example");
    expect(html).toContain("the fourteen-condition gate defaults blocked");
  });
});
