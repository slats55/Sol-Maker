/**
 * Sprint 104-A — the S102 mainnet dry-run release candidate as a preflight INPUT.
 *
 * These tests pin that the micro-trade preflight consumes the release candidate honestly:
 *   - every blocked RC verdict (risk / quote / build / simulation) blocks the preflight, mapped to
 *     the matching preflight verdict (build / error / incomplete fold to missing-release-candidate);
 *   - ONLY dryrun-complete-blocked-live satisfies the RC prerequisite;
 *   - a high candidate score can NEVER override a blocked RC verdict (the RC verdict is re-derived
 *     from stage evidence, never a score, and the preflight reads the RC verdict);
 *   - the RC's liveSendStatus is pinned "disabled" and no send-result / signature can ride in (the
 *     closed RC schema refuses an unknown field, so the preflight command refuses it).
 *
 * It does NOT change release-candidate semantics — it proves they compose safely.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPhase7HumanSignoff,
  buildReconciliationReport,
  validatePhase7MicrotradePreflight,
  requiredAcknowledgementsFor,
  type ConfirmationTrackResult,
  type BalanceSnapshot,
  type ExpectedEffect,
} from "@soulmaker/execution";
import { buildMainnetDryRunReleaseCandidate, type BuildMainnetDryRunReleaseCandidateInput } from "@soulmaker/sniper";
import { phase7MicrotradePreflightReport } from "./commands.js";

const BURNER = "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm";
const WSOL = "So11111111111111111111111111111111111111112";
const MICRO_ACKS = requiredAcknowledgementsFor("controlled-mainnet-microtrade-only").map((a) => a.id);

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "rc-compat-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeJson(tmp: string, name: string, value: unknown): string {
  const path = join(tmp, name);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

function snapshot(label: "pre" | "post", lamports: number): BalanceSnapshot {
  return { label, observedAt: "2026-06-13T00:00:00.000Z", ownerPublicKey: BURNER, sol: { lamports, status: "observed", errLabel: null }, token: null };
}

function reconciledReport() {
  const confirmation: ConfirmationTrackResult = {
    outcome: "confirmed",
    signature: "ReconciledDevnetSig1111111111111111111111111",
    slot: 100,
    errLabel: null,
    polls: 1,
    guidance: "confirmed",
  };
  const expected: ExpectedEffect = { kind: "self-transfer-probe", summary: "probe", maxFeeLamports: 10_000 };
  return buildReconciliationReport({
    mode: "devnet-execution",
    network: "devnet",
    sessionId: "s",
    command: "execution:devnet:rehearse",
    signature: "ReconciledDevnetSig1111111111111111111111111",
    confirmation,
    pre: snapshot("pre", 1_000_000_000),
    post: snapshot("post", 999_995_000),
    expected,
    feeEstimatedLamports: 5000,
    feeActualLamports: 5000,
    clock: () => "2026-06-13T00:00:02.000Z",
  });
}

function signedMicroRecord() {
  return buildPhase7HumanSignoff({
    repoSha: "c04a51b",
    targetScope: "controlled-mainnet-microtrade-only",
    acknowledgedIds: MICRO_ACKS,
    operatorLabel: "operator-a",
    signedAtLabel: "2026-06-13",
    maxSpendLamports: 1_000_000,
  });
}

/** A complete-by-default RC, with stage overrides to force a chosen verdict. */
function rc(overrides: Partial<BuildMainnetDryRunReleaseCandidateInput> = {}) {
  const base: BuildMainnetDryRunReleaseCandidateInput = {
    runId: "rc",
    candidateSource: { kind: "file", label: "fixture" },
    scoring: { available: true, engineSource: "rust", candidateCount: 1, bestCandidateId: "c1", rankedCandidates: [] },
    risk: { assessed: true, source: "automatic", worstDecision: "PASS_FOR_PAPER_EVALUATION", rejected: false, criticalFlagCount: 0, highFlagCount: 0, token2022Blocker: false, token2022BlockerMints: [] },
    quote: { attempted: true, observed: true, freshness: "fresh", scoreAvailable: false, score: null },
    build: { attempted: true, refused: false, succeeded: true, refusalCodes: [] },
    txInspection: { available: true, versionSupported: true, blockhashPresent: true, instructionCount: 5, unresolvableProgramIdCount: 0 },
    simulation: { attempted: true, outcome: "simulated-ok", classification: null, failed: false },
    readiness: { available: true, verdict: "blocked", satisfiedCount: 3, totalChecks: 5 },
  };
  return buildMainnetDryRunReleaseCandidate({ ...base, ...overrides });
}

/** Build the preflight over the supplied RC with the rest of the chain satisfied. */
function preflightOver(tmp: string, releaseCandidate: unknown) {
  const r = phase7MicrotradePreflightReport(
    { now: () => "2026-06-13T00:00:00.000Z" },
    {
      repoSha: "c04a51b",
      json: true,
      signOffRecordPath: writeJson(tmp, "s.json", signedMicroRecord()),
      devnetReconciliationPath: writeJson(tmp, "recon.json", reconciledReport()),
      releaseCandidatePath: writeJson(tmp, "rc.json", releaseCandidate),
      burnerWallet: BURNER,
      manualConfirmationLabel: "operator confirms by hand",
      maxSpendSol: "0.001",
    },
  );
  return { exitCode: r.exitCode, text: r.text };
}

