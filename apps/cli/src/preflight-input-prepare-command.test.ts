/**
 * Sprint 90 — `paper:sniper:preflight:input:prepare` (the READ-ONLY INTELLIGENCE BRIDGE) plus the
 * `token:inspect --json/--out` and `token:risk --out` capture flags that feed it.
 *
 * The bridge is the missing link between the read-only intelligence commands and the PAPER
 * dry-run: standalone `token:inspect --json` / `token:risk --json` output files are paired to a
 * candidate list BY MINT and emitted as the canonical `sniper.preflight.input.v1` artifact that
 * `paper:sniper:dry-run --preflight-input` consumes. These tests pin:
 *
 *   - fixture generation THROUGH PRODUCTION CODE: the inspect/risk JSON files are written by the
 *     real `tokenInspectReport` / `tokenRiskReport` command functions over an in-memory read-only
 *     client (no network — and the risk engine is the real engine);
 *   - the happy path: prepared artifact validates with the production validator, carries the
 *     read-only outputs VERBATIM, and drives a full dry-run to an unblocked 2-entry intent plan;
 *   - honesty: a candidate with no data stays uncovered with an explicit warning (never "safe");
 *   - refusals: malformed JSON, cross-kind files (inspect↔risk named explicitly), files that look
 *     like neither, missing/invalid/secret-length mints (never echoed), unknown mints, duplicate
 *     files for one mint, secret-shaped key names, wrong-schema candidate lists, --out overwrite;
 *   - byte determinism of the written artifact.
 *
 * All mints are FICTIONAL fixture mints. Nothing here is live data, a trade signal, or a
 * profitability claim.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FICTIONAL_MINT_A, FICTIONAL_MINT_B } from "@soulmaker/simulation";
import { validateSniperPreflightInput } from "@soulmaker/sniper";
import { validateSimulationIntentPlanV2 } from "@soulmaker/simulation";
import type { PublicKeyInput, ReadOnlyClientConfig, ReadOnlySolanaClient } from "@soulmaker/solana";
import {
  paperSniperPreflightInputPrepareReport,
  paperSniperDryRunReport,
  tokenInspectReport,
  tokenRiskReport,
} from "./commands.js";

// A real, well-known public key that is deliberately NOT in any candidate list here.
const OUTSIDE_MINT = "So11111111111111111111111111111111111111112";

/** In-memory read-only client: echoes the requested mint so per-mint fixtures differ. */
function fakeSolanaClient(): ReadOnlySolanaClient {
  return {
    endpointHost: "rpc.example.com",
    getRpcHealth: async () => ({ ok: true, endpointHost: "rpc.example.com", solanaCore: "1.18.22", slot: 7 }),
    getVersion: async () => ({ solanaCore: "1.18.22" }),
    getSolBalance: async () => ({ ownerBase58: OUTSIDE_MINT, lamports: 0, sol: 0 }),
    getTokenAccounts: async () => [],
    getTokenMintInfo: async (mint: PublicKeyInput) => ({
      mint: typeof mint === "string" ? mint : mint.toBase58(),
      decimals: 6,
      supplyRaw: "1000000000",
      uiSupply: 1000,
      mintAuthorityPresent: false,
      freezeAuthorityPresent: false,
      isInitialized: true,
      programLabel: "spl-token",
      source: "test",
    }),
  };
}
const fakeClientFactory = (_config: ReadOnlyClientConfig): ReadOnlySolanaClient => fakeSolanaClient();

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "pf-prepare-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Async-aware variant: the cleanup must wait for the awaited work, not the returned promise. */
async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "pf-prepare-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** A read-only-capable test context (WATCH_ONLY config + in-memory client). */
function readCtx(tmp: string) {
  writeFileSync(
    join(tmp, "soulmaker.config.json"),
    JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }, null, 2),
  );
  return { cwd: tmp, env: {}, createClient: fakeClientFactory };
}

function writeCandidates(tmp: string): string {
  writeFileSync(
    join(tmp, "candidates.json"),
    JSON.stringify(
      {
        sourceLabel: "fictional-bridge-candidates",
        candidates: [
          { candidateId: "c-a", mint: FICTIONAL_MINT_A, symbol: "FICA", observedLiquidityUsd: 50000 },
          { candidateId: "c-b", mint: FICTIONAL_MINT_B, symbol: "FICB", observedLiquidityUsd: 45000 },
        ],
      },
      null,
      2,
    ),
  );
  return "candidates.json";
}

