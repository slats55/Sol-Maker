/**
 * Sprint 93 — `execution:devnet:rehearse` at the CLI layer.
 *
 * Pins:
 *   - the same double opt-in as execution:devnet:send (env flag + CLI acknowledgment);
 *   - mainnet endpoints refused outright; no mainnet variant exists;
 *   - a generated throwaway keypair is written ONLY under a runs/ path, with the gitignored
 *     `.keypair` suffix, and its secret bytes never appear in any other written artifact or in
 *     the CLI output;
 *   - happy path over injected seams: report + audit journal written, signature + slot reported;
 *   - airdrop unavailability becomes an honest devnet-funding-blocked artifact (exit 1).
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import type { RehearsalRpc, SendRpcLike } from "@soulmaker/execution";
import { executionDevnetRehearseReport } from "./commands.js";

const FULL_ENV = { SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only" };

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "exec-rehearse-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeConfig(tmp: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", ...extra }));
}

function fakeRehearsalRpc(options: { airdropError?: string } = {}): RehearsalRpc {
  let funded = false;
  const send: SendRpcLike = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
    sendRawTransaction: async () => "FakeRehearsalSignature11111111111111111111111",
  };
  return Object.freeze({
    endpointHost: "fake.devnet.example.com",
    faucet: {
      getBalanceLamports: async () => (funded ? 1_000_000_000 : 0),
      requestAirdrop: async () => {
        if (options.airdropError) throw new Error(options.airdropError);
        funded = true;
        return "FakeAirdropSignature1111111111111111111111111";
      },
      getSignatureStatus: async () => ({ confirmed: true, slot: 31337, errLabel: null }),
    },
    send,
  });
}

describe("execution:devnet:rehearse — opt-ins and refusals", () => {
  it("REFUSES without the env flag + CLI acknowledgment (same wall as devnet:send)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const noEnv = await executionDevnetRehearseReport(
        { cwd: tmp, env: {}, createRehearsalRpc: () => fakeRehearsalRpc() },
        { outDir: "runs/r1", acknowledgeDevnetExecution: true },
      );
      expect(noEnv.exitCode).toBe(1);
      expect(noEnv.text).toContain("NOT enabled");

      const noFlag = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc() },
        { outDir: "runs/r1" },
      );
      expect(noFlag.exitCode).toBe(1);
      expect(noFlag.text).toContain("NOT enabled");
    });
  });

  it("REFUSES a mainnet-looking endpoint outright", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc() },
        { outDir: "runs/r1", acknowledgeDevnetExecution: true, rpcUrl: "https://api.mainnet-beta.solana.com" },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("never talks to a mainnet endpoint");
    });
  });

  it("REFUSES to generate a throwaway keypair outside a runs/ directory", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc() },
        { outDir: "not-ignored/r1", acknowledgeDevnetExecution: true },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("only written under a runs/ directory");
      expect(r.text).toContain("--signer-env");
    });
  });
});

describe("execution:devnet:rehearse — the full chain over injected seams", () => {
  it("happy path: throwaway keypair under runs/, report + audit written, signature + slot reported; no secret leaks", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetRehearseReport(
        {
          cwd: tmp,
          env: FULL_ENV,
          createRehearsalRpc: () => fakeRehearsalRpc(),
          createTxPreview: () => ({
            endpointHost: "fake.devnet.example.com",
            rpc: {
              simulateTransaction: async () => ({
                context: { slot: 31337, apiVersion: "1.18" },
                value: { err: null, logs: ["Program 11111111111111111111111111111111 success"], unitsConsumed: 150 },
              }),
            },
          }),
          now: () => "2026-06-12T07:00:00.000Z",
          sleep: async () => {},
        },
        { outDir: join("runs", "rehearsal-1"), acknowledgeDevnetExecution: true, json: true },
      );
      expect(r.exitCode, r.text.slice(0, 800)).toBe(0);
      const report = JSON.parse(r.text) as Record<string, unknown> & {
        steps: Array<{ step: string; status: string }>;
        confirmation: { slot: number };
      };
      expect(report.outcome).toBe("rehearsed");
      expect(report.signature).toBe("FakeRehearsalSignature11111111111111111111111");
      expect(report.confirmation.slot).toBe(31337);
      expect(report.signerSource).toBe("generated-throwaway");
      expect(report.steps.map((s) => `${s.step}:${s.status}`)).toContain("simulate:ok");
      expect(report.neverMainnet).toBe(true);
      expect(report.phase7LiveTradingReady).toBe(false);

      const outDir = join(tmp, "runs", "rehearsal-1");
      const files = readdirSync(outDir).sort();
      expect(files).toEqual(["devnet-rehearsal-audit.jsonl", "devnet-rehearsal-report.json", "throwaway.devnet.keypair"]);

      // The keypair file is the ONLY artifact carrying the secret bytes.
      const keypairBytes = JSON.parse(readFileSync(join(outDir, "throwaway.devnet.keypair"), "utf8")) as number[];
      expect(keypairBytes).toHaveLength(64);
      const fingerprint = keypairBytes.slice(0, 6).join(",");
      for (const file of ["devnet-rehearsal-report.json", "devnet-rehearsal-audit.jsonl"]) {
        const text = readFileSync(join(outDir, file), "utf8");
        expect(text).not.toContain(fingerprint);
        expect(text).not.toMatch(/\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/);
        expect(text).not.toMatch(/"secretKey"|"privateKey"/i);
      }
      expect(r.text).not.toContain(fingerprint);

      const journal = readFileSync(join(outDir, "devnet-rehearsal-audit.jsonl"), "utf8").trim().split("\n");
      expect(journal).toHaveLength(1);
      expect((JSON.parse(journal[0] as string) as Record<string, unknown>).outcome).toBe("submitted");
    });
  });

  it("airdrop unavailable => honest devnet-funding-blocked artifact, exit 1, steps preserved", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc({ airdropError: "429 rate limited" }), sleep: async () => {} },
        { outDir: join("runs", "rehearsal-blocked"), acknowledgeDevnetExecution: true, skipSimulation: true },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("DEVNET-FUNDING-BLOCKED");
      const report = JSON.parse(readFileSync(join(tmp, "runs", "rehearsal-blocked", "devnet-rehearsal-report.json"), "utf8")) as {
        outcome: string;
        airdrop: { status: string };
        steps: Array<{ step: string }>;
        signature: string | null;
      };
      expect(report.outcome).toBe("devnet-funding-blocked");
      expect(report.airdrop.status).toBe("unavailable");
      expect(report.signature).toBeNull();
      expect(report.steps.map((s) => s.step)).toEqual(["mode", "signer", "funding"]);
    });
  });

  it("an operator-env signer skips throwaway generation and may live outside runs/", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const keyPath = join(tmp, "operator-devnet-signer.json");
      writeFileSync(keyPath, JSON.stringify(Array.from(Keypair.generate().secretKey)));
      mkdirSync(join(tmp, "elsewhere"), { recursive: true });
      const r = await executionDevnetRehearseReport(
        {
          cwd: tmp,
          env: { ...FULL_ENV, TEST_DEVNET_SIGNER: keyPath },
          createRehearsalRpc: () => fakeRehearsalRpc(),
          sleep: async () => {},
        },
        { outDir: join("elsewhere", "r1"), acknowledgeDevnetExecution: true, signerEnvVar: "TEST_DEVNET_SIGNER", skipSimulation: true, json: true },
      );
      expect(r.exitCode, r.text.slice(0, 800)).toBe(0);
      const report = JSON.parse(r.text) as { signerSource: string; throwawayFilePath: string | null; outcome: string };
      expect(report.signerSource).toBe("operator-env");
      expect(report.throwawayFilePath).toBeNull();
      expect(report.outcome).toBe("rehearsed");
      const files = readdirSync(join(tmp, "elsewhere", "r1")).sort();
      expect(files).toEqual(["devnet-rehearsal-audit.jsonl", "devnet-rehearsal-report.json"]);
    });
  });

  it("S94: a SECOND run in the same out dir REUSES the existing throwaway keypair (same public key; funding sticks)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const outDir = join("runs", "reuse-1");
      const first = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc(), sleep: async () => {} },
        { outDir, acknowledgeDevnetExecution: true, skipSimulation: true, json: true },
      );
      expect(first.exitCode, first.text.slice(0, 400)).toBe(0);
      const firstReport = JSON.parse(first.text) as { signerSource: string; signerPublicKey: string };
      expect(firstReport.signerSource).toBe("generated-throwaway");
      const keypairBytesBefore = readFileSync(join(tmp, outDir, "throwaway.devnet.keypair"), "utf8");

      const second = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc(), sleep: async () => {} },
        { outDir, acknowledgeDevnetExecution: true, skipSimulation: true, json: true, force: true },
      );
      expect(second.exitCode, second.text.slice(0, 400)).toBe(0);
      const secondReport = JSON.parse(second.text) as { signerSource: string; signerPublicKey: string };
      expect(secondReport.signerSource).toBe("reused-throwaway");
      expect(secondReport.signerPublicKey).toBe(firstReport.signerPublicKey);
      // The keypair file was NOT regenerated — external funding would have stayed on this key.
      expect(readFileSync(join(tmp, outDir, "throwaway.devnet.keypair"), "utf8")).toBe(keypairBytesBefore);
    });
  });

  it("S94: --airdrop-attempts is validated (integer 1..5; the faucet is never spammed)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      for (const bad of ["0", "6", "2.5", "nope"]) {
        const r = await executionDevnetRehearseReport(
          { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc(), sleep: async () => {} },
          { outDir: join("runs", "attempts"), acknowledgeDevnetExecution: true, airdropAttempts: bad },
        );
        expect(r.exitCode, bad).toBe(1);
        expect(r.text).toContain("--airdrop-attempts");
      }
    });
  });

  it("S94: a funding-blocked run carries the attempts count and the exact funding guidance", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc({ airdropError: "429 rate limited" }), sleep: async () => {} },
        { outDir: join("runs", "blocked-2"), acknowledgeDevnetExecution: true, skipSimulation: true, airdropAttempts: "2" },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("NEXT: Fund the rehearsal public key");
      expect(r.text).toContain("faucet.solana.com");
      const report = JSON.parse(readFileSync(join(tmp, "runs", "blocked-2", "devnet-rehearsal-report.json"), "utf8")) as {
        airdrop: { attempts: number; maxAttempts: number };
        fundingGuidance: string[] | null;
        signerPublicKey: string;
      };
      expect(report.airdrop.attempts).toBe(2);
      expect(report.airdrop.maxAttempts).toBe(2);
      expect(report.fundingGuidance?.join("\n")).toContain(report.signerPublicKey);
    });
  });

  it("refuses to overwrite an existing rehearsal report without --force", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      mkdirSync(join(tmp, "runs", "r2"), { recursive: true });
      writeFileSync(join(tmp, "runs", "r2", "devnet-rehearsal-report.json"), "{}");
      const r = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc(), sleep: async () => {} },
        { outDir: join("runs", "r2"), acknowledgeDevnetExecution: true },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("already exists");
    });
  });
});
