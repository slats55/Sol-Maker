import { describe, it, expect } from "vitest";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import {
  runDevnetRehearsal,
  createRehearsalRpc,
  DEVNET_REHEARSAL_REPORT_SCHEMA_VERSION,
  DEVNET_REHEARSAL_MIN_BALANCE_LAMPORTS,
} from "./rehearsal.js";
import type { RehearsalRpc, RunDevnetRehearsalInput } from "./rehearsal.js";
import { createThrowawayDevnetSigner, loadThrowawayDevnetSigner, SignerBoundaryError } from "./signer.js";
import type { SendRpcLike } from "./send.js";

const CLOCK = (): string => "2026-06-12T00:00:00.000Z";
const NOW_MS = (): number => 1_780_000_000_000;
const NO_SLEEP = async (): Promise<void> => {};

interface FakeRpcOptions {
  balances?: number[];
  airdropError?: string;
  /** When set, requestAirdrop throws this many times before succeeding (retry coverage). */
  airdropFailuresBeforeSuccess?: number;
  sendError?: string;
  confirmAfterPolls?: number;
  confirmErrLabel?: string | null;
  slot?: number;
}

function fakeRpc(options: FakeRpcOptions = {}): { rpc: RehearsalRpc; sends: Uint8Array[]; airdropCalls: () => number } {
  const balances = [...(options.balances ?? [0, 1_000_000_000])];
  const sends: Uint8Array[] = [];
  let statusPolls = 0;
  let airdropCalls = 0;
  const confirmAfter = options.confirmAfterPolls ?? 1;
  const send: SendRpcLike = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
    sendRawTransaction: async (bytes) => {
      if (options.sendError) throw new Error(options.sendError);
      sends.push(bytes);
      return "FAKE_PROBE_SIGNATURE_1111111111111111111111111";
    },
  };
  return {
    sends,
    airdropCalls: () => airdropCalls,
    rpc: Object.freeze({
      endpointHost: "fake.devnet.test",
      faucet: {
        getBalanceLamports: async () => (balances.length > 1 ? (balances.shift() as number) : (balances[0] as number)),
        requestAirdrop: async () => {
          airdropCalls += 1;
          if (options.airdropFailuresBeforeSuccess !== undefined && airdropCalls <= options.airdropFailuresBeforeSuccess) {
            throw new Error("429 Too Many Requests (transient)");
          }
          if (options.airdropError && options.airdropFailuresBeforeSuccess === undefined) throw new Error(options.airdropError);
          return "FAKE_AIRDROP_SIGNATURE_111111111111111111111";
        },
        getSignatureStatus: async () => {
          statusPolls += 1;
          if (statusPolls >= confirmAfter) {
            return { confirmed: true, slot: options.slot ?? 123456, errLabel: options.confirmErrLabel ?? null };
          }
          return { confirmed: false, slot: null, errLabel: null };
        },
      },
      send,
    }),
  };
}

function makeThrowaway(): { input: Pick<RunDevnetRehearsalInput, "signer" | "signerSource" | "throwawayFilePath">; written: Map<string, string> } {
  const written = new Map<string, string>();
  const throwaway = createThrowawayDevnetSigner({
    keypairPath: "runs/devnet-rehearsal/throwaway.devnet.keypair",
    writeFile: (path, contents) => written.set(path, contents),
  });
  return {
    written,
    input: { signer: throwaway.boundary, signerSource: "generated-throwaway", throwawayFilePath: throwaway.keypairPath },
  };
}

function baseInput(rpc: RehearsalRpc): RunDevnetRehearsalInput {
  const { input } = makeThrowaway();
  return {
    mode: "devnet-execution",
    rpc,
    killSwitchActive: false,
    emergencyStopFilePresent: false,
    sleep: NO_SLEEP,
    clock: CLOCK,
    nowMs: NOW_MS,
    pollDelayMs: 0,
    ...input,
  };
}