/** Generate inspect/risk JSON fixtures THROUGH the production command functions. */
async function generateReadOnlyOutputs(tmp: string, ctx: ReturnType<typeof readCtx>): Promise<void> {
  for (const [tag, mint] of [
    ["a", FICTIONAL_MINT_A],
    ["b", FICTIONAL_MINT_B],
  ] as const) {
    const insp = await tokenInspectReport(mint, ctx, { json: true, outPath: `${tag}.inspect.json` });
    expect(insp.startsWith("Refusing"), insp.slice(0, 200)).toBe(false);
    const risk = await tokenRiskReport(mint, ctx, { json: true, outPath: `${tag}.risk.json` });
    expect(risk.startsWith("Refusing"), risk.slice(0, 200)).toBe(false);
  }
}

const readJson = (tmp: string, name: string): unknown => JSON.parse(readFileSync(join(tmp, name), "utf8"));

describe("token:inspect / token:risk — JSON capture flags (the bridge's upstream)", () => {
  it("token:inspect --json emits parseable inspection JSON and --out writes the same UTF-8 file", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const out = await tokenInspectReport(FICTIONAL_MINT_A, ctx, { json: true, outPath: "i.json" });
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(parsed.mint).toBe(FICTIONAL_MINT_A);
      expect(parsed.decimals).toBe(6);
      expect(readJson(tmp, "i.json")).toEqual(parsed);
    });
  });

  it("token:inspect --out refuses to overwrite without --force, overwrites with it", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const first = await tokenInspectReport(FICTIONAL_MINT_A, ctx, { json: true, outPath: "i.json" });
      expect(first.startsWith("Refusing")).toBe(false);
      const second = await tokenInspectReport(FICTIONAL_MINT_A, ctx, { json: true, outPath: "i.json" });
      expect(second).toMatch(/^Refusing: .*already exists/);
      const third = await tokenInspectReport(FICTIONAL_MINT_A, ctx, { json: true, outPath: "i.json", force: true });
      expect(third.startsWith("Refusing")).toBe(false);
    });
  });

  it("token:risk --out writes the advisory report JSON", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const out = await tokenRiskReport(FICTIONAL_MINT_A, ctx, { json: true, outPath: "r.json" });
      expect(out.startsWith("Refusing")).toBe(false);
      const parsed = readJson(tmp, "r.json") as Record<string, unknown>;
      expect(parsed.mint).toBe(FICTIONAL_MINT_A);
      expect(typeof parsed.score).toBe("number");
      expect(typeof parsed.decision).toBe("string");
    });
  });
});

