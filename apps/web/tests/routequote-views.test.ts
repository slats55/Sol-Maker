/**
 * Sprint 91 — read-only route quote state in the web UI.
 *
 * Pins, over small synthetic artifacts (valid = parseable JSON for the folder index; every value
 * the models read is verbatim):
 *   - typed views exist for routequote.prepared.v1 and routequote.observation.input.v1, lead with
 *     the observation-only framing, and surface the mandatory caveats;
 *   - the pipeline route stage is no longer always muted: `unresolved` + an attempted resolver
 *     renders as review with the quote framing (and `unavailable` stays the honest boundary);
 *   - candidate rows carry a per-candidate route status (prepared quoteStatus wins over the
 *     route-resolution entry status);
 *   - the observability panel carries the route quote fact (source id; never-executable note);
 *   - the candidate table renders the Route quote column;
 *   - the capability strip still shows live trading disabled and the route resolver as a boundary.
 */

import { describe, expect, it } from "vitest";
import { buildFolderIndex, type FolderInputEntry } from "../src/lib/folder-index.js";
import { buildDryRunOverview, routeStatusExplanation } from "../src/lib/dry-run-overview.js";
import {
  buildCandidateRows,
  buildObservabilityFacts,
  buildPipelineStages,
  SNIPER_CAPABILITIES,
} from "../src/lib/command-center.js";
import { hasTypedView, renderTypedArtifactView } from "../src/components/artifact-views.js";
import { CandidateIntelTable } from "../src/components/command-center.js";
import { renderToString } from "../src/lib/html.js";
import { normalizeArtifact } from "../src/lib/local-artifact.js";

function typed(raw: unknown): string {
  const view = renderTypedArtifactView(normalizeArtifact(raw), raw);
  expect(view).not.toBeNull();
  return renderToString(view!);
}

const OPTS = { hasTypedView } as const;

const FICA = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
const FICB = "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn";
const WSOL = "So11111111111111111111111111111111111111112";

function preparedArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "routequote.prepared.v1",
    resolverId: "routequote-operator-supplied",
    sourceLabel: "fictional-routequote",
    candidateListRef: "candidates.json",
    entryCount: 2,
    observedCount: 1,
    unavailableCount: 1,
    blockedCount: 0,
    errorCount: 0,
    unsupportedCount: 0,
    validationStatus: "valid-with-warnings",
    phase7LiveTradingReady: false,
    caveats: [
      "Read-only quote observation only — NOT executable, NOT a transaction, NOT an order.",
      "A quote may expire at any moment; slippage is NOT guaranteed; the route was NOT simulated.",
    ],
    entries: [
      {
        candidateId: "c-a",
        mint: FICA,
        quoteStatus: "quote-observed",
        routeLabel: `read-only quote (operator-supplied): ${WSOL} -> ${FICA} — NOT executable`,
        feeLabel: "0.3% pool fee (label only)",
        statusReason: null,
      },
      { candidateId: "c-b", mint: FICB, quoteStatus: "unavailable", routeLabel: null, feeLabel: null, statusReason: null },
    ],
  };
}

function observationArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "routequote.observation.input.v1",
    source: "operator-supplied",
    candidateMint: FICA,
    quoteStatus: "quote-observed",
    inputMint: WSOL,
    outputMint: FICA,
    amountInLabel: "0.05 SOL (paper units)",
    venueLabel: "fictional-amm",
    feeLabel: "0.3% pool fee (label only)",
    observedAtLabel: "rehearsal-session",
  };
}

/** A minimal synthetic dry-run-ish folder with quote-derived route state. */
function syntheticFolder(): FolderInputEntry[] {
  const json = (name: string, value: unknown): FolderInputEntry => ({
    name,
    type: "json",
    text: JSON.stringify(value),
  });
  return [
    json("candidates.json", {
      schemaVersion: "sniper.candidate.list.v1",
      candidateCount: 2,
      candidates: [
        { candidateId: "c-a", mint: FICA, symbol: "FICA" },
        { candidateId: "c-b", mint: FICB, symbol: "FICB" },
      ],
    }),
    json("routequote-prepared.json", preparedArtifact()),
    json("route-resolution.json", {
      schemaVersion: "simulation.route.resolution.v1",
      resolutionStatus: "unresolved",
      routeResolverId: "routequote-operator-supplied",
      routeResolverAttempted: true,
      liveStateCaveat: true,
      entries: [
        { candidateId: "c-a", mint: FICA, routeResolutionStatus: "unresolved" },
        { candidateId: "c-b", mint: FICB, routeResolutionStatus: "unresolved" },
      ],
    }),
    json("operator-bundle.json", {
      schemaVersion: "phase6.operator.bundle.v1",
      operatorVerdict: "blocked",
      bundleLabel: "fictional-run",
      operatorLabel: "fictional-operator",
      complete: true,
      blockingTrailConsistent: true,
      routeResolutionStatus: "unresolved",
      routeResolverAttempted: true,
      simulationReadyPerReadiness: false,
      chainBlockingCodes: ["simulation-blocked-prereqs-not-ready"],
      whyBlocked: ["paper-enters demand operator review"],
      whatHappened: "fictional synthetic run for routequote UI tests",
      whatToInspectNext: ["inspect the route artifact"],
      artifacts: [{ role: "route-resolution", present: true, valid: true }],
      files: [{ role: "route-resolution", fileName: "route-resolution.json", digest: "sha256-128:00" }],
    }),
  ];
}