describe("createThrowawayDevnetSigner — key material stays inside the boundary", () => {
  it("writes a 64-byte solana-keygen array to the .keypair path and returns ONLY a devnet boundary", () => {
    const written = new Map<string, string>();
    const result = createThrowawayDevnetSigner({
      keypairPath: "runs/x/throwaway.devnet.keypair",
      writeFile: (path, contents) => written.set(path, contents),
    });
    expect(result.keypairPath).toBe("runs/x/throwaway.devnet.keypair");
    expect(result.boundary.network).toBe("devnet");
    expect(result.boundary.kind).toBe("local-file");
    const bytes = JSON.parse(written.get("runs/x/throwaway.devnet.keypair") as string) as number[];
    expect(Array.isArray(bytes)).toBe(true);
    expect(bytes).toHaveLength(64);
    expect(bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)).toBe(true);
    // The boundary never serializes the secret.
    expect(JSON.stringify(result.boundary)).toBe('"[signer-boundary: redacted]"');
    // The result object itself never carries the bytes.
    expect(JSON.stringify(result)).not.toContain(bytes.slice(0, 4).join(","));
  });

  it('REFUSES a keypair path that does not end with ".keypair" (the gitignored suffix)', () => {
    expect(() =>
      createThrowawayDevnetSigner({ keypairPath: "runs/x/throwaway.json", writeFile: () => {} }),
    ).toThrow(SignerBoundaryError);
  });

  it("discards the key when the file write fails", () => {
    expect(() =>
      createThrowawayDevnetSigner({
        keypairPath: "runs/x/t.keypair",
        writeFile: () => {
          throw new Error("disk full");
        },
      }),
    ).toThrow(/could not be written/);
  });
});

