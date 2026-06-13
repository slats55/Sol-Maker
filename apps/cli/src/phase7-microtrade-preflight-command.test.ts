/**
 * Sprint 104-A — `paper:phase7:microtrade:preflight`, the no-send S104 readiness command.
 *
 * The command reads and strictly validates the evidence artifacts and folds them into a
 * `phase7.microtrade.preflight.v1`. These tests pin:
 *   - missing inputs produce a BLOCKED artifact (never a refusal, never a ready state);
 *   - each gate (sign-off, devnet proof, release candidate, burner, manual confirmation) blocks in
 *     precedence order, and a release candidate blocked on risk / quote / simulation maps through;
 *   - an invalid burner public key, an over-cap spend, an invalid artifact, or a not-authorized
 *     audit is REFUSED (exit 1), never silently ignored;
 *   - the full happy fixture reaches ready-for-separate-execution-authorization while STILL pinning
 *     every no-execute / no-authorize lock — and the command never loads a signer or sends.
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
import { buildMainnetDryRunReleaseCandidate } from "@soulmaker/sniper";
import { phase7MicrotradePreflightReport } from "./commands.js";

const BURNER = "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm";
const MICRO_ACKS = requiredAcknowledgementsFor("controlled-mainnet-microtrade-only").map((a) => a.id);

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "p7-preflight-"));
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

/** A REAL reconciled devnet reconciliation report. */
function reconciledReport() {
  const confirmation: ConfirmationTrackResult = {
    outcome: "confirmed",
    signature: "ReconciledDevnetSig1111111111111111111111111",
    slot: 100,
    errLabel: null,
    polls: 1,
    guidance: "confirmed",
  };
  const expected: ExpectedEffect = { kind: "self-transfer-probe", summary: "self-transfer probe", maxFeeLamports: 10_000 };
  return buildReconciliationReport({
    mode: "devnet-execution",
    network: "devnet",
    sessionId: "test-session",
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

/** A release candidate with a chosen verdict, built from coherent stage evidence. */
function releaseCandidate(kind: "complete" | "risk" | "quote" | "simulation") {
  return buildMainnetDryRunReleaseCandidate({
    runId: "rc-fixture",
    candidateSource: { kind: "file", label: "fixture" },
    scoring: { available: true, engineSource: "rust", candidateCount: 1, bestCandidateId: "c1", rankedCandidates: [] },
    risk: {
      assessed: true,
      source: "automatic",
      worstDecision: kind === "risk" ? "REJECT" : "PASS_FOR_PAPER_EVALUATION",
      rejected: kind === "risk",
      criticalFlagCount: 0,
      highFlagCount: 0,
      token2022Blocker: false,
      token2022BlockerMints: [],
    },
    quote: { attempted: true, observed: true, freshness: kind === "quote" ? "stale" : "fresh", scoreAvailable: false, score: null },
    build: { attempted: true, refused: false, succeeded: true, refusalCodes: [] },
    txInspection: { available: true, versionSupported: true, blockhashPresent: true, instructionCount: 5, unresolvableProgramIdCount: 0 },
    simulation: {
      attempted: true,
      outcome: kind === "simulation" ? "failed" : "simulated-ok",
      classification: kind === "simulation" ? "compute" : null,
      failed: kind === "simulation",
    },
    readiness: { available: true, verdict: "blocked", satisfiedCount: 3, totalChecks: 5 },
  });
}

function run(tmp: string, opts: Record<string, unknown>) {
  return phase7MicrotradePreflightReport({ now: () => "2026-06-13T00:00:00.000Z" }, { repoSha: "c04a51b", json: true, ...opts });
}

function readyOpts(tmp: string) {
  return {
    phase7AuditPath: undefined,
    signOffRecordPath: writeJson(tmp, "signoff.json", signedMicroRecord()),
    releaseCandidatePath: writeJson(tmp, "rc.json", releaseCandidate("complete")),
    devnetReconciliationPath: writeJson(tmp, "recon.json", reconciledReport()),
    burnerWallet: BURNER,
    manualConfirmationLabel: "operator confirms the single trade by hand",
    maxSpendSol: "0.001",
  };
}

describe("phase7 micro-trade preflight command — blocked artifacts", () => {
  it("no inputs produce a BLOCKED artifact (exit 0, valid, missing sign-off)", () => {
    const r = run("", {});
    expect(r.exitCode).toBe(0);
    const a = validatePhase7MicrotradePreflight(JSON.parse(r.text));
    expect(a.preflightVerdict).toBe("blocked-missing-signoff");
    expect(a.missingRequirements.length).toBeGreaterThan(0);
  });

  it("a signed sign-off but no devnet proof blocks on the devnet proof", () => {
    withTmp((tmp) => {
      const r = run(tmp, { signOffRecordPath: writeJson(tmp, "s.json", signedMicroRecord()) });
      const a = validatePhase7MicrotradePreflight(JSON.parse(r.text));
      expect(a.preflightVerdict).toBe("blocked-missing-devnet-proof");
    });
  });

  it("a release candidate blocked on simulation maps to blocked-simulation", () => {
    withTmp((tmp) => {
      const r = run(tmp, {
        signOffRecordPath: writeJson(tmp, "s.json", signedMicroRecord()),
        devnetReconciliationPath: writeJson(tmp, "recon.json", reconciledReport()),
        releaseCandidatePath: writeJson(tmp, "rc.json", releaseCandidate("simulation")),
      });
      const a = validatePhase7MicrotradePreflight(JSON.parse(r.text));
      expect(a.preflightVerdict).toBe("blocked-simulation");
      expect(a.simulationStatus).toBe("failed");
    });
  });

  it("a release candidate blocked on risk maps to blocked-risk (a high score cannot rescue it)", () => {
    withTmp((tmp) => {
      const r = run(tmp, {
        signOffRecordPath: writeJson(tmp, "s.json", signedMicroRecord()),
        devnetReconciliationPath: writeJson(tmp, "recon.json", reconciledReport()),
        releaseCandidatePath: writeJson(tmp, "rc.json", releaseCandidate("risk")),
      });
      const a = validatePhase7MicrotradePreflight(JSON.parse(r.text));
      expect(a.preflightVerdict).toBe("blocked-risk");
      expect(a.riskStatus).toBe("rejected");
    });
  });

  it("a complete chain but no burner wallet blocks on the burner wallet", () => {
    withTmp((tmp) => {
      const o = readyOpts(tmp);
      const r = run(tmp, { ...o, burnerWallet: undefined });
      const a = validatePhase7MicrotradePreflight(JSON.parse(r.text));
      expect(a.preflightVerdict).toBe("blocked-missing-burner-wallet");
    });
  });

  it("a complete chain with a burner but no manual confirmation blocks last", () => {
    withTmp((tmp) => {
      const o = readyOpts(tmp);
      const r = run(tmp, { ...o, manualConfirmationLabel: undefined });
      const a = validatePhase7MicrotradePreflight(JSON.parse(r.text));
      expect(a.preflightVerdict).toBe("blocked-missing-manual-confirmation");
    });
  });
});

describe("phase7 micro-trade preflight command — refusals", () => {
  it("refuses an invalid burner public key", () => {
    const r = phase7MicrotradePreflightReport({}, { burnerWallet: "not-valid!!!" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("Refusing");
  });

  it("refuses a max-spend above the micro ceiling", () => {
    const r = phase7MicrotradePreflightReport({}, { maxSpendSol: "1" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("ceiling");
  });

  it("refuses a --max-spend-sol above the signed cap", () => {
    withTmp((tmp) => {
      const r = run(tmp, { signOffRecordPath: writeJson(tmp, "s.json", signedMicroRecord()), maxSpendSol: "0.01" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("signed sign-off");
    });
  });

  it("refuses an invalid evidence artifact rather than ignoring it", () => {
    withTmp((tmp) => {
      const bad = writeJson(tmp, "bad.json", { schemaVersion: "not.a.real.schema" });
      const r = phase7MicrotradePreflightReport({}, { releaseCandidatePath: bad });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("Refusing");
    });
  });

  it("refuses a non-devnet reconciliation", () => {
    withTmp((tmp) => {
      const recon = reconciledReport() as unknown as Record<string, unknown>;
      recon.network = "mainnet-beta";
      const r = phase7MicrotradePreflightReport({}, { devnetReconciliationPath: writeJson(tmp, "recon.json", recon) });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("not devnet");
    });
  });
});

describe("phase7 micro-trade preflight command — ready, but authorizes nothing", () => {
  it("the full happy fixture reaches ready-for-separate-execution-authorization with all locks held", () => {
    withTmp((tmp) => {
      const r = run(tmp, readyOpts(tmp));
      expect(r.exitCode).toBe(0);
      const a = validatePhase7MicrotradePreflight(JSON.parse(r.text));
      expect(a.preflightVerdict).toBe("ready-for-separate-execution-authorization");
      expect(a.missingRequirements).toEqual([]);
      expect(a.burnerWalletAddress).toBe(BURNER);
      expect(a.maxSpendCapLamports).toBe(1_000_000);
      // Every no-execute / no-authorize lock holds even at the best verdict.
      expect(a.liveExecutionAuthorized).toBe(false);
      expect(a.authorizesLiveTrading).toBe(false);
      expect(a.requiresSeparateExecutionApproval).toBe(true);
      expect(a.neverSends).toBe(true);
      expect(a.neverSigns).toBe(true);
      expect(a.notExecutable).toBe(true);
      expect(a.phase7LiveTradingReady).toBe(false);
    });
  });

  it("the artifact never carries a mainnet transaction signature (devnet sig is not echoed)", () => {
    withTmp((tmp) => {
      const r = run(tmp, readyOpts(tmp));
      // The reconciliation's signature must never leak into the preflight output.
      expect(r.text).not.toContain("ReconciledDevnetSig");
    });
  });

  it("--out writes the artifact and refuses to overwrite without --force", () => {
    withTmp((tmp) => {
      const out = join(tmp, "preflight.json");
      const first = run(tmp, { ...readyOpts(tmp), json: false, outPath: out });
      expect(first.exitCode).toBe(0);
      expect(first.text).toContain("wrote");
      const second = run(tmp, { ...readyOpts(tmp), json: false, outPath: out });
      expect(second.exitCode).toBe(1);
      expect(second.text).toContain("already exists");
    });
  });
});