describe("paper:sniper:preflight:input:prepare — refusals (fail-closed, exit 1)", () => {
  it("requires --candidates", () => {
    const r = paperSniperPreflightInputPrepareReport({}, { inspectPaths: ["x.json"] });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/^Refusing: --candidates/);
  });

  it("requires at least one --inspect or --risk", () => {
    const r = paperSniperPreflightInputPrepareReport({}, { candidatesPath: "candidates.json" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/^Refusing: supply at least one/);
  });

  it("refuses a wrong-schema candidate list", () => {
    withTmp((tmp) => {
      writeFileSync(join(tmp, "wrong.json"), JSON.stringify({ schemaVersion: "backtest.report.v1", candidates: [] }));
      writeFileSync(join(tmp, "i.json"), JSON.stringify({ mint: FICTIONAL_MINT_A, decimals: 6 }));
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: "wrong.json", inspectPaths: ["i.json"] },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("schemaVersion");
    });
  });

  it("refuses malformed JSON in an --inspect file", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      writeFileSync(join(tmp, "broken.json"), "{nope");
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["broken.json"] },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text.startsWith("Refusing:")).toBe(true);
    });
  });

  it("names the cross-up when a risk report is passed via --inspect (and vice versa)", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      writeFileSync(
        join(tmp, "r.json"),
        JSON.stringify({ mint: FICTIONAL_MINT_A, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [] }),
      );
      writeFileSync(join(tmp, "i.json"), JSON.stringify({ mint: FICTIONAL_MINT_A, decimals: 6, supplyRaw: "1" }));
      const a = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["r.json"] },
      );
      expect(a.exitCode).toBe(1);
      expect(a.text).toContain("looks like token:risk output");
      const b = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, riskPaths: ["i.json"] },
      );
      expect(b.exitCode).toBe(1);
      expect(b.text).toContain("looks like token:inspect output");
    });
  });

  it("refuses a file that looks like neither command's output", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      writeFileSync(join(tmp, "x.json"), JSON.stringify({ mint: FICTIONAL_MINT_A, something: true }));
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["x.json"] },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("does not look like token:inspect --json output");
    });
  });

  it("refuses a file with no mint string", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      writeFileSync(join(tmp, "x.json"), JSON.stringify({ decimals: 6, supplyRaw: "1" }));
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["x.json"] },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("carries no mint string");
    });
  });

  it("refuses a secret-length mint WITHOUT echoing it", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      const secretish = "2".repeat(88); // private-key-length base58 — must never be echoed
      writeFileSync(join(tmp, "x.json"), JSON.stringify({ mint: secretish, decimals: 6 }));
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["x.json"] },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text.startsWith("Refusing:")).toBe(true);
      expect(r.text).not.toContain(secretish);
    });
  });

  it("refuses a secret-shaped key name anywhere in an input file (value never echoed)", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      writeFileSync(
        join(tmp, "x.json"),
        JSON.stringify({ mint: FICTIONAL_MINT_A, decimals: 6, extra: { privateKey: "hunter2secretvalue" } }),
      );
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["x.json"] },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("secret-shaped key");
      expect(r.text).toContain("extra.privateKey");
      expect(r.text).not.toContain("hunter2secretvalue");
    });
  });

  it("refuses an output file whose mint matches no candidate", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      writeFileSync(join(tmp, "x.json"), JSON.stringify({ mint: OUTSIDE_MINT, decimals: 9, supplyRaw: "1" }));
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["x.json"] },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("not in the candidate list");
    });
  });

  it("refuses duplicate files for one mint", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      writeFileSync(join(tmp, "x1.json"), JSON.stringify({ mint: FICTIONAL_MINT_A, decimals: 6 }));
      writeFileSync(join(tmp, "x2.json"), JSON.stringify({ mint: FICTIONAL_MINT_A, decimals: 6 }));
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["x1.json", "x2.json"] },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("duplicate --inspect");
    });
  });

  it("refuses to overwrite an existing --out without --force", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const cands = writeCandidates(tmp);
      await generateReadOnlyOutputs(tmp, ctx);
      const opts = { candidatesPath: cands, inspectPaths: ["a.inspect.json", "b.inspect.json"], outPath: "pf.json" };
      expect(paperSniperPreflightInputPrepareReport({ cwd: tmp, env: {} }, opts).exitCode).toBe(0);
      const again = paperSniperPreflightInputPrepareReport({ cwd: tmp, env: {} }, opts);
      expect(again.exitCode).toBe(1);
      expect(again.text).toContain("already exists");
      expect(paperSniperPreflightInputPrepareReport({ cwd: tmp, env: {} }, { ...opts, force: true }).exitCode).toBe(0);
    });
  });
});

