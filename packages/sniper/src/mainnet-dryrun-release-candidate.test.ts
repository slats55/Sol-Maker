/**
 * Tests for the Sprint 102 MAINNET DRY-RUN RELEASE CANDIDATE artifact
 * (`sniper.mainnet_dryrun.release_candidate.v1`). All inputs are INJECTED, offline test data. The
 * builder is pure — no filesystem, network, RPC, signer, or send. The central guarantees under test:
 *
 *   - the live-send status is the literal "disabled" and cannot be moved by any input;
 *   - the verdict is RE-DERIVED from structured stage evidence and the validator recomputes it, so a
 *     candidate score — however high — can never override a blocked verdict;
 *   - the schema is CLOSED (a stray "sendResult" field is refused);
 *   - each blocking condition maps to its dedicated closed verdict, in the right precedence.
 */

import { describe, it, expect } from "vitest";
import {
  buildMainnetDryRunReleaseCandidate,
  validateMainnetDryRunReleaseCandidate,
  deriveReleaseCandidateVerdict,
  SniperReleaseCandidateError,
  SNIPER_RELEASE_CANDIDATE_SCHEMA_VERSION,
  SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS,
  type BuildMainnetDryRunReleaseCandidateInput,
} from "./mainnet-dryrun-release-candidate.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** A fully-evidenced, clean dry run (the BEST possible outcome: dryrun-complete-blocked-live). */
function completeEvidence(): BuildMainnetDryRunReleaseCandidateInput {
  return {
    runId: "rc-2026-06-13",
    generatedAt: "2026-06-13T00:00:00.000Z",
    network: "mainnet-beta",
    candidateSource: { kind: "file", label: "candidates.json" },
    scoring: {
      available: true,
      engineSource: "rust",
      candidateCount: 1,
      bestCandidateId: "c1",
      rankedCandidates: [{ candidateId: "c1", mint: WSOL, rank: 1, score: 97, verdict: "watch", reasonCodes: ["paper-only", "mainnet-live-disabled"] }],
    },
    risk: {
      assessed: true,
      source: "automatic",
      worstDecision: "PASS_FOR_PAPER_EVALUATION",
      rejected: false,
      criticalFlagCount: 0,
      highFlagCount: 0,
      token2022Blocker: false,
      token2022BlockerMints: [],
    },
    quote: { attempted: true, observed: true, freshness: "fresh", scoreAvailable: true, score: 92 },
    build: { attempted: true, refused: false, succeeded: true, refusalCodes: [] },
    txInspection: { available: true, versionSupported: true, blockhashPresent: true, instructionCount: 7, unresolvableProgramIdCount: 0 },
    simulation: { attempted: true, outcome: "simulated-ok", classification: null, failed: false },
    readiness: { available: true, verdict: "blocked", satisfiedCount: 8, totalChecks: 14 },
    artifactRefs: ["candidate-scores.json", "readiness.json"],
  };
}

describe("buildMainnetDryRunReleaseCandidate — valid artifact", () => {
  it("builds a complete, validatable RC with the best verdict and pinned safety literals", () => {
    const rc = buildMainnetDryRunReleaseCandidate(completeEvidence());
    expect(rc.schemaVersion).toBe(SNIPER_RELEASE_CANDIDATE_SCHEMA_VERSION);
    expect(rc.verdict).toBe("dryrun-complete-blocked-live");
    expect(rc.network).toBe("mainnet-beta");
    expect(rc.mode).toBe("mainnet-dry-run");
    expect(rc.liveSendStatus).toBe("disabled");
    expect(rc.phase7LiveTradingReady).toBe(false);
    expect(rc.neverSends).toBe(true);
    expect(rc.neverSigns).toBe(true);
    expect(rc.notExecutable).toBe(true);
    expect(rc.whyLiveBlocked.length).toBeGreaterThan(0);
    expect(rc.nextSafeActions.length).toBeGreaterThan(0);
    // round-trips through the strict validator
    expect(() => validateMainnetDryRunReleaseCandidate(rc)).not.toThrow();
  });
});