describe("runDevnetRehearsal — the full chain over injected seams", () => {
  it("happy path: airdrop -> probe -> simulate -> send -> confirm => rehearsed, with every step recorded", async () => {
    const { rpc, sends } = fakeRpc({ balances: [0, 1_000_000_000], slot: 424242 });
    const report = await runDevnetRehearsal({
      ...baseInput(rpc),
      simulate: async () => ({ outcome: "simulated-ok", errLabel: null }),
    });

    expect(report.schemaVersion).toBe(DEVNET_REHEARSAL_REPORT_SCHEMA_VERSION);
    expect(report.outcome).toBe("rehearsed");
    expect(report.network).toBe("devnet");
    expect(report.airdrop.status).toBe("confirmed");
    expect(report.signature).toBe("FAKE_PROBE_SIGNATURE_1111111111111111111111111");
    expect(report.confirmation?.confirmed).toBe(true);
    expect(report.confirmation?.slot).toBe(424242);
    expect(report.attempt?.outcome).toBe("submitted");
    expect(report.steps.map((s) => `${s.step}:${s.status}`)).toEqual([
      "mode:ok",
      "signer:ok",
      "funding:ok",
      "build-probe:ok",
      "simulate:ok",
      "send:ok",
      "confirm:ok",
    ]);
    // The submitted bytes are a SIGNED transaction (signed inside the boundary, once).
    expect(sends).toHaveLength(1);
    const tx = VersionedTransaction.deserialize(sends[0] as Uint8Array);
    expect(tx.signatures.some((sig) => sig.some((b) => b !== 0))).toBe(true);
    // The serialized report never carries key material or a 64-byte array.
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/"secretKey"/i);
    expect(json).not.toMatch(/\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/);
    expect(report.neverMainnet).toBe(true);
    expect(report.phase7LiveTradingReady).toBe(false);
  });

  it("airdrop unavailable + empty balance => devnet-funding-blocked, steps preserved, nothing sent", async () => {
    const { rpc, sends } = fakeRpc({ balances: [0], airdropError: "429 Too Many Requests" });
    const report = await runDevnetRehearsal(baseInput(rpc));
    expect(report.outcome).toBe("devnet-funding-blocked");
    expect(report.airdrop.status).toBe("unavailable");
    expect(report.steps.at(-1)?.step).toBe("funding");
    expect(report.steps.at(-1)?.status).toBe("unavailable");
    expect(report.steps.at(-1)?.detail).toContain("airdrop unavailable");
    expect(report.signature).toBeNull();
    expect(sends).toHaveLength(0);
  });

  it("airdrop unavailable but the account is ALREADY funded => proceeds and rehearses", async () => {
    const { rpc } = fakeRpc({ balances: [DEVNET_REHEARSAL_MIN_BALANCE_LAMPORTS], airdropError: "ignored" });
    const report = await runDevnetRehearsal({ ...baseInput(rpc), skipAirdrop: true });
    expect(report.outcome).toBe("rehearsed");
    expect(report.airdrop.requested).toBe(false);
    expect(report.airdrop.status).toBe("skipped");
  });

  it("a kill-switched session refuses at the send wall => blocked, with the attempt report embedded", async () => {
    const { rpc, sends } = fakeRpc();
    const report = await runDevnetRehearsal({ ...baseInput(rpc), killSwitchActive: true });
    expect(report.outcome).toBe("blocked");
    expect(report.attempt?.outcome).toBe("refused");
    expect(report.attempt?.refusalCode).toBe("execution-refused-safety-controls");
    expect(report.steps.at(-1)).toMatchObject({ step: "send", status: "failed" });
    expect(sends).toHaveLength(0);
  });

  it("a probe that fails simulation is NEVER sent => blocked", async () => {
    const { rpc, sends } = fakeRpc();
    const report = await runDevnetRehearsal({
      ...baseInput(rpc),
      simulate: async () => ({ outcome: "simulated-failed", errLabel: "InstructionError" }),
    });
    expect(report.outcome).toBe("blocked");
    expect(report.steps.at(-1)).toMatchObject({ step: "simulate", status: "failed" });
    expect(sends).toHaveLength(0);
  });

  it("confirmation timeout => submitted-unconfirmed with the signature preserved (never upgraded)", async () => {
    const { rpc } = fakeRpc({ balances: [1_000_000_000], confirmAfterPolls: 99 });
    const report = await runDevnetRehearsal({ ...baseInput(rpc), confirmPolls: 3 });
    expect(report.outcome).toBe("submitted-unconfirmed");
    expect(report.signature).toBe("FAKE_PROBE_SIGNATURE_1111111111111111111111111");
    expect(report.confirmation?.confirmed).toBe(false);
    expect(report.confirmation?.polls).toBe(3);
    expect(report.steps.at(-1)).toMatchObject({ step: "confirm", status: "unavailable" });
  });

  it("any non-devnet-execution mode refuses structurally before touching the cluster", async () => {
    for (const mode of ["paper", "readonly", "mainnet-dry-run", "mainnet-live-blocked", "mainnet-live-armed"] as const) {
      const { rpc, sends } = fakeRpc();
      const report = await runDevnetRehearsal({ ...baseInput(rpc), mode });
      expect(report.outcome).toBe("blocked");
      expect(report.steps).toEqual([{ step: "mode", status: "failed", detail: expect.stringContaining("only devnet-execution") }]);
      expect(sends).toHaveLength(0);
    }
  });

  it("a transaction that lands WITH an error is submitted-unconfirmed, never rehearsed", async () => {
    const { rpc } = fakeRpc({ balances: [1_000_000_000], confirmAfterPolls: 1, confirmErrLabel: '{"InstructionError":[0,"Custom"]}' });
    const report = await runDevnetRehearsal(baseInput(rpc));
    expect(report.outcome).toBe("submitted-unconfirmed");
    expect(report.steps.at(-1)).toMatchObject({ step: "confirm", status: "failed" });
  });

  it("S94: a transient faucet failure is RETRIED within the bound and the run still rehearses", async () => {
    const { rpc, airdropCalls } = fakeRpc({ balances: [0, 1_000_000_000], airdropFailuresBeforeSuccess: 2 });
    const report = await runDevnetRehearsal({ ...baseInput(rpc), airdropAttempts: 3 });
    expect(report.outcome).toBe("rehearsed");
    expect(airdropCalls()).toBe(3);
    expect(report.airdrop.attempts).toBe(3);
    expect(report.airdrop.maxAttempts).toBe(3);
    expect(report.airdrop.status).toBe("confirmed");
    expect(report.fundingGuidance).toBeNull();
  });

  it("S94: faucet retries are HARD-BOUNDED (never spammed) and exhaustion records attempts + funding guidance", async () => {
    const { rpc, airdropCalls } = fakeRpc({ balances: [0], airdropError: "429 Too Many Requests" });
    const report = await runDevnetRehearsal({ ...baseInput(rpc), airdropAttempts: 99 });
    expect(report.outcome).toBe("devnet-funding-blocked");
    // The 99 request is clamped to the hard cap of 5.
    expect(airdropCalls()).toBe(5);
    expect(report.airdrop.attempts).toBe(5);
    expect(report.steps.at(-1)?.detail).toContain("after 5 bounded attempt(s)");
    // Guidance names the public key, the devnet faucet, and the reuse-on-rerun semantics — never mainnet funding.
    expect(report.fundingGuidance).not.toBeNull();
    const guidance = (report.fundingGuidance as string[]).join("\n");
    expect(guidance).toContain(report.signerPublicKey as string);
    expect(guidance).toContain("faucet.solana.com");
    expect(guidance).toContain("REUSED");
    expect(guidance).not.toMatch(/fund.*mainnet sol/i);
  });

  it("S94: a reused-throwaway signer source is recorded verbatim in the report and signer step", async () => {
    const { rpc } = fakeRpc({ balances: [1_000_000_000] });
    const report = await runDevnetRehearsal({ ...baseInput(rpc), signerSource: "reused-throwaway", skipAirdrop: true });
    expect(report.outcome).toBe("rehearsed");
    expect(report.signerSource).toBe("reused-throwaway");
    expect(report.steps.find((s) => s.step === "signer")?.detail).toContain("EXISTING throwaway devnet keypair reused");
  });
});

