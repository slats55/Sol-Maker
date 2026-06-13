/**
 * Sprint 102 — regenerate the redacted example in
 * `examples/sniper/mainnet-dryrun-release-candidate/`.
 *
 * The example release candidate is produced THROUGH PRODUCTION CODE
 * (`buildMainnetDryRunReleaseCandidate`) with a fixed clock and FICTIONAL inputs, so the committed
 * file is byte-deterministic and always matches what the real
 * `paper:sniper:rehearse --mode mainnet-dry-run` would write for these facts. The pin test
 * (`apps/cli/src/mainnet-dryrun-rc-example.test.ts`) imports {@link buildMainnetDryRunRcExamples}
 * and fails loudly if the committed files drift.
 *
 * Run: `pnpm tsx scripts/gen-mainnet-dryrun-rc-example.ts`
 *
 * Everything here is FICTIONAL and NO-SEND: invented mints, invented evidence, no network, no
 * wallet, no key, no transaction. The artifact's live-send status is the literal "disabled" — this
 * example exists to show an operator what a complete no-send dry-run release candidate looks like,
 * never to imply any live capability.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Relative source import: scripts/ is not a workspace package, so @soulmaker/* does not resolve.
import {
  buildMainnetDryRunReleaseCandidate,
  validateMainnetDryRunReleaseCandidate,
  type BuildMainnetDryRunReleaseCandidateInput,
  type SniperMainnetDryRunReleaseCandidate,
} from "../packages/sniper/src/mainnet-dryrun-release-candidate.js";
import { FICTIONAL_MINT_A, FICTIONAL_MINT_B } from "../packages/simulation/src/index.js";

const FIXED_NOW = "2026-06-13T00:00:00.000Z";

/** The BEST possible outcome: every stage clean, live STILL disabled. */
function completeInput(): BuildMainnetDryRunReleaseCandidateInput {
  return {
    runId: "example-complete",
    generatedAt: FIXED_NOW,
    network: "mainnet-beta",
    candidateSource: { kind: "file", label: "candidates.example.json" },
    scoring: {
      available: true,
      engineSource: "rust",
      candidateCount: 1,
      bestCandidateId: "fic-a",
      rankedCandidates: [
        { candidateId: "fic-a", mint: FICTIONAL_MINT_A, rank: 1, score: 91, verdict: "watch", reasonCodes: ["paper-only", "mainnet-live-disabled"] },
      ],
    },
    risk: { assessed: true, source: "automatic", worstDecision: "PASS_FOR_PAPER_EVALUATION", rejected: false, criticalFlagCount: 0, highFlagCount: 0, token2022Blocker: false, token2022BlockerMints: [] },
    quote: { attempted: true, observed: true, freshness: "fresh", scoreAvailable: true, score: 90 },
    build: { attempted: true, refused: false, succeeded: true, refusalCodes: [] },
    txInspection: { available: true, versionSupported: true, blockhashPresent: true, instructionCount: 7, unresolvableProgramIdCount: 0 },
    simulation: { attempted: true, outcome: "simulated-ok", classification: null, failed: false },
    readiness: { available: true, verdict: "blocked", satisfiedCount: 8, totalChecks: 14 },
    artifactRefs: ["candidate-scores.json", "routequote-prepared.json", "quote-scores.json", "envelope.json", "tx-inspect.json", "tx-simulation.json", "readiness.json"],
  };
}

/** A risk-blocked outcome: one candidate is rejected, so the whole run is dryrun-blocked-risk. */
function blockedRiskInput(): BuildMainnetDryRunReleaseCandidateInput {
  return {
    runId: "example-blocked-risk",
    generatedAt: FIXED_NOW,
    network: "mainnet-beta",
    candidateSource: { kind: "file", label: "candidates.example.json" },
    scoring: {
      available: true,
      engineSource: "rust",
      candidateCount: 1,
      bestCandidateId: "fic-b",
      // A high score CANNOT rescue a rejected risk — the verdict stays blocked-risk.
      rankedCandidates: [
        { candidateId: "fic-b", mint: FICTIONAL_MINT_B, rank: 1, score: 58, verdict: "reject", reasonCodes: ["paper-only", "mainnet-live-disabled", "risk-rejected", "risk-over-threshold"] },
      ],
    },
    risk: { assessed: true, source: "automatic", worstDecision: "REJECT", rejected: true, criticalFlagCount: 1, highFlagCount: 0, token2022Blocker: false, token2022BlockerMints: [] },
    quote: { attempted: true, observed: true, freshness: "fresh", scoreAvailable: true, score: 88 },
    build: { attempted: false, refused: false, succeeded: false, refusalCodes: [] },
    txInspection: { available: false, versionSupported: null, blockhashPresent: null, instructionCount: null, unresolvableProgramIdCount: null },
    simulation: { attempted: false, outcome: null, classification: null, failed: false },
    readiness: { available: true, verdict: "blocked", satisfiedCount: 7, totalChecks: 14 },
    artifactRefs: ["candidate-scores.json", "risk", "readiness.json"],
  };
}

export interface RcExampleFile {
  readonly relPath: string;
  readonly artifact: SniperMainnetDryRunReleaseCandidate;
}

/** Build every example RC artifact (validated through the strict validator). Pure. */
export function buildMainnetDryRunRcExamples(): RcExampleFile[] {
  const files: RcExampleFile[] = [
    { relPath: "release-candidate.complete.example.json", artifact: buildMainnetDryRunReleaseCandidate(completeInput()) },
    { relPath: "release-candidate.blocked-risk.example.json", artifact: buildMainnetDryRunReleaseCandidate(blockedRiskInput()) },
  ];
  for (const f of files) validateMainnetDryRunReleaseCandidate(f.artifact);
  return files;
}

/** Serialize one artifact exactly as the CLI writes it (2-space JSON + trailing newline). */
export function serializeRcExample(artifact: SniperMainnetDryRunReleaseCandidate): string {
  return JSON.stringify(artifact, null, 2) + "\n";
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "examples", "sniper", "mainnet-dryrun-release-candidate");
  for (const f of buildMainnetDryRunRcExamples()) {
    const path = join(outDir, f.relPath);
    writeFileSync(path, serializeRcExample(f.artifact));
    console.log(`wrote ${path} (verdict ${f.artifact.verdict})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
