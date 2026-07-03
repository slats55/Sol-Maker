import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateCanaryReconciliation } from "./canary-reconcile.js";
import { validateSniperCandidate } from "./discovery.js";
import { validateEscalationPolicy } from "./escalation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, "..", "..", "..", "examples", "live", "part2");

function readExample(name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
}

/**
 * The committed examples/live/part2/* artifacts are part of the docs. Pin them: each must validate
 * against the production validators and re-state its expected verdict. Regenerate with
 * `pnpm tsx scripts/gen-part2-examples.ts` if a schema changes — this makes drift loud.
 */
describe("committed part2 examples — validate + invariants", () => {
  it("escalation policy validates and disables large trades", () => {
    const p = validateEscalationPolicy(readExample("escalation-policy.example.json"));
    expect(p.largeTradesEnabled).toBe(false);
    expect(p.manualRearmRequired).toBe(true);
  });

  it("discovery candidates each validate; the bad mint became a rejection", () => {
    const d = readExample("discovery.example.json") as { candidates: unknown[]; rejections: unknown[] };
    expect(d.candidates.length).toBe(1);
    expect(d.rejections.length).toBeGreaterThanOrEqual(1);
    for (const c of d.candidates) validateSniperCandidate(c);
  });

  it("the armed-green run report recommends exactly one canary (loop never sends)", () => {
    const r = readExample("run-report.armed-green.example.json") as {
      totals: { canaryRecommended: number };
      results: { action: string; loopNeverSends: boolean }[];
      loopNeverSends: boolean;
    };
    expect(r.totals.canaryRecommended).toBe(1);
    expect(r.results[0]!.action).toBe("prepare_canary_request");
    expect(r.results[0]!.loopNeverSends).toBe(true);
    expect(r.loopNeverSends).toBe(true);
  });

  it("the armed-risk-reject run report recommends NO canary (risk overrides)", () => {
    const r = readExample("run-report.armed-risk-reject.example.json") as { totals: { canaryRecommended: number }; results: { action: string }[] };
    expect(r.totals.canaryRecommended).toBe(0);
    expect(r.results[0]!.action).toBe("ignore");
  });

  it("the paper-shadow session has one would_enter and one would_skip and claims no profit", () => {
    const s = readExample("paper-shadow-session.example.json") as { totals: { wouldEnter: number; wouldSkip: number }; notProfitabilityClaim: boolean };
    expect(s.totals.wouldEnter).toBe(1);
    expect(s.totals.wouldSkip).toBe(1);
    expect(s.notProfitabilityClaim).toBe(true);
  });

  it("the reconciliation example validates and reports an honest unknown PnL", () => {
    const rec = validateCanaryReconciliation(readExample("reconciliation.finalized.example.json"));
    expect(rec.verdict).toBe("reconciled");
    expect(rec.pnlKnown).toBe(false);
    expect(rec.notProfitabilityClaim).toBe(true);
  });
});
