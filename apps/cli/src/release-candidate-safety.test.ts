/**
 * Sprint 102 — the no-send / no-signer / no-bypass safety wall around the mainnet dry-run RELEASE
 * CANDIDATE. These are the tests that should fail loudly the day someone tries to bolt a mainnet
 * send command, a live-arming flag, a signer, or a score-can-override-the-gate hole onto the
 * release-candidate path.
 *
 * Pins:
 *   - the CLI registers NO mainnet-send command and NO live-arming bypass flag;
 *   - the rehearse mode set is CLOSED and carries no mainnet-live mode;
 *   - the release candidate is structurally incapable of claiming live enabled (liveSendStatus is
 *     pinned "disabled"; a tampered "enabled" / a stray send-result field is refused);
 *   - a candidate score can NEVER override a risk / build / simulation gate;
 *   - a real mainnet-dry-run run never touches a send seam and still produces the RC;
 *   - no keypair / run artifact is committed (runs/ is gitignored; the example folder is key-free).
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJupiterQuoteAdapter, type FetchLike } from "@soulmaker/quotefetch";
import { createJupiterSwapBuilder, type FetchLike as BuilderFetchLike } from "@soulmaker/txbuilder";
import {
  buildMainnetDryRunReleaseCandidate,
  validateMainnetDryRunReleaseCandidate,
  SniperReleaseCandidateError,
  type BuildMainnetDryRunReleaseCandidateInput,
} from "@soulmaker/sniper";
import { paperSniperRehearseReport, SNIPER_REHEARSE_MODES } from "./commands.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function completeEvidence(): BuildMainnetDryRunReleaseCandidateInput {
  return {
    network: "mainnet-beta",
    candidateSource: { kind: "file", label: "candidates.json" },
    scoring: { available: true, engineSource: "rust", candidateCount: 1, bestCandidateId: "c1", rankedCandidates: [{ candidateId: "c1", mint: WSOL, rank: 1, score: 100, verdict: "watch", reasonCodes: ["paper-only"] }] },
    risk: { assessed: true, source: "automatic", worstDecision: "PASS_FOR_PAPER_EVALUATION", rejected: false, criticalFlagCount: 0, highFlagCount: 0, token2022Blocker: false, token2022BlockerMints: [] },
    quote: { attempted: true, observed: true, freshness: "fresh", scoreAvailable: true, score: 99 },
    build: { attempted: true, refused: false, succeeded: true, refusalCodes: [] },
    txInspection: { available: true, versionSupported: true, blockhashPresent: true, instructionCount: 7, unresolvableProgramIdCount: 0 },
    simulation: { attempted: true, outcome: "simulated-ok", classification: null, failed: false },
    readiness: { available: true, verdict: "blocked", satisfiedCount: 8, totalChecks: 14 },
  };
}

describe("S102 RC safety — no mainnet send command, no live-arming bypass flag", () => {
  it("the CLI registers only the S111 mainnet allowlist as mainnet senders and no live-arming flag", () => {
    const source = readFileSync(join(HERE, "index.ts"), "utf8");
    const commands = [...source.matchAll(/\.command\("([^"]+)"\)/g)].map((m) => m[1] as string);
    for (const command of commands) {
      if (command === "execution:mainnet:send" || command === "execution:mainnet:sell") continue;
      expect(command, command).not.toMatch(/mainnet.*send|send.*mainnet|live.*send|send.*live|mainnet.*live/i);
    }
    const options = [...source.matchAll(/\.option\("(--[a-z0-9-]+)/gi)].map((m) => m[1] as string);
    // No flag may arm, force, enable, or bypass live trading / the gate / the dry-run.
    for (const opt of options) {
      expect(opt, opt).not.toMatch(/^--(force-live|enable-live|mainnet-send|mainnet-live|arm|arm-live|go-live|bypass|bypass-gate|disable-gate|no-dry-run|live-send|allow-live)/i);
    }
    // The known legitimate send/ack flags are devnet-scoped, never mainnet.
    expect(options).toContain("--devnet-send");
  });

  it("the rehearse mode set is CLOSED (paper | devnet | mainnet-dry-run) with no live mode", () => {
    expect([...SNIPER_REHEARSE_MODES]).toEqual(["paper", "devnet", "mainnet-dry-run"]);
    expect(SNIPER_REHEARSE_MODES).not.toContain("mainnet-live");
  });
});

describe("S102 RC safety — the artifact can never claim live enabled", () => {
  it("liveSendStatus is pinned 'disabled' and survives a hostile input", () => {
    const hostile = { ...completeEvidence(), liveSendStatus: "enabled", phase7LiveTradingReady: true } as unknown as BuildMainnetDryRunReleaseCandidateInput;
    const rc = buildMainnetDryRunReleaseCandidate(hostile);
    expect(rc.liveSendStatus).toBe("disabled");
    expect(rc.phase7LiveTradingReady).toBe(false);
    expect(rc.neverSends).toBe(true);
    expect(rc.neverSigns).toBe(true);
  });

  it("a tampered artifact that claims live enabled is refused", () => {
    const rc = buildMainnetDryRunReleaseCandidate(completeEvidence()) as unknown as Record<string, unknown>;
    rc.liveSendStatus = "enabled";
    expect(() => validateMainnetDryRunReleaseCandidate(rc)).toThrow(SniperReleaseCandidateError);
  });

  it("a tampered artifact carrying a send result / signature is refused (closed schema)", () => {
    for (const field of ["sendResult", "signature", "slot", "txid"]) {
      const rc = buildMainnetDryRunReleaseCandidate(completeEvidence()) as unknown as Record<string, unknown>;
      rc[field] = "x";
      expect(() => validateMainnetDryRunReleaseCandidate(rc), field).toThrow(/unknown field/i);
    }
  });
});

describe("S102 RC safety — a candidate score can never override a gate", () => {
  it("a perfect-scoring candidate cannot turn a blocked gate into complete", () => {
    const blockers: Array<(e: BuildMainnetDryRunReleaseCandidateInput) => void> = [
      (e) => {
        e.risk.rejected = true;
        e.risk.worstDecision = "REJECT";
      },
      (e) => {
        e.risk.criticalFlagCount = 1;
      },
      (e) => {
        e.risk.token2022Blocker = true;
        e.risk.token2022BlockerMints = [USDC];
      },
      (e) => {
        e.build.refused = true;
        e.build.succeeded = false;
      },
      (e) => {
        e.simulation.outcome = "failed";
        e.simulation.failed = true;
      },
      (e) => {
        e.quote.freshness = "stale";
      },
    ];
    for (const block of blockers) {
      const ev = completeEvidence();
      // Always keep the top candidate at a perfect score — it must NOT rescue the verdict.
      ev.scoring.rankedCandidates[0]!.score = 100;
      ev.scoring.rankedCandidates[0]!.verdict = "watch";
      block(ev);
      const rc = buildMainnetDryRunReleaseCandidate(ev);
      expect(rc.verdict).not.toBe("dryrun-complete-blocked-live");
      expect(rc.liveSendStatus).toBe("disabled");
    }
  });
});

describe("S102 RC safety — a real mainnet-dry-run run never touches a send seam", () => {
  it("the chain produces the RC with live DISABLED and the send seams untouched", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "rc-safety-"));
    try {
      writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }));
      writeFileSync(join(tmp, "candidates.json"), JSON.stringify({ sourceLabel: "t", candidates: [{ candidateId: "c-1", mint: USDC, symbol: "USDC" }] }));
      // Provider 429s: the build/sim stages skip with no network success — keeps the test light.
      const provider429: BuilderFetchLike = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
      let sendSeamTouched = 0;
      const ctx = {
        cwd: tmp,
        env: {} as NodeJS.ProcessEnv,
        now: (): string => "2026-06-12T08:00:00.000Z",
        engineBinaryExists: () => false,
        createQuoteAdapter: () => createJupiterQuoteAdapter({ fetchLike: provider429 as unknown as FetchLike, clock: () => "2026-06-12T08:00:00.000Z" }),
        createSwapBuilder: () => createJupiterSwapBuilder({ fetchLike: provider429, clock: () => "2026-06-12T08:00:00.000Z" }),
        createSendRpc: () => {
          sendSeamTouched += 1;
          throw new Error("send seam must never be touched");
        },
        createRehearsalRpc: () => {
          sendSeamTouched += 1;
          throw new Error("rehearsal send seam must never be touched");
        },
      };
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: "candidates.json",
        outDir: "out",
        wallet: "9X66NKUHd1z8tNh2D9mqT8oXQcJ2AAD9GRzrLo7ABrxX",
        amountSol: "0.001",
        slippageBps: "100",
        maxSpendSol: "0.01",
        slippageCapBps: "200",
        riskScoreCap: "60",
        maxQuoteAgeMs: "60000",
        json: true,
      });
      expect(r.exitCode, r.text.slice(0, 600)).toBe(0);
      const rc = validateMainnetDryRunReleaseCandidate(JSON.parse(readFileSync(join(tmp, "out", "release-candidate.json"), "utf8")));
      expect(rc.liveSendStatus).toBe("disabled");
      expect(rc.neverSends).toBe(true);
      expect(sendSeamTouched).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("S102 RC safety — no keypair / run artifact is committed", () => {
  it("runs/ is gitignored and the example folder is key-free", () => {
    const gitignore = readFileSync(join(HERE, "../../../.gitignore"), "utf8");
    expect(gitignore).toMatch(/^runs\/$/m);
    const exampleDir = join(HERE, "../../../examples/sniper/mainnet-dryrun-release-candidate");
    for (const name of readdirSync(exampleDir)) {
      expect(name, name).not.toMatch(/keypair|\.key$|secret|wallet/i);
    }
  });
});