describe("typed views — routequote schemas (S91)", () => {
  it("routequote.prepared.v1 has a typed view leading with the observation-only framing", () => {
    expect(hasTypedView("routequote.prepared.v1")).toBe(true);
    const out = typed(preparedArtifact());
    expect(out).toContain("Read-only quote observation — never executable, never an order");
    expect(out).toContain("quote-observed");
    expect(out).toContain("routequote-operator-supplied");
    expect(out).toContain("Mandatory caveats");
    expect(out).toContain("NOT executable, NOT a transaction, NOT an order");
    expect(out).toContain("Per-candidate quote state");
  });

  it("routequote.observation.input.v1 has a typed view with label-only facts", () => {
    expect(hasTypedView("routequote.observation.input.v1")).toBe(true);
    const out = typed(observationArtifact());
    expect(out).toContain("Quote observation (label-only facts)");
    expect(out).toContain("operator-supplied");
    expect(out).toContain("never system time");
  });

  it("escapes hostile content instead of injecting it", () => {
    const hostile = preparedArtifact();
    (hostile.entries as Array<Record<string, unknown>>)[0]!.routeLabel = "<script>alert(1)</script>";
    const out = typed(hostile);
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("pipeline route stage — no longer always muted (S91)", () => {
  it("unresolved + attempted renders as review with the quote framing", () => {
    const index = buildFolderIndex(syntheticFolder(), OPTS);
    const overview = buildDryRunOverview(index);
    expect(overview).not.toBeNull();
    const stages = buildPipelineStages(index, overview!);
    const route = stages.find((s) => s.key === "route");
    expect(route?.state).toBe("review");
    expect(route?.detail).toContain("read-only quote observation");
    expect(route?.detail).toContain("never executable");
  });

  it("the explanation helper stays honest for every state", () => {
    expect(routeStatusExplanation("unavailable")).toContain("nothing was faked");
    expect(routeStatusExplanation("unresolved", true)).toContain("read-only quote observation");
    expect(routeStatusExplanation("unresolved", false)).toContain("never invented");
    expect(routeStatusExplanation("resolved", true)).toContain("never executable");
    expect(routeStatusExplanation("totally-made-up")).toContain("Honest boundary");
  });
});

describe("candidate route status + observability (S91)", () => {
  const index = buildFolderIndex(syntheticFolder(), OPTS);
  const overview = buildDryRunOverview(index);

  it("candidate rows carry the prepared quoteStatus (winning over the route entry status)", () => {
    const { rows } = buildCandidateRows(index);
    expect(rows.find((r) => r.candidateId === "c-a")?.routeStatus).toBe("quote-observed");
    expect(rows.find((r) => r.candidateId === "c-b")?.routeStatus).toBe("unavailable");
  });

  it("falls back to the route-resolution entry status when no prepared artifact exists", () => {
    const noPrepared = syntheticFolder().filter((e) => e.name !== "routequote-prepared.json");
    const { rows } = buildCandidateRows(buildFolderIndex(noPrepared, OPTS));
    expect(rows.find((r) => r.candidateId === "c-a")?.routeStatus).toBe("unresolved");
  });

  it("the observability panel carries the route quote fact", () => {
    const facts = buildObservabilityFacts(index, overview!);
    const quote = facts.find((f) => f.label === "Route quote");
    expect(quote?.value).toContain("routequote-operator-supplied");
    expect(quote?.note).toContain("never executable");
    const status = facts.find((f) => f.label === "Route status");
    expect(status?.note).toContain("read-only quote observation");
  });

  it("the candidate table renders the Route quote column with the read-only pill", () => {
    const out = renderToString(CandidateIntelTable(buildCandidateRows(index)));
    expect(out).toContain("Route quote");
    expect(out).toContain("quote observed (read-only)");
  });
});

describe("capability strip — live trading stays disabled (S91)", () => {
  it("routequote is available, the route resolver stays boundary-only, live trading stays disabled", () => {
    const byKey = new Map(SNIPER_CAPABILITIES.map((c) => [c.key, c]));
    expect(byKey.get("routequote")?.state).toBe("available");
    expect(byKey.get("route")?.state).toBe("boundary-only");
    expect(byKey.get("live")?.state).toBe("disabled");
    expect(byKey.get("live")?.note).toContain("no wallet, no keys, no orders");
  });
});