describe("preflight RC compatibility — blocked verdicts block the preflight", () => {
  it("dryrun-blocked-risk blocks the preflight (blocked-risk)", () => {
    withTmp((tmp) => {
      const candidate = rc({ risk: { assessed: true, source: "automatic", worstDecision: "REJECT", rejected: true, criticalFlagCount: 0, highFlagCount: 0, token2022Blocker: false, token2022BlockerMints: [] } });
      expect(candidate.verdict).toBe("dryrun-blocked-risk");
      const a = validatePhase7MicrotradePreflight(JSON.parse(preflightOver(tmp, candidate).text));
      expect(a.preflightVerdict).toBe("blocked-risk");
    });
  });

  it("dryrun-blocked-quote blocks the preflight (blocked-quote)", () => {
    withTmp((tmp) => {
      const candidate = rc({ quote: { attempted: true, observed: true, freshness: "stale", scoreAvailable: false, score: null } });
      expect(candidate.verdict).toBe("dryrun-blocked-quote");
      const a = validatePhase7MicrotradePreflight(JSON.parse(preflightOver(tmp, candidate).text));
      expect(a.preflightVerdict).toBe("blocked-quote");
    });
  });

  it("dryrun-blocked-build blocks the preflight (folds to missing-release-candidate)", () => {
    withTmp((tmp) => {
      const candidate = rc({ build: { attempted: true, refused: true, succeeded: false, refusalCodes: ["program-not-allowlisted"] } });
      expect(candidate.verdict).toBe("dryrun-blocked-build");
      const a = validatePhase7MicrotradePreflight(JSON.parse(preflightOver(tmp, candidate).text));
      expect(a.preflightVerdict).toBe("blocked-missing-release-candidate");
      expect(a.releaseCandidateStatus).toBe("blocked-build");
    });
  });

  it("dryrun-blocked-simulation blocks the preflight (blocked-simulation)", () => {
    withTmp((tmp) => {
      const candidate = rc({ simulation: { attempted: true, outcome: "failed", classification: "compute", failed: true } });
      expect(candidate.verdict).toBe("dryrun-blocked-simulation");
      const a = validatePhase7MicrotradePreflight(JSON.parse(preflightOver(tmp, candidate).text));
      expect(a.preflightVerdict).toBe("blocked-simulation");
    });
  });
});

describe("preflight RC compatibility — only completeness satisfies the prerequisite", () => {
  it("dryrun-complete-blocked-live satisfies the RC prerequisite (reaches ready)", () => {
    withTmp((tmp) => {
      const candidate = rc();
      expect(candidate.verdict).toBe("dryrun-complete-blocked-live");
      const a = validatePhase7MicrotradePreflight(JSON.parse(preflightOver(tmp, candidate).text));
      expect(a.preflightVerdict).toBe("ready-for-separate-execution-authorization");
      expect(a.releaseCandidateStatus).toBe("complete-blocked-live");
    });
  });

  it("a high candidate score can NEVER override a blocked RC verdict", () => {
    withTmp((tmp) => {
      // Perfect score (100, watch, ranked #1) but a REJECT risk — the RC verdict stays blocked-risk.
      const candidate = rc({
        scoring: {
          available: true,
          engineSource: "rust",
          candidateCount: 1,
          bestCandidateId: "c1",
          rankedCandidates: [{ candidateId: "c1", mint: WSOL, rank: 1, score: 100, verdict: "watch", reasonCodes: [] }],
        },
        risk: { assessed: true, source: "automatic", worstDecision: "REJECT", rejected: true, criticalFlagCount: 0, highFlagCount: 0, token2022Blocker: false, token2022BlockerMints: [] },
      });
      expect(candidate.verdict).toBe("dryrun-blocked-risk");
      const a = validatePhase7MicrotradePreflight(JSON.parse(preflightOver(tmp, candidate).text));
      expect(a.preflightVerdict).toBe("blocked-risk");
    });
  });

  it("the RC liveSendStatus is pinned disabled (a release candidate can never report live enabled)", () => {
    const candidate = rc();
    expect(candidate.liveSendStatus).toBe("disabled");
    expect(candidate.phase7LiveTradingReady).toBe(false);
  });

  it("a release candidate carrying a send result / signature is refused (closed schema)", () => {
    withTmp((tmp) => {
      const candidate = rc() as unknown as Record<string, unknown>;
      candidate.sendResult = { signature: "x".repeat(88) };
      const r = phase7MicrotradePreflightReport(
        {},
        {
          signOffRecordPath: writeJson(tmp, "s.json", signedMicroRecord()),
          devnetReconciliationPath: writeJson(tmp, "recon.json", reconciledReport()),
          releaseCandidatePath: writeJson(tmp, "rc.json", candidate),
          burnerWallet: BURNER,
          manualConfirmationLabel: "x",
          maxSpendSol: "0.001",
        },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("Refusing");
    });
  });
});
