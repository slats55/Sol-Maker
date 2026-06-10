/**
 * **FICTIONAL** deterministic chain fixtures for the simulation package (Sprints 63/64+).
 *
 * Everything here is INVENTED: synthetic candidate ids, the same fictional mints the repo's
 * shipped `examples/sniper` fixtures use, and made-up inspection/risk values. Nothing is live
 * data, an on-chain fact, a trade signal, or a profitability claim — these exist ONLY so tests
 * and e2e suites can exercise the simulation pipeline against a chain that was built by the REAL
 * `@soulmaker/sniper` production builders (so the fixtures can never drift from the code).
 *
 * Two chains are provided:
 *  - {@link buildFictionalReadyChain} — every candidate clean, paper-enters present, gates READY,
 *    every prereq bucket met EXCEPT the operator bucket's NO_OPERATOR_BLOCKING item (paper-enters
 *    always demand review by design).
 *  - {@link buildFictionalWatchOnlyChain} — no paper-enter (warn → watch), gates READY, every
 *    prereq bucket fully met (the run report carries zero operator-blocking reasons).
 *
 * Pure: built entirely in memory through production builders; no I/O, no network, no wall-clock.
 */

import {
  normalizeSniperCandidateList,
  buildSniperTokenPreflightReport,
  normalizeSniperPolicyConfigV2,
  buildPaperSniperDecisionReport,
  buildPaperSniperDecisionReportV2,
  buildSniperRunReport,
  buildSniperRunReportV2,
  buildSniperAuditLog,
  buildSniperSessionPack,
  buildSniperSafetyGatesReportV2,
  buildPhase6PrerequisiteReportV2,
  buildSniperKillSwitchSpec,
  buildSniperSecretsPolicy,
  buildSniperBurnerIsolationSpec,
  type SniperCandidateList,
  type SniperTokenPreflightReport,
  type SniperPolicyConfigV2,
  type SniperPaperDecisionReportV2,
  type SniperRunReportV2,
  type SniperAuditLog,
  type SniperSessionPack,
  type SniperSafetyGatesReportV2,
  type Phase6PrerequisiteReportV2,
  type SniperKillSwitchSpec,
  type SniperSecretsPolicy,
  type SniperBurnerIsolationSpec,
} from "@soulmaker/sniper";

/** The fictional mints (the same invented values the repo's shipped example fixtures use). */
export const FICTIONAL_MINT_A = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
/** Second fictional mint. */
export const FICTIONAL_MINT_B = "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn";

/** The full fictional chain (every artifact built by a PRODUCTION builder). */
export interface FictionalSimulationChain {
  candidateList: SniperCandidateList;
  preflight: SniperTokenPreflightReport;
  policy: SniperPolicyConfigV2;
  decision: SniperPaperDecisionReportV2;
  runReport: SniperRunReportV2;
  auditLog: SniperAuditLog;
  sessionPack: SniperSessionPack;
  gates: SniperSafetyGatesReportV2;
  prereqs: Phase6PrerequisiteReportV2;
  killSwitchSpec: SniperKillSwitchSpec;
  secretsPolicy: SniperSecretsPolicy;
  burnerIsolationSpec: SniperBurnerIsolationSpec;
}

const FICTIONAL_OPERATOR = "fictional-operator";

function buildAdoptedSpecs(): Pick<FictionalSimulationChain, "killSwitchSpec" | "secretsPolicy" | "burnerIsolationSpec"> {
  const killSwitchSpec = buildSniperKillSwitchSpec({
    operatorLabel: FICTIONAL_OPERATOR,
    requiredOperatorConfirmations: ["fictional: the operator confirms the session label"],
    readinessStatus: "adopted",
  });
  const secretsPolicy = buildSniperSecretsPolicy({
    operatorLabel: FICTIONAL_OPERATOR,
    readinessStatus: "adopted",
  });
  const burnerIsolationSpec = buildSniperBurnerIsolationSpec({
    operatorLabel: FICTIONAL_OPERATOR,
    killSwitchSpecRef: FICTIONAL_OPERATOR,
    readinessStatus: "adopted",
  });
  return { killSwitchSpec, secretsPolicy, burnerIsolationSpec };
}

