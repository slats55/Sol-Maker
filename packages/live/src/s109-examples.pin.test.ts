import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateAiRanking } from "./ai-ranker.js";
import { validateStrategyProfile, requireLiveEligibleProfile } from "./profiles.js";
import { validateLiveSellRequest } from "./sell-request.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, "..", "..", "..", "examples", "live", "s109");

function readExample(name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
}

/**
 * The committed examples/live/s109/* artifacts are docs. Pin them: each must validate against the
 * production validators and re-state its expected verdict. Regenerate with
 * `pnpm tsx scripts/gen-s109-examples.ts` — drift is loud, never silent.
 */
describe("committed S109 examples — validate + invariants", () => {
  it("the conservative profile validates and is live-eligible", () => {
    const p = validateStrategyProfile(readExample("strategy-profile.conservative.example.json"));
    expect(requireLiveEligibleProfile(p).name).toBe("conservative");
  });

  it("the aggressive profile validates and is structurally paper-only", () => {
    const p = validateStrategyProfile(readExample("strategy-profile.aggressive-paper-only.example.json"));
    expect(p.liveEligible).toBe(false);
    expect(() => requireLiveEligibleProfile(p)).toThrow(/PAPER-ONLY/);
  });

  it("the fallback ranking validates; the hard-blocked candidate stays excluded", () => {
    const r = validateAiRanking(readExample("ai-ranking.fallback.example.json"));
    expect(r.engine).toBe("deterministic-fallback");
    expect(r.model).toBeNull();
    expect(r.rankings).toHaveLength(1);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]?.reason).toBe("hard-blocked");
    expect(r.advisoryOnly).toBe(true);
    expect(r.cannotOverrideSafety).toBe(true);
  });

  it("the stale-quote sell request is BLOCKED with the stale + approval-missing trail", () => {
    const s = validateLiveSellRequest(readExample("sell-request.blocked-stale-quote.example.json"));
    expect(s.state).toBe("blocked");
    expect(s.blockingReasons).toContain("sell-quote-stale");
    expect(s.blockingReasons).toContain("approval-missing");
    expect(s.envelope).toBeNull();
    expect(s.signed).toBe(false);
  });

  it("the green sell request is review_ready with an ESTIMATED (never claimed) PnL", () => {
    const s = validateLiveSellRequest(readExample("sell-request.review-ready.example.json"));
    expect(s.state).toBe("review_ready");
    expect(s.expectedSolOutLamports).toBe("6000000");
    expect(s.estimatedPnlLamports).toBe(1_000_000);
    expect(s.submitted).toBe(false);
    expect(s.confirmed).toBe(false);
  });

  it("reconciliation examples: unknown stays unknown; the mismatch warns loudly", () => {
    const unknown = readExample("position-reconciliation.unknown.example.json") as { verdict: string; observedTokenAmountRaw: unknown; balancesNeverInvented: boolean };
    expect(unknown.verdict).toBe("unknown");
    expect(unknown.observedTokenAmountRaw).toBeNull();
    expect(unknown.balancesNeverInvented).toBe(true);
    const mismatch = readExample("position-reconciliation.mismatch.example.json") as { verdict: string; notes: string[] };
    expect(mismatch.verdict).toBe("mismatch");
    expect(mismatch.notes.join(" ")).toMatch(/do NOT trust/);
  });
});
