import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateLiveCanaryRequest } from "./canary-request.js";
import { LIVE_CANDIDATE_DECISION_SCHEMA_VERSION } from "./candidate-score.js";
import { LIVE_LATENCY_REPORT_SCHEMA_VERSION } from "./perf.js";
import { evaluateLivePolicy, validateLivePolicy } from "./policy.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, "..", "..", "..", "examples", "live");

function readExample(name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
}

/**
 * The committed examples/live/* artifacts are part of the docs. Pin them: each must still validate
 * against the production validators, and re-deriving its verdict must match what was committed. If a
 * schema changes, regenerate with `pnpm tsx scripts/gen-live-examples.ts` — this test makes the
 * drift loud.
 */
describe("committed live examples — policies", () => {
  for (const [file, expectPrepare] of [
    ["policy.live-canary.example.json", true],
    ["policy.paper-default.example.json", false],
  ] as const) {
    it(`${file} validates and re-derives its evaluation`, () => {
      const doc = readExample(file) as { policy: unknown; evaluation: { prepareAllowed: boolean } };
      const policy = validateLivePolicy(doc.policy);
      const evaluation = evaluateLivePolicy(policy);
      expect(evaluation.prepareAllowed).toBe(expectPrepare);
      expect(evaluation).toEqual(doc.evaluation);
    });
  }
});

describe("committed live examples — canary requests", () => {
  for (const [file, expectedState] of [
    ["canary-request.preflight-ready.example.json", "preflight_ready"],
    ["canary-request.blocked-by-risk.example.json", "blocked_by_risk"],
    ["canary-request.blocked-by-policy.example.json", "blocked_by_policy"],
  ] as const) {
    it(`${file} validates and carries the expected state + honesty literals`, () => {
      const req = validateLiveCanaryRequest(readExample(file));
      expect(req.state).toBe(expectedState);
      expect(req.signed).toBe(false);
      expect(req.submitted).toBe(false);
      expect(req.confirmed).toBe(false);
      expect(req.backendCustodiesNoKeys).toBe(true);
      expect(req.phase7LiveTradingReady).toBe(false);
      expect(req.network).toBe("mainnet-beta");
    });
  }
});

describe("committed live examples — decision + perf", () => {
  it("the live-candidate decision example is a live_canary_candidate", () => {
    const d = readExample("candidate-decision.live.example.json") as { schemaVersion: string; decision: string };
    expect(d.schemaVersion).toBe(LIVE_CANDIDATE_DECISION_SCHEMA_VERSION);
    expect(d.decision).toBe("live_canary_candidate");
  });

  it("the latency report example carries the right schema and honesty literals", () => {
    const p = readExample("latency-report.example.json") as { schemaVersion: string; notProfitabilityClaim: boolean };
    expect(p.schemaVersion).toBe(LIVE_LATENCY_REPORT_SCHEMA_VERSION);
    expect(p.notProfitabilityClaim).toBe(true);
  });
});