function buildChain(opts: { cleanRisk: boolean }): FictionalSimulationChain {
  const candidateList = normalizeSniperCandidateList({
    sourceLabel: "fictional-simulation-fixture",
    candidates: [
      {
        candidateId: "fic-sim-a",
        mint: FICTIONAL_MINT_A,
        symbol: "FICA",
        name: "Fictional Simulation Token A",
        sourceTag: "fixture",
        sourceNote: "Invented candidate for simulation-pipeline tests.",
        observedLiquidityUsd: 50000,
        tags: ["fictional"],
      },
      {
        candidateId: "fic-sim-b",
        mint: FICTIONAL_MINT_B,
        symbol: "FICB",
        name: "Fictional Simulation Token B",
        sourceTag: "fixture",
        sourceNote: "Invented candidate for simulation-pipeline tests.",
        observedLiquidityUsd: 45000,
        tags: ["fictional"],
      },
    ],
  });

  // cleanRisk=true  → clean inspections, PASS risk → both paper-enter.
  // cleanRisk=false → freeze authority present on both → preflight warn → both watch (no enter).
  const inspection = (mint: string) => ({
    mint,
    decimals: 6,
    mintAuthorityPresent: false,
    freezeAuthorityPresent: !opts.cleanRisk,
    isInitialized: true,
    programLabel: "spl-token",
  });
  const risk = (mint: string) => ({
    mint,
    score: 10,
    decision: "PASS_FOR_PAPER_EVALUATION",
    flags: [],
    summary: ["fictional: no concern in invented data"],
  });
  const preflight = buildSniperTokenPreflightReport({
    candidateList,
    candidateData: [
      { candidateId: "fic-sim-a", inspection: inspection(FICTIONAL_MINT_A), risk: risk(FICTIONAL_MINT_A) },
      { candidateId: "fic-sim-b", inspection: inspection(FICTIONAL_MINT_B), risk: risk(FICTIONAL_MINT_B) },
    ],
  });

  const policy = normalizeSniperPolicyConfigV2({
    policyLabel: "fictional-simulation-policy",
    policyMode: "balanced-paper",
    allowPaperEnter: true,
    requirePreflightPass: true,
    failClosedOnUnknownPreflight: true,
    failClosedOnMissingRisk: true,
  });

  const decision = buildPaperSniperDecisionReportV2({ candidateList, preflight, policy });
  const runReport = buildSniperRunReportV2({
    candidateList,
    preflight,
    decision,
    policy,
    operatorLabel: FICTIONAL_OPERATOR,
  });
  const decisionV1 = buildPaperSniperDecisionReport({ candidateList, preflight });
  const runReportV1 = buildSniperRunReport({ candidateList, preflight, decision: decisionV1 });
  const auditLog = buildSniperAuditLog({ runReport: runReportV1, runLabel: "fictional-simulation-run" });
  const sessionPack = buildSniperSessionPack({
    sessionLabel: "fictional-simulation-session",
    artifacts: [
      { label: "candidates", value: candidateList },
      { label: "preflight", value: preflight },
      { label: "decision", value: decision },
      { label: "run-report", value: runReport },
      { label: "audit-log", value: auditLog },
      { label: "policy", value: policy },
    ],
  });
  const specs = buildAdoptedSpecs();
  const gates = buildSniperSafetyGatesReportV2({
    candidateList,
    preflight,
    policy,
    decision,
    runReport,
    sessionPack,
    auditLog,
    operatorLabel: FICTIONAL_OPERATOR,
  });
  const prereqs = buildPhase6PrerequisiteReportV2({
    sessionPack,
    policy,
    safetyGates: gates,
    decision,
    runReport,
    auditLog,
    killSwitchSpec: specs.killSwitchSpec,
    secretsPolicy: specs.secretsPolicy,
    burnerIsolationSpec: specs.burnerIsolationSpec,
    operatorLabel: FICTIONAL_OPERATOR,
  });

  return { candidateList, preflight, policy, decision, runReport, auditLog, sessionPack, gates, prereqs, ...specs };
}

/**
 * The FICTIONAL ready chain: both candidates clean → two paper-enters; gates READY; every prereq
 * bucket met except the operator bucket's NO_OPERATOR_BLOCKING item (paper-enters always demand
 * review by design — the plan builder's explicit acknowledgment path exists for exactly this).
 */
export function buildFictionalReadyChain(): FictionalSimulationChain {
  return buildChain({ cleanRisk: true });
}

/**
 * The FICTIONAL watch-only chain: freeze authority on both candidates → preflight warn → watch
 * (no paper-enter anywhere); gates READY; every prereq bucket FULLY met.
 */
export function buildFictionalWatchOnlyChain(): FictionalSimulationChain {
  return buildChain({ cleanRisk: false });
}
