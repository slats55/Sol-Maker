/**
 * Sprint 103-B — `execution:devnet:funding-status` at the CLI layer (the devnet proof unblocker).
 *
 * Pins:
 *   - a status-only read NEVER sends and works from a bare --public-key;
 *   - mainnet endpoints are refused; an invalid public key is refused; a missing key source is refused;
 *   - --out writes the execution.devnet.funding_status.v1 artifact (refusing overwrite without --force);
 *   - --attempt-airdrop classifies a 429 faucet as faucet-rate-limited WITHOUT sending a trade;
 *   - --complete-if-funded refuses a bare --public-key (cannot sign) and, with a throwaway keypair +
 *     a funded balance, chains the devnet rehearsal (--skip-airdrop) to land the real broadcast;
 *   - no secret key bytes ever reach the funding-status artifact or the CLI output.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { validateDevnetFundingStatus, type RehearsalRpc, type SendRpcLike } from "@soulmaker/execution";
import { executionDevnetFundingStatusReport } from "./commands.js";

const FULL_ENV = { SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only" };
const PUBKEY = "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm";

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "exec-funding-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeConfig(tmp: string): void {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY" }));
}

function fakeRpc(options: { lamports?: number; airdropError?: string } = {}): RehearsalRpc {
  let funded = (options.lamports ?? 0) >= 100_000;
  const send: SendRpcLike = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
    sendRawTransaction: async () => "FakeFundingProofSignature1111111111111111111",
  };
  return Object.freeze({
    endpointHost: "fake.devnet.example.com",
    faucet: {
      getBalanceLamports: async () => (funded ? (options.lamports ?? 1_000_000_000) : (options.lamports ?? 0)),
      requestAirdrop: async () => {
        if (options.airdropError) throw new Error(options.airdropError);
        funded = true;
        return "FakeAirdropSignature1111111111111111111111111";
      },
      getSignatureStatus: async () => ({ confirmed: true, slot: 4242, errLabel: null }),
    },
    send,
  });
}

function fakePreview() {
  return {
    endpointHost: "fake.devnet.example.com",
    rpc: {
      simulateTransaction: async () => ({
        context: { slot: 4242, apiVersion: "1.18" },
        value: { err: null, logs: ["Program 11111111111111111111111111111111 success"], unitsConsumed: 150 },
      }),
    },
  };
}

describe("execution:devnet:funding-status — read-only status", () => {
  it("a funded key reads funded + can-broadcast and never sends", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetFundingStatusReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRpc({ lamports: 1_000_000_000 }), now: () => "2026-06-13T00:00:00.000Z" },
        { publicKey: PUBKEY, json: true },
      );
      expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
      const report = validateDevnetFundingStatus(JSON.parse(r.text));
      expect(report.funded).toBe(true);
      expect(report.canBroadcastDevnetProbe).toBe(true);
      expect(report.fundingSourceStatus).toBe("funded");
      expect(report.publicKey).toBe(PUBKEY);
      expect(report.network).toBe("devnet");
    });
  });

  it("an unfunded key reads unfunded with honest funding guidance, exit 0, no send", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetFundingStatusReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRpc({ lamports: 0 }) },
        { publicKey: PUBKEY },
      );
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("UNFUNDED");
      expect(r.text).toContain("faucet.solana.com");
    });
  });

  it("REFUSES a mainnet endpoint outright", async () => {
    const r = await executionDevnetFundingStatusReport(
      { createRehearsalRpc: () => fakeRpc() },
      { publicKey: PUBKEY, rpcUrl: "https://api.mainnet-beta.solana.com" },
    );
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("never talks to a mainnet endpoint");
  });

  it("REFUSES an invalid public key and a missing key source", async () => {
    const bad = await executionDevnetFundingStatusReport({ createRehearsalRpc: () => fakeRpc() }, { publicKey: "not-a-key" });
    expect(bad.exitCode).toBe(1);
    expect(bad.text).toContain("not a valid base58");

    const none = await executionDevnetFundingStatusReport({ createRehearsalRpc: () => fakeRpc() }, {});
    expect(none.exitCode).toBe(1);
    expect(none.text).toContain("provide --public-key");
  });

  it("a thrown balance read is rpc-unavailable; never funded", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const rpc: RehearsalRpc = Object.freeze({
        endpointHost: "fake.devnet.example.com",
        faucet: {
          getBalanceLamports: async () => {
            throw new Error("connect ETIMEDOUT");
          },
          requestAirdrop: async () => "x",
          getSignatureStatus: async () => ({ confirmed: false, slot: null, errLabel: null }),
        },
        send: { getLatestBlockhash: async () => ({ blockhash: "x" }), sendRawTransaction: async () => "x" },
      });
      const r = await executionDevnetFundingStatusReport({ cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => rpc }, { publicKey: PUBKEY, json: true });
      const report = validateDevnetFundingStatus(JSON.parse(r.text));
      expect(report.fundingSourceStatus).toBe("rpc-unavailable");
      expect(report.funded).toBe(false);
      expect(report.lamports).toBeNull();
    });
  });
});

describe("execution:devnet:funding-status — artifact output + faucet", () => {
  it("--out writes the funding-status artifact and refuses overwrite without --force", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const outDir = join("runs", "fund-1");
      const first = await executionDevnetFundingStatusReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRpc({ lamports: 1_000_000_000 }), now: () => "2026-06-13T00:00:00.000Z" },
        { publicKey: PUBKEY, outDir },
      );
      expect(first.exitCode, first.text).toBe(0);
      const path = join(tmp, outDir, "devnet-funding-status.json");
      expect(existsSync(path)).toBe(true);
      validateDevnetFundingStatus(JSON.parse(readFileSync(path, "utf8")));

      const again = await executionDevnetFundingStatusReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRpc({ lamports: 1_000_000_000 }) },
        { publicKey: PUBKEY, outDir },
      );
      expect(again.exitCode).toBe(1);
      expect(again.text).toContain("already exists");
    });
  });

  it("--attempt-airdrop on a 429 faucet classifies faucet-rate-limited and sends nothing", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetFundingStatusReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRpc({ lamports: 0, airdropError: "429 Too Many Requests" }), sleep: async () => {}, now: () => "2026-06-13T00:00:00.000Z" },
        { publicKey: PUBKEY, attemptAirdrop: true, airdropAttempts: "2", json: true },
      );
      expect(r.exitCode).toBe(0);
      const report = validateDevnetFundingStatus(JSON.parse(r.text));
      expect(report.fundingSourceStatus).toBe("faucet-rate-limited");
      expect(report.faucetAttemptSummary?.outcome).toBe("rate-limited");
      expect(report.faucetAttemptSummary?.attempts).toBe(2);
      expect(report.funded).toBe(false);
    });
  });
});

describe("execution:devnet:funding-status — complete-if-funded", () => {
  it("REFUSES --complete-if-funded with only a bare --public-key (cannot sign)", async () => {
    const r = await executionDevnetFundingStatusReport(
      { createRehearsalRpc: () => fakeRpc({ lamports: 1_000_000_000 }) },
      { publicKey: PUBKEY, outDir: join("runs", "x"), completeIfFunded: true },
    );
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("cannot sign");
  });

  it("a funded throwaway key completes the proof by chaining the devnet rehearsal (--skip-airdrop)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const outDir = join("runs", "complete-1");
      mkdirSync(join(tmp, outDir), { recursive: true });
      // Pre-place a throwaway keypair so the funding-status command resolves a signer-capable key.
      writeFileSync(join(tmp, outDir, "throwaway.devnet.keypair"), JSON.stringify(Array.from(Keypair.generate().secretKey)));

      const r = await executionDevnetFundingStatusReport(
        {
          cwd: tmp,
          env: FULL_ENV,
          createRehearsalRpc: () => fakeRpc({ lamports: 1_000_000_000 }),
          createTxPreview: () => fakePreview(),
          now: () => "2026-06-13T00:00:00.000Z",
          sleep: async () => {},
        },
        { outDir, completeIfFunded: true, acknowledgeDevnetExecution: true },
      );
      expect(r.exitCode, r.text.slice(0, 800)).toBe(0);
      expect(r.text).toContain("completing the devnet proof");
      expect(r.text).toContain("REHEARSAL: REHEARSED");
      // Both the funding-status artifact and the rehearsal report landed in the out dir.
      expect(existsSync(join(tmp, outDir, "devnet-funding-status.json"))).toBe(true);
      expect(existsSync(join(tmp, outDir, "devnet-rehearsal-report.json"))).toBe(true);
      const rehearsal = JSON.parse(readFileSync(join(tmp, outDir, "devnet-rehearsal-report.json"), "utf8")) as {
        outcome: string;
        signerSource: string;
        airdrop: { requested: boolean };
      };
      expect(rehearsal.outcome).toBe("rehearsed");
      expect(rehearsal.signerSource).toBe("reused-throwaway");
      expect(rehearsal.airdrop.requested).toBe(false); // --skip-airdrop: already funded, no faucet hit
    });
  });

  it("--complete-if-funded but unfunded writes the status and does NOT send", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const outDir = join("runs", "complete-unfunded");
      mkdirSync(join(tmp, outDir), { recursive: true });
      writeFileSync(join(tmp, outDir, "throwaway.devnet.keypair"), JSON.stringify(Array.from(Keypair.generate().secretKey)));
      const r = await executionDevnetFundingStatusReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRpc({ lamports: 0 }), now: () => "2026-06-13T00:00:00.000Z", sleep: async () => {} },
        { outDir, completeIfFunded: true, acknowledgeDevnetExecution: true },
      );
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("UNFUNDED");
      expect(existsSync(join(tmp, outDir, "devnet-funding-status.json"))).toBe(true);
      // No rehearsal happened — nothing was broadcast.
      expect(existsSync(join(tmp, outDir, "devnet-rehearsal-report.json"))).toBe(false);
    });
  });

  it("never serializes secret key bytes into the funding-status artifact", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const outDir = join("runs", "secrets");
      mkdirSync(join(tmp, outDir), { recursive: true });
      const kp = Keypair.generate();
      writeFileSync(join(tmp, outDir, "throwaway.devnet.keypair"), JSON.stringify(Array.from(kp.secretKey)));
      await executionDevnetFundingStatusReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRpc({ lamports: 0 }), now: () => "2026-06-13T00:00:00.000Z" },
        { outDir },
      );
      const json = readFileSync(join(tmp, outDir, "devnet-funding-status.json"), "utf8");
      const fingerprint = Array.from(kp.secretKey).slice(0, 6).join(",");
      expect(json).not.toContain(fingerprint);
      expect(json).not.toMatch(/\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/);
      expect(json).not.toMatch(/"secretKey"|"privateKey"/i);
    });
  });
});
