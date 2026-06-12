/**
 * Sprint 90 — the Sniper Command Center: pure models (lib/command-center.ts),
 * the sample-run loader, the render components, the static page, and the
 * folder-index integration.
 *
 * Pins, over the committed byte-pinned `fixtures/dry-run-sample/` run:
 *   - the pipeline stage states derived from the folder's own artifacts;
 *   - the candidate intelligence rows (joined intake + preflight + decision);
 *   - the observability facts (incl. the honest "timing unavailable");
 *   - the capability strip truth (route boundary-only, live trading disabled);
 *   - render safety: hostile artifact content is escaped, never injected;
 *   - degraded honesty: an empty/garbage folder yields not-run stages and no
 *     invented candidate rows.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFolderIndex, type FolderInputEntry } from "../src/lib/folder-index.js";
import { buildDryRunOverview } from "../src/lib/dry-run-overview.js";
import {
  buildCandidateRows,
  buildObservabilityFacts,
  buildPipelineStages,
  candidateNextAction,
  SNIPER_CAPABILITIES,
} from "../src/lib/command-center.js";
import { loadSampleDryRun } from "../src/lib/sample-run.js";
import { hasTypedView } from "../src/components/artifact-views.js";
import {
  CandidateIntelSection,
  CapabilityStrip,
  ObservabilityPanel,
  PipelineFlow,
} from "../src/components/command-center.js";
import { renderSniper } from "../src/pages/sniper.js";
import { renderFolderIndex } from "../src/pages/folder.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const OPTS = { hasTypedView } as const;

function loadFolder(dir: string): FolderInputEntry[] {
  const entries: FolderInputEntry[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) {
      entries.push({ name, type: "skipped", reason: "subdirectory" });
      continue;
    }
    if (!name.toLowerCase().endsWith(".json")) {
      entries.push({ name, type: "skipped", reason: "non-JSON file" });
      continue;
    }
    entries.push({ name, type: "json", text: readFileSync(path, "utf8") });
  }
  return entries;
}

const sampleIndex = () => buildFolderIndex(loadFolder(join(FIXTURES, "dry-run-sample")), OPTS);

describe("buildPipelineStages over the committed dry-run sample", () => {
  const index = sampleIndex();
  const overview = buildDryRunOverview(index);
  if (overview === null) throw new Error("sample must carry a valid operator bundle");
  const stages = buildPipelineStages(index, overview);
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));

  it("renders the nine stages in chain order", () => {
    expect(stages.map((s) => s.key)).toEqual([
      "candidates",
      "inspect",
      "risk",
      "decision",
      "plan",
      "route",
      "audit",
      "handoff",
      "bundle",
    ]);
  });

  it("derives honest per-stage states from the folder's own artifacts", () => {
    expect(byKey.get("candidates")?.state).toBe("complete");
    expect(byKey.get("inspect")?.state).toBe("complete"); // 2/2 supplied
    expect(byKey.get("inspect")?.detail).toContain("2/2");
    expect(byKey.get("risk")?.state).toBe("complete");
    expect(byKey.get("decision")?.state).toBe("review"); // paper-enter demands review
    expect(byKey.get("plan")?.state).toBe("complete"); // unblocked, 1 entry
    expect(byKey.get("route")?.state).toBe("unavailable"); // honest boundary
    expect(byKey.get("audit")?.state).toBe("complete");
    expect(byKey.get("handoff")?.state).toBe("complete");
    expect(byKey.get("bundle")?.state).toBe("blocked"); // verdict: blocked (prereqs review)
  });

  it("links stages to their backing artifacts when present", () => {
    expect(byKey.get("plan")?.anchor).not.toBeNull();
    expect(byKey.get("bundle")?.anchor).toBe(overview.bundleAnchor);
  });
});

describe("buildCandidateRows over the committed dry-run sample", () => {
  const { rows, hidden } = buildCandidateRows(sampleIndex());

  it("joins intake + preflight + decision per candidate, in intake order", () => {
    expect(hidden).toBe(0);
    expect(rows.map((r) => r.candidateId)).toEqual(["rehearsal-clean", "rehearsal-freeze"]);
    const clean = rows[0]!;
    expect(clean.label).toBe("RHCL");
    expect(clean.preflightStatus).toBe("pass");
    expect(clean.riskDecision).toBe("PASS_FOR_PAPER_EVALUATION");
    expect(clean.riskScore).toBe(10);
    expect(clean.decision).toBe("paper-enter");
    expect(clean.nextAction).toContain("Operator review");
    const freeze = rows[1]!;
    expect(freeze.preflightStatus).toBe("warn");
    expect(freeze.decision).toBe("watch");
    expect(freeze.nextAction).toContain("Watch only");
  });

  it("invents nothing for a folder without sniper artifacts", () => {
    const empty = buildFolderIndex([], OPTS);
    expect(buildCandidateRows(empty)).toEqual({ rows: [], hidden: 0 });
  });
});

describe("candidateNextAction — honest fallbacks", () => {
  it("tells the operator to supply data for unknown candidates", () => {
    expect(candidateNextAction(null, "unknown")).toContain("preflight bridge");
    expect(candidateNextAction(null, null)).toContain("preflight bridge");
  });
  it("rejected candidates read as do-not-proceed", () => {
    expect(candidateNextAction("paper-reject", "fail")).toContain("Do not proceed");
  });
});

describe("buildObservabilityFacts over the committed dry-run sample", () => {
  const index = sampleIndex();
  const overview = buildDryRunOverview(index);
  if (overview === null) throw new Error("sample must carry a valid operator bundle");
  const facts = buildObservabilityFacts(index, overview);
  const byLabel = new Map(facts.map((fact) => [fact.label, fact]));

  it("reads run identity and integrity from the artifacts", () => {
    expect(byLabel.get("Run label")?.value).toBe("rehearsal-rich");
    expect(byLabel.get("Operator verdict")?.value).toBe("blocked");
    expect(byLabel.get("Bundle roles")?.value).toBe("13 valid / 0 invalid / 0 missing");
    expect(byLabel.get("Readiness evidence areas")?.value).toBe("11");
    expect(byLabel.get("Route status")?.value).toBe("unavailable");
  });

  it("reports timing as honestly unavailable (no wall-clock by design)", () => {
    const timing = byLabel.get("Timing");
    expect(timing?.value).toBe("unavailable");
    expect(timing?.note).toContain("no wall-clock");
  });
});

describe("capability strip — the safe truth", () => {
  it("route + tx-build + devnet are boundary-only, mainnet live trading is disabled (S92)", () => {
    const byKey = new Map(SNIPER_CAPABILITIES.map((cap) => [cap.key, cap]));
    expect(byKey.get("route")?.state).toBe("boundary-only");
    expect(byKey.get("tx-build")?.state).toBe("boundary-only");
    expect(byKey.get("devnet-exec")?.state).toBe("boundary-only");
    expect(byKey.get("live")?.state).toBe("disabled");
    expect(byKey.get("live")?.note).toContain("Disabled by default");
    expect(byKey.get("live")?.note).toContain("no CLI surface");
    // The real-time feed and unsigned simulation are read-only available capabilities now.
    expect(byKey.get("realtime")?.state).toBe("available");
    expect(byKey.get("tx-simulate")?.state).toBe("available");
  });

  it("renders every capability with its state pill", () => {
    const html = CapabilityStrip(SNIPER_CAPABILITIES).__html;
    expect(html).toContain("Candidate intake");
    expect(html).toContain("Mainnet live trading");
    expect(html).toContain("disabled / unauthorized");
    expect(html).toContain("boundary only");
  });
});

describe("render safety — hostile content is escaped, never injected", () => {
  it("escapes a hostile candidate symbol in the intelligence table", () => {
    const hostile = JSON.stringify({
      schemaVersion: "sniper.candidate.list.v1",
      candidateCount: 1,
      candidates: [
        { candidateId: "x", mint: "So11111111111111111111111111111111111111112", symbol: "<script>alert(1)</script>" },
      ],
    });
    const index = buildFolderIndex([{ name: "candidates.json", type: "json", text: hostile }], OPTS);
    const html = CandidateIntelSection(buildCandidateRows(index)).__html;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes hostile stage details and observability values", () => {
    const flow = PipelineFlow([
      { key: "x", label: "<img onerror=x>", state: "review", detail: '"><svg onload=1>', anchor: null },
    ]).__html;
    expect(flow).not.toContain("<img onerror");
    const panel = ObservabilityPanel([{ label: "<b>L</b>", value: "<i>V</i>", note: null }]).__html;
    expect(panel).not.toContain("<b>L</b>");
  });
});

describe("the static Sniper Command Center page", () => {
  const page = renderSniper().__html;

  it("renders the sample dashboard, pipeline, candidates, and observability", () => {
    expect(page).toContain("Sniper command center");
    expect(page).toContain("SAMPLE");
    expect(page).toContain("Capabilities");
    expect(page).toContain("Pipeline");
    expect(page).toContain("Candidate intelligence");
    expect(page).toContain("Observability");
    expect(page).toContain("RHCL");
    expect(page).toContain("rehearsal-rich");
  });

  it("states the safe boundaries loudly", () => {
    expect(page).toContain("SIMULATION ONLY");
    expect(page).toContain("disabled / unauthorized");
    expect(page).toContain("paper:sniper:preflight:input:prepare");
    expect(page).toContain("Not a live result, not advice, not a profitability claim.");
  });

  it("never claims live readiness", () => {
    expect(page).not.toContain("phase7LiveTradingReady: true");
    expect(page).not.toContain("ready to ape");
    expect(page).not.toContain("live ready");
  });
});

describe("loadSampleDryRun", () => {
  it("loads the committed sample and caches it", () => {
    const a = loadSampleDryRun(hasTypedView);
    const b = loadSampleDryRun(hasTypedView);
    expect(a).toBe(b);
    expect(a.overview.operatorVerdict).toBe("blocked");
  });
});

describe("folder index integration — the loaded dry-run page is the command center", () => {
  it("renders capability strip, pipeline, candidate table, and observability for a real folder", () => {
    const index = sampleIndex();
    const html = renderFolderIndex(index, { name: "dry-run-sample" }).__html;
    expect(html).toContain("Capabilities");
    expect(html).toContain("Pipeline");
    expect(html).toContain("Candidate intelligence");
    expect(html).toContain("Observability");
    expect(html).toContain("rehearsal-clean");
    // The original S89 blocks are still present.
    expect(html).toContain("Dry-run result");
    expect(html).toContain("Artifact chain");
    expect(html).toContain("Blocking conditions");
  });

  it("renders NO command-center blocks for a generic (non-dry-run) folder", () => {
    const generic = buildFolderIndex(
      [{ name: "a.json", type: "json", text: '{"schemaVersion":"backtest.report.v1"}' }],
      OPTS,
    );
    const html = renderFolderIndex(generic, { name: "generic" }).__html;
    expect(html).not.toContain("Candidate intelligence");
    expect(html).not.toContain("Capabilities");
  });
});