describe("loadThrowawayDevnetSigner — reuse stays inside the boundary (S94)", () => {
  it("round-trips a generated throwaway file into a devnet-only boundary with the SAME public key", () => {
    const written = new Map<string, string>();
    const generated = createThrowawayDevnetSigner({
      keypairPath: "runs/x/throwaway.devnet.keypair",
      writeFile: (path, contents) => written.set(path, contents),
    });
    const reused = loadThrowawayDevnetSigner({
      keypairPath: "runs/x/throwaway.devnet.keypair",
      readFile: (path) => written.get(path) as string,
    });
    expect(reused.boundary.network).toBe("devnet");
    expect(reused.boundary.publicKeyBase58).toBe(generated.boundary.publicKeyBase58);
    // The reused boundary never serializes the secret either.
    expect(JSON.stringify(reused.boundary)).toBe('"[signer-boundary: redacted]"');
  });

  it('REFUSES a path without the ".keypair" suffix and malformed file contents', () => {
    expect(() => loadThrowawayDevnetSigner({ keypairPath: "runs/x/key.json", readFile: () => "[]" })).toThrow(SignerBoundaryError);
    expect(() => loadThrowawayDevnetSigner({ keypairPath: "runs/x/t.keypair", readFile: () => "not json" })).toThrow(/not valid JSON/);
    expect(() => loadThrowawayDevnetSigner({ keypairPath: "runs/x/t.keypair", readFile: () => "[1,2,3]" })).toThrow(/64-byte/);
    expect(() =>
      loadThrowawayDevnetSigner({
        keypairPath: "runs/x/t.keypair",
        readFile: () => {
          throw new Error("missing");
        },
      }),
    ).toThrow(/could not be read/);
  });
});

describe("createRehearsalRpc — devnet only", () => {
  it("REFUSES a mainnet-looking endpoint outright", () => {
    expect(() => createRehearsalRpc("https://api.mainnet-beta.solana.com")).toThrow(/devnet only/);
  });

  it("builds the narrow seams for a devnet URL without touching the network", () => {
    const rpc = createRehearsalRpc("https://api.devnet.solana.com");
    expect(rpc.endpointHost).toBe("api.devnet.solana.com");
    expect(Object.keys(rpc.faucet).sort()).toEqual(["getBalanceLamports", "getSignatureStatus", "requestAirdrop"]);
    expect(Object.keys(rpc.send).sort()).toEqual(["getLatestBlockhash", "sendRawTransaction"]);
  });
});
