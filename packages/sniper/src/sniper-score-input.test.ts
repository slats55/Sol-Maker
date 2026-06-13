/**
 * Tests for the Sprint 101 SNIPER SCORE INPUT bundle (`sniper.score.input.v1`). All inputs are
 * INJECTED, offline test data — real well-known mints as deterministic fixtures, risk/inspection
 * objects shaped like token:risk / token:inspect output. Normalizing a bundle is LOCAL-ONLY:
 * nothing here fetches chain data or verifies an on-chain fact. The bundle is INPUT only — it
 * carries no score and no verdict (those are produced by the Rust engine and re-checked by TS).
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSniperScoreInput,
  validateSniperScoreInput,
  SniperScoreInputError,
  SNIPER_SCORE_INPUT_SCHEMA_VERSION,
  SNIPER_SCORE_INPUT_BANNER,
  SNIPER_SCORE_FACT_KEYS,
} from "./sniper-score-input.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const riskReject = (mint: string) => ({
  mint,
  score: 100,
  decision: "REJECT",
  flags: [{ id: "freeze-authority", severity: "critical", title: "Freeze authority present" }],
});
const riskPass = (mint: string) => ({ mint, score: 12, decision: "PASS_FOR_PAPER_EVALUATION", flags: [] });
const inspectionClean = (mint: string) => ({ mint, decimals: 6, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const inspectionFreeze = (mint: string) => ({ mint, decimals: 6, mintAuthorityPresent: false, freezeAuthorityPresent: true, isInitialized: true, programLabel: "spl-token" });

describe("normalizeSniperScoreInput — valid input", () => {
  it("derives risk + inspection facts from supplied artifacts and fills the closed facts set", () => {
    const bundle = normalizeSniperScoreInput({
      sourceLabel: "ops",
      mode: "mainnet-dry-run",
      network: "mainnet-beta-readonly",
      entries: [
        {
          candidateId: "c1",
          mint: WSOL,
          source: "jupiter-recent-tokens",
          risk: riskPass(WSOL),
          inspection: inspectionClean(WSOL),
          quoteObserved: true,
          quoteScore: 89,
          quoteFreshness: "fresh",
          liquidityHint: "adequate",
          simulationOutcome: "simulated-ok",
        },
      ],
    });
    expect(bundle.schemaVersion).toBe(SNIPER_SCORE_INPUT_SCHEMA_VERSION);
    expect(bundle.banner).toBe(SNIPER_SCORE_INPUT_BANNER);
    expect(bundle.mode).toBe("mainnet-dry-run");
    expect(bundle.candidateCount).toBe(1);
    const facts = bundle.candidates[0]!.facts;
    expect(facts.riskDecision).toBe("PASS_FOR_PAPER_EVALUATION");
    expect(facts.riskScore).toBe(12);
    expect(facts.freezeAuthorityPresent).toBe(false);
    expect(facts.quoteScore).toBe(89);
    expect(facts.quoteFreshness).toBe("fresh");
    expect(facts.simulationOutcome).toBe("simulated-ok");
    // The canonical facts object carries EVERY closed key (absent → null).
    expect(Object.keys(facts).sort()).toEqual([...SNIPER_SCORE_FACT_KEYS].sort());
    expect(facts.token2022Blocker).toBeNull();
    expect(() => validateSniperScoreInput(bundle)).not.toThrow();
  });

  it("carries a REJECT risk decision and freeze authority verbatim", () => {
    const bundle = normalizeSniperScoreInput({
      entries: [{ candidateId: "bad", mint: USDC, risk: riskReject(USDC), inspection: inspectionFreeze(USDC) }],
    });
    const facts = bundle.candidates[0]!.facts;
    expect(facts.riskDecision).toBe("REJECT");
    expect(facts.riskScore).toBe(100);
    expect(facts.riskCriticalFlagCount).toBe(1);
    expect(facts.freezeAuthorityPresent).toBe(true);
  });

  it("lets explicit fact fields win over values derived from raw artifacts", () => {
    const bundle = normalizeSniperScoreInput({
      entries: [{ candidateId: "c1", mint: WSOL, risk: riskPass(WSOL), riskDecision: "CAUTION", riskScore: 55 }],
    });
    expect(bundle.candidates[0]!.facts.riskDecision).toBe("CAUTION");
    expect(bundle.candidates[0]!.facts.riskScore).toBe(55);
  });

  it("is deterministic and idempotent (canonical re-normalizes to itself)", () => {
    const input = {
      mode: "paper" as const,
      entries: [{ candidateId: "c1", mint: USDC, risk: riskPass(USDC) }],
    };
    const a = normalizeSniperScoreInput(input);
    const b = normalizeSniperScoreInput(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const again = normalizeSniperScoreInput({ mode: a.mode, sourceLabel: a.sourceLabel, network: a.network, entries: a.candidates as never });
    expect(JSON.stringify(again.candidates)).toBe(JSON.stringify(a.candidates));
  });

  it("defaults mode to paper and labels to null", () => {
    const bundle = normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: WSOL }] });
    expect(bundle.mode).toBe("paper");
    expect(bundle.sourceLabel).toBeNull();
    expect(bundle.network).toBeNull();
  });
});

describe("normalizeSniperScoreInput — refusals", () => {
  it("refuses a duplicate candidateId", () => {
    expect(() =>
      normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: WSOL }, { candidateId: "c1", mint: BONK }] }),
    ).toThrow(SniperScoreInputError);
  });

  it("refuses a secret-length mint (never echoed)", () => {
    const secret = "5".repeat(80);
    expect(() => normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: secret }] })).toThrow(SniperScoreInputError);
  });

  it("refuses an unknown mode", () => {
    expect(() => normalizeSniperScoreInput({ mode: "live" as never, entries: [] })).toThrow(SniperScoreInputError);
  });

  it("refuses an out-of-range quote score", () => {
    expect(() => normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: WSOL, quoteScore: 140 }] })).toThrow(SniperScoreInputError);
  });

  it("refuses an unknown liquidity hint / freshness / sim outcome", () => {
    expect(() => normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: WSOL, liquidityHint: "deep" as never }] })).toThrow(SniperScoreInputError);
    expect(() => normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: WSOL, quoteFreshness: "old" as never }] })).toThrow(SniperScoreInputError);
    expect(() => normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: WSOL, simulationOutcome: "ok" as never }] })).toThrow(SniperScoreInputError);
  });

  it("refuses a secret-shaped caveat (key-shaped span)", () => {
    const keyShaped = `leaked ${"5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79".repeat(2)}`;
    expect(() =>
      normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: WSOL, caveats: [keyShaped] }] }),
    ).toThrow(SniperScoreInputError);
  });
});

describe("validateSniperScoreInput — backstop", () => {
  const good = () => normalizeSniperScoreInput({ entries: [{ candidateId: "c1", mint: WSOL, risk: riskPass(WSOL) }] });

  it("accepts a canonical bundle", () => {
    expect(() => validateSniperScoreInput(good())).not.toThrow();
  });

  it("refuses a wrong schemaVersion", () => {
    expect(() => validateSniperScoreInput({ ...good(), schemaVersion: "other.v1" })).toThrow(SniperScoreInputError);
  });

  it("refuses an unknown entry field (the entry set is CLOSED)", () => {
    const bundle = good();
    (bundle.candidates[0] as unknown as Record<string, unknown>).surprise = true;
    expect(() => validateSniperScoreInput(bundle)).toThrow(/CLOSED/);
  });

  it("refuses an unknown facts field (the facts set is CLOSED)", () => {
    const bundle = good();
    (bundle.candidates[0]!.facts as unknown as Record<string, unknown>).surprise = true;
    expect(() => validateSniperScoreInput(bundle)).toThrow(/CLOSED/);
  });

  it("refuses a candidateCount that disagrees with candidates.length", () => {
    const bundle = good();
    (bundle as unknown as Record<string, unknown>).candidateCount = 5;
    expect(() => validateSniperScoreInput(bundle)).toThrow(SniperScoreInputError);
  });

  it("refuses a missing safety flag", () => {
    const bundle = good();
    (bundle as unknown as Record<string, unknown>).paperOnly = false;
    expect(() => validateSniperScoreInput(bundle)).toThrow(SniperScoreInputError);
  });
});