describe("live-send status can never be enabled", () => {
  it("ignores a hostile liveSendStatus on the input and pins 'disabled'", () => {
    const ev = { ...completeEvidence(), liveSendStatus: "enabled" } as unknown as BuildMainnetDryRunReleaseCandidateInput;
    // builder does not read liveSendStatus from the input — it pins the literal
    const rc = buildMainnetDryRunReleaseCandidate(ev);
    expect(rc.liveSendStatus).toBe(SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS);
  });

  it("refuses a tampered artifact that claims liveSendStatus enabled", () => {
    const rc = buildMainnetDryRunReleaseCandidate(completeEvidence()) as unknown as Record<string, unknown>;
    rc.liveSendStatus = "enabled";
    expect(() => validateMainnetDryRunReleaseCandidate(rc)).toThrow(SniperReleaseCandidateError);
  });

  it("refuses a tampered artifact that flips phase7LiveTradingReady to true", () => {
    const rc = buildMainnetDryRunReleaseCandidate(completeEvidence()) as unknown as Record<string, unknown>;
    rc.phase7LiveTradingReady = true;
    expect(() => validateMainnetDryRunReleaseCandidate(rc)).toThrow(SniperReleaseCandidateError);
  });
});

describe("schema is CLOSED — no send result can ride along", () => {
  it("refuses an artifact carrying an unknown 'sendResult' field", () => {
    const rc = buildMainnetDryRunReleaseCandidate(completeEvidence()) as unknown as Record<string, unknown>;
    rc.sendResult = { signature: "deadbeef", slot: 123 };
    expect(() => validateMainnetDryRunReleaseCandidate(rc)).toThrow(/unknown field/i);
  });

  it("refuses an artifact carrying an unknown 'signature' field", () => {
    const rc = buildMainnetDryRunReleaseCandidate(completeEvidence()) as unknown as Record<string, unknown>;
    rc.signature = "5xabc";
    expect(() => validateMainnetDryRunReleaseCandidate(rc)).toThrow(/unknown field/i);
  });
});

describe("verdict derivation — each blocking condition maps to its verdict", () => {
  it("risk rejected → dryrun-blocked-risk", () => {
    const ev = completeEvidence();
    ev.risk.rejected = true;
    ev.risk.worstDecision = "REJECT";
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-blocked-risk");
  });

  it("critical risk flag → dryrun-blocked-risk", () => {
    const ev = completeEvidence();
    ev.risk.criticalFlagCount = 1;
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-blocked-risk");
  });

  it("Token-2022 blocker → dryrun-blocked-risk", () => {
    const ev = completeEvidence();
    ev.risk.token2022Blocker = true;
    ev.risk.token2022BlockerMints = [USDC];
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-blocked-risk");
  });

  it("stale quote → dryrun-blocked-quote (even though the build would also be refused)", () => {
    const ev = completeEvidence();
    ev.quote.freshness = "stale";
    ev.build.succeeded = false;
    ev.build.refused = true;
    ev.build.refusalCodes = ["build-refused-quote-stale"];
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-blocked-quote");
  });

  it("unavailable quote (attempted, not observed) → dryrun-blocked-quote", () => {
    const ev = completeEvidence();
    ev.quote.observed = false;
    ev.quote.freshness = null;
    ev.build.attempted = false;
    ev.build.succeeded = false;
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-blocked-quote");
  });

  it("build refused (risk pass, quote fresh) → dryrun-blocked-build", () => {
    const ev = completeEvidence();
    ev.build.refused = true;
    ev.build.succeeded = false;
    ev.build.refusalCodes = ["build-refused-over-spend-cap"];
    ev.simulation.attempted = false;
    ev.simulation.outcome = null;
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-blocked-build");
  });

  it("simulation failed → dryrun-blocked-simulation", () => {
    const ev = completeEvidence();
    ev.simulation.outcome = "failed";
    ev.simulation.classification = "slippage-or-route-error";
    ev.simulation.failed = true;
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-blocked-simulation");
  });

  it("missing evidence (no scoring, no risk assessment) → dryrun-insufficient-evidence", () => {
    const ev = completeEvidence();
    ev.scoring.available = false;
    ev.scoring.engineSource = "none";
    ev.scoring.candidateCount = 0;
    ev.scoring.bestCandidateId = null;
    ev.scoring.rankedCandidates = [];
    ev.risk.assessed = false;
    ev.risk.source = "none";
    ev.risk.worstDecision = null;
    ev.risk.criticalFlagCount = null;
    ev.quote.attempted = false;
    ev.quote.observed = false;
    ev.quote.freshness = null;
    ev.build.attempted = false;
    ev.build.succeeded = false;
    ev.simulation.attempted = false;
    ev.simulation.outcome = null;
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-insufficient-evidence");
  });

  it("a stage hard-error → dryrun-error (highest precedence)", () => {
    const ev = completeEvidence();
    ev.stageError = { occurred: true, detail: "candidate list unreadable" };
    expect(buildMainnetDryRunReleaseCandidate(ev).verdict).toBe("dryrun-error");
  });
});