describe("paper:sniper:preflight:input:prepare — happy path (production-generated inputs)", () => {
  it("pairs by mint, carries values VERBATIM, validates, and prints the next dry-run command", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const cands = writeCandidates(tmp);
      await generateReadOnlyOutputs(tmp, ctx);

      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        {
          candidatesPath: cands,
          inspectPaths: ["a.inspect.json", "b.inspect.json"],
          riskPaths: ["a.risk.json", "b.risk.json"],
          outPath: "pf.json",
        },
      );
      expect(r.exitCode, r.text.slice(0, 300)).toBe(0);
      expect(r.text).toContain("Next:");
      expect(r.text).toContain("paper:sniper:dry-run --candidates");
      expect(r.text).toContain("--preflight-input");
      expect(r.text).toContain("web:inspect --dir");

      const artifact = validateSniperPreflightInput(readJson(tmp, "pf.json"));
      expect(artifact.entryCount).toBe(2);
      expect(artifact.entries.map((e) => e.candidateId)).toEqual(["c-a", "c-b"]);
      expect(artifact.crossCheckedAgainstCandidateList).toBe(true);
      expect(artifact.uncoveredCandidateCount).toBe(0);
      expect(artifact.validationStatus).toBe("valid");
      // VERBATIM carry: the artifact's inspection/risk are byte-equal to the read-only outputs.
      expect(artifact.entries[0]?.inspection).toEqual(readJson(tmp, "a.inspect.json"));
      expect(artifact.entries[0]?.risk).toEqual(readJson(tmp, "a.risk.json"));
      expect(artifact.entries[0]?.sourceLabel).toBe("inspect:a.inspect.json + risk:a.risk.json");
    });
  });

  it("emits the same canonical artifact via --json", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const cands = writeCandidates(tmp);
      await generateReadOnlyOutputs(tmp, ctx);
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["a.inspect.json"], riskPaths: ["a.risk.json"], json: true },
      );
      expect(r.exitCode).toBe(0);
      const artifact = validateSniperPreflightInput(JSON.parse(r.text));
      expect(artifact.entryCount).toBe(2);
    });
  });

  it("a candidate without data stays honestly uncovered — warned, never marked safe", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const cands = writeCandidates(tmp);
      await generateReadOnlyOutputs(tmp, ctx);
      const r = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["a.inspect.json"], json: true },
      );
      expect(r.exitCode).toBe(0); // warnings are honest, not fatal by default
      const artifact = validateSniperPreflightInput(JSON.parse(r.text));
      expect(artifact.validationStatus).toBe("valid-with-warnings");
      expect(artifact.missingInspectionCount).toBe(1); // c-b
      expect(artifact.missingRiskCount).toBe(2); // both
      const cb = artifact.entries.find((e) => e.candidateId === "c-b");
      expect(cb?.warnings.some((w) => w.includes("no usable inspection or risk data"))).toBe(true);

      // CI gates make the gaps loud on demand.
      const gated = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, inspectPaths: ["a.inspect.json"], failOnMissingRisk: true },
      );
      expect(gated.exitCode).toBe(1);
    });
  });

  it("writes a byte-deterministic artifact across two runs", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const cands = writeCandidates(tmp);
      await generateReadOnlyOutputs(tmp, ctx);
      const opts = {
        candidatesPath: cands,
        inspectPaths: ["a.inspect.json", "b.inspect.json"],
        riskPaths: ["a.risk.json", "b.risk.json"],
      };
      paperSniperPreflightInputPrepareReport({ cwd: tmp, env: {} }, { ...opts, outPath: "pf1.json" });
      paperSniperPreflightInputPrepareReport({ cwd: tmp, env: {} }, { ...opts, outPath: "pf2.json" });
      expect(readFileSync(join(tmp, "pf1.json"), "utf8")).toBe(readFileSync(join(tmp, "pf2.json"), "utf8"));
    });
  });

  it("BRIDGE PROOF: the prepared artifact drives paper:sniper:dry-run to an unblocked 2-entry plan", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = readCtx(tmp);
      const cands = writeCandidates(tmp);
      await generateReadOnlyOutputs(tmp, ctx);
      const prep = paperSniperPreflightInputPrepareReport(
        { cwd: tmp, env: {} },
        {
          candidatesPath: cands,
          inspectPaths: ["a.inspect.json", "b.inspect.json"],
          riskPaths: ["a.risk.json", "b.risk.json"],
          outPath: "pf.json",
        },
      );
      expect(prep.exitCode, prep.text.slice(0, 300)).toBe(0);

      const dry = paperSniperDryRunReport(
        { cwd: tmp, env: {} },
        {
          candidatesPath: cands,
          preflightInputPath: "pf.json",
          adoptSpecs: true,
          acknowledgePaperEnterReview: true,
          operatorLabel: "fictional-operator",
          runLabel: "fictional-bridge-run",
          outDir: "out",
        },
      );
      expect(dry.exitCode, dry.text.slice(0, 300)).toBe(0);
      const plan = validateSimulationIntentPlanV2(readJson(tmp, join("out", "intent-plan.json")));
      expect(plan.blocked).toBe(false);
      expect(plan.entryCount).toBe(2); // both candidates flowed through with real preflight data
    });
  });
});
