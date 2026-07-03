import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateHumanCanaryReadiness } from "./human-readiness.js";
import { validateOperatorConfig, evaluateOperatorConfig } from "./operator-config.js";
import { validateOperatorReconciliation } from "./operator-reconcile.js";
import { validateOperatorRunReport } from "./operator-loop.js";
import { validateOperatorAlert } from "./alerts.js";
import { parseSessionLog, summarizeSessionLog } from "./session-recorder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, "..", "..", "..", "examples", "live", "part3");

function readExample(name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
}

/**
 * The committed examples/live/part3/* artifacts are part of the release docs. Pin them: each must
 * validate against the PRODUCTION validators and re-state its expected verdict. Regenerate with
 * `pnpm tsx scripts/gen-part3-examples.ts` if a schema changes — this makes drift loud.
 */
describe("committed part3 examples — validate + invariants", () => {
  it("operator config validates; armed_canary permitted; pins hold", () => {
    const config = validateOperatorConfig(readExample("operator-config.example.json"));
    expect(config.mode).toBe("armed_canary");
    expect(config.largeTradesEnabled).toBe(false);
    expect(config.phantomApprovalRequired).toBe(true);
    const validation = evaluateOperatorConfig(config);
    expect(validation.armedCanaryPermitted).toBe(true);
    expect(JSON.parse(JSON.stringify(validation))).toEqual(readExample("config-validation.example.json"));
  });

  it("observe + shadow runs recommend NOTHING; the armed run recommends exactly one (WSOL, never USDC)", () => {
    const observe = validateOperatorRunReport(readExample("run-report.observe.example.json"));
    expect(observe.totals.canaryRecommended).toBe(0);
    const shadow = validateOperatorRunReport(readExample("run-report.paper-shadow.example.json"));
    expect(shadow.totals.canaryRecommended).toBe(0);
    const armed = validateOperatorRunReport(readExample("run-report.armed-green.example.json"));
    expect(armed.totals.canaryRecommended).toBe(1);
    expect(armed.recommendation!.mint).toBe("So11111111111111111111111111111111111111112");
    // The risk-rejected USDC fixture (real freeze-authority pattern) is never the recommendation.
    expect(armed.recommendation!.mint).not.toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(armed.loopNeverSends).toBe(true);
  });

  it("the session journal parses line-by-line with zero invalid lines and an ended status", () => {
    const journal = readFileSync(join(EXAMPLES, "session-journal.example.jsonl"), "utf8");
    const lines = parseSessionLog(journal);
    expect(lines.every((l) => l.event !== null)).toBe(true);
    const summary = summarizeSessionLog(journal);
    expect(summary.status).toBe("ended");
    expect(summary.canary.recommended).toBe(1);
    expect(summary.canary.confirmed).toBe(1);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(readExample("session-summary.example.json"));
  });

  it("the reconciliation example re-validates at HIGH confidence with real slippage math", () => {
    const rec = validateOperatorReconciliation(readExample("reconciliation.full-evidence.example.json"));
    expect(rec.confidence).toBe("high");
    expect(rec.grossTokenReceivedRaw).toBe("347000");
    expect(rec.slippageRealizedBps).toBe(-8);
    expect(rec.pnlStatus).toBe("unrealized-unpriced"); // no price evidence supplied ⇒ no USD estimate
    expect(rec.notProfitabilityClaim).toBe(true);
  });

  it("every alert example validates and the file restates that sinks are disabled by default", () => {
    const doc = readExample("alerts.example.json") as { note: string; alerts: unknown[] };
    expect(doc.note).toMatch(/DISABLED by default/);
    expect(doc.alerts.length).toBe(3);
    for (const a of doc.alerts) validateOperatorAlert(a);
  });

  it("the READY-FOR-HUMAN-CANARY report is truthful: ready, and NO real canary executed", () => {
    const readiness = validateHumanCanaryReadiness(readExample("ready-for-human-canary.report.json"));
    expect(readiness.verdict).toBe("ready-for-human-canary");
    expect(readiness.realCanaryExecuted).toBe(false);
    expect(readiness.realCanaryStatusNote).toMatch(/NO real canary has been executed/);
    expect(readiness.missing).toEqual([]);
    expect(readiness.requiresHumanPhantomApproval).toBe(true);
    expect(readiness.largeTradesEnabled).toBe(false);
  });
});