describe("a high candidate score can NEVER override a blocked verdict", () => {
  it("risk-rejected with a perfect-scoring, watch-verdict top candidate stays dryrun-blocked-risk", () => {
    const ev = completeEvidence();
    ev.scoring.rankedCandidates = [{ candidateId: "c1", mint: WSOL, rank: 1, score: 100, verdict: "watch", reasonCodes: ["paper-only"] }];
    ev.scoring.bestCandidateId = "c1";
    ev.risk.rejected = true;
    ev.risk.worstDecision = "REJECT";
    const rc = buildMainnetDryRunReleaseCandidate(ev);
    expect(rc.verdict).toBe("dryrun-blocked-risk");
    // and a tampered echoed verdict that tries to use the score is refused by the validator
    const tampered = rc as unknown as Record<string, unknown>;
    tampered.verdict = "dryrun-complete-blocked-live";
    expect(() => validateMainnetDryRunReleaseCandidate(tampered)).toThrow(/re-derived/i);
  });

  it("deriveReleaseCandidateVerdict never reads a score field (pure parity helper)", () => {
    // Risk rejected dominates regardless of the absence/presence of any scoring signal.
    expect(
      deriveReleaseCandidateVerdict({
        stageError: false,
        riskRejected: true,
        riskCriticalFlagCount: 0,
        token2022Blocker: false,
        quoteAttempted: true,
        quoteObserved: true,
        quoteFreshness: "fresh",
        buildAttempted: true,
        buildRefused: false,
        buildSucceeded: true,
        simulationAttempted: true,
        simulationFailed: false,
        simulationOutcome: "simulated-ok",
        scoringAvailable: true,
        riskAssessed: true,
        readinessAvailable: true,
      }),
    ).toBe("dryrun-blocked-risk");
  });
});

describe("structural refusals", () => {
  it("refuses a non-mainnet network", () => {
    const ev = completeEvidence();
    ev.network = "devnet";
    expect(() => buildMainnetDryRunReleaseCandidate(ev)).toThrow(/mainnet-beta/);
  });

  it("refuses a secret-shaped candidate source label", () => {
    const ev = completeEvidence();
    ev.candidateSource.label = "x".repeat(900);
    expect(() => buildMainnetDryRunReleaseCandidate(ev)).toThrow(SniperReleaseCandidateError);
  });

  it("refuses an invalid mint in the ranked candidates", () => {
    const ev = completeEvidence();
    ev.scoring.rankedCandidates[0]!.mint = "not-a-mint!";
    expect(() => buildMainnetDryRunReleaseCandidate(ev)).toThrow(SniperReleaseCandidateError);
  });

  it("refuses an artifact whose verdict does not match the evidence", () => {
    const rc = buildMainnetDryRunReleaseCandidate(completeEvidence()) as unknown as Record<string, unknown>;
    rc.verdict = "dryrun-blocked-build";
    expect(() => validateMainnetDryRunReleaseCandidate(rc)).toThrow(/re-derived/i);
  });
});
