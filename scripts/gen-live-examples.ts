/**
 * Generate committed EXAMPLE artifacts for the @soulmaker/live schemas (Sprint 107, Part 1).
 *
 * Deterministic (fixed timestamp + a real unsigned probe envelope), so re-running produces
 * byte-identical output. No network, wallet, or chain activity. Run: `pnpm tsx scripts/gen-live-examples.ts`.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Relative source imports: scripts/ is not a workspace package, so @soulmaker/* does not resolve.
import {
  buildLiveCanaryRequest,
  buildLivePolicy,
  evaluateLivePolicy,
  redactCanaryRequestForOutput,
  scoreLiveCandidate,
  type BuildLiveCanaryRequestInput,
} from "../packages/live/src/index.js";
import { redactValue } from "../packages/security/src/index.js";
import { buildUnsignedSelfTransferProbe } from "../packages/txpreview/src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(dirname(HERE), "examples", "live");

const CREATED_AT = "2026-06-18T00:00:00.000Z";
const NOW_MS = Date.parse(CREATED_AT);
const FIXTURE_PUBKEY = "So11111111111111111111111111111111111111112"; // public address, fixture only
const CANDIDATE = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Write an already-redaction-final value. */
function write(name: string, finalValue: unknown): void {
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(finalValue, null, 2) + "\n");
  console.log(`wrote ${path}`);
}

const liveCanaryPolicy = buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" });
const paperPolicy = buildLivePolicy();
const envelope = buildUnsignedSelfTransferProbe({ feePayerPublicKey: FIXTURE_PUBKEY, network: "mainnet-beta" });

const quote = {
  provider: "jupiter-lite-api",
  inputMint: FIXTURE_PUBKEY,
  outputMint: CANDIDATE,
  inAmountRaw: "5000000",
  outAmountRaw: "4985000",
  slippageBps: 50,
  priceImpactPct: 0.18,
  quotedAt: CREATED_AT,
  ageMs: 1200,
  routeLabels: ["jupiter"],
};
const cleanRisk = { score: 12, decision: "PASS_FOR_PAPER_EVALUATION", criticalFlagCount: 0, flagIds: [] };

function canaryInput(overrides: Partial<BuildLiveCanaryRequestInput>): BuildLiveCanaryRequestInput {
  return {
    policy: liveCanaryPolicy,
    createdAt: CREATED_AT,
    nowMs: NOW_MS,
    candidate: { mint: CANDIDATE, symbol: "USDC" },
    quote,
    risk: cleanRisk,
    preflight: { simulationOutcome: "simulated-ok", simulationClassification: "none" },
    spendLamports: "5000000",
    envelope,
    auditLogPathProvided: true,
    ...overrides,
  };
}

// 1) Policies + their gate evaluations (no envelope → plain redactValue is safe).
write("policy.live-canary.example.json", redactValue({ policy: liveCanaryPolicy, evaluation: evaluateLivePolicy(liveCanaryPolicy) }));
write("policy.paper-default.example.json", redactValue({ policy: paperPolicy, evaluation: evaluateLivePolicy(paperPolicy) }));

// 2) Canary requests (embed an unsigned envelope → redact WITHOUT corrupting txBase64).
write("canary-request.preflight-ready.example.json", redactCanaryRequestForOutput(buildLiveCanaryRequest(canaryInput({}))));
write(
  "canary-request.blocked-by-risk.example.json",
  redactCanaryRequestForOutput(buildLiveCanaryRequest(canaryInput({ risk: { score: 85, decision: "REJECT", criticalFlagCount: 1, flagIds: ["freeze-authority-present"] } }))),
);
write("canary-request.blocked-by-policy.example.json", redactCanaryRequestForOutput(buildLiveCanaryRequest(canaryInput({ policy: paperPolicy }))));

// 3) A live-candidate decision (a strong, clean candidate).
write(
  "candidate-decision.live.example.json",
  redactValue(
    scoreLiveCandidate({
      signals: {
        mint: CANDIDATE,
        risk: { score: 8, decision: "PASS_FOR_PAPER_EVALUATION", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false },
        liquidityUsd: 60_000,
        volumeUsd: 30_000,
        poolAgeSeconds: 7200,
        priceImpactPct: 0.3,
        quoteAgeMs: 1100,
        holderTop1Pct: 11,
        routeConfidence: 0.92,
        denylisted: false,
        allowlisted: false,
      },
      timestamp: CREATED_AT,
      providers: ["jupiter-lite-api"],
    }),
  ),
);

console.log("done: live example artifacts");
