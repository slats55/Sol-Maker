import { describe, it, expect } from "vitest";
import { inspect } from "node:util";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  evaluateMainnetLiveGate,
  LIVE_TRADING_ENV_FLAG,
  LIVE_TRADING_ENV_VALUE,
  type MainnetLiveGateInput,
} from "./live-gate.js";
import { resolveExecutionMode, DEVNET_EXECUTION_ENV_FLAG, DEVNET_EXECUTION_ENV_VALUE } from "./modes.js";
import { evaluateSafetyControls, type OperatorSafetyControls, type SessionState, type TradeContext } from "./safety-controls.js";
import { loadLocalSignerBoundary, SIGNER_REDACTION_MARKER, SignerBoundaryError } from "./signer.js";
import { attemptExecution, type SendRpcLike } from "./send.js";

const SIGNER = Keypair.generate();
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 5)).toBase58();

// --- live gate --------------------------------------------------------------------------------

/** Every gate condition satisfied — the ONLY way to arm, used to prove near-misses all block. */
function fullyArmedInput(): MainnetLiveGateInput {
  return {
    env: { [LIVE_TRADING_ENV_FLAG]: LIVE_TRADING_ENV_VALUE },
    configPhase7LiveTradingReady: true,
    cliAcknowledged: true,
    network: "mainnet-beta",
    maxSpendLamports: "10000000",
    sessionLossCapSol: 0.5,
    slippageCapBps: 100,
    killSwitchActive: false,
    quoteFresh: true,
    simulationOutcome: "simulated-ok",
    riskScore: 10,
    riskScoreCap: 30,
    walletPublicKeyValid: true,
    signerBoundaryKind: "local-file",
    auditLogPathProvided: true,
    redactionFindings: 0,
  };
}

describe("mainnet live gate — default BLOCKED; fourteen conditions; no partial credit", () => {
  it("the DEFAULT state (no input at all) is blocked with every check failed", () => {
    const result = evaluateMainnetLiveGate();
    expect(result.armed).toBe(false);
    expect(result.checks).toHaveLength(14);
    expect(result.checks.every((c) => !c.satisfied)).toBe(true);
  });

  it("ALL fourteen conditions satisfied -> armed", () => {
    const result = evaluateMainnetLiveGate(fullyArmedInput());
    expect(result.checks.filter((c) => !c.satisfied)).toEqual([]);
    expect(result.armed).toBe(true);
  });

  it("EVERY single near-miss (one condition broken at a time) stays BLOCKED", () => {
    const breakers: Array<[string, Partial<MainnetLiveGateInput>]> = [
      ["env flag wrong value", { env: { [LIVE_TRADING_ENV_FLAG]: "yes" } }],
      ["env flag missing", { env: {} }],
      ["config not ready", { configPhase7LiveTradingReady: false }],
      ["cli not acknowledged", { cliAcknowledged: false }],
      ["network devnet", { network: "devnet" }],
      ["spend cap missing", { maxSpendLamports: null }],
      ["spend cap zero", { maxSpendLamports: "0" }],
      ["loss cap missing", { sessionLossCapSol: null }],
      ["slippage cap missing", { slippageCapBps: null }],
      ["kill switch active", { killSwitchActive: true }],
      ["kill switch UNKNOWN", { killSwitchActive: undefined }],
      ["quote not fresh", { quoteFresh: false }],
      ["quote unchecked", { quoteFresh: null }],
      ["simulation failed", { simulationOutcome: "simulated-failed" }],
      ["simulation missing", { simulationOutcome: null }],
      ["risk over cap", { riskScore: 50 }],
      ["risk missing", { riskScore: null }],
      ["wallet not validated", { walletPublicKeyValid: false }],
      ["no signer boundary", { signerBoundaryKind: null }],
      ["no audit path", { auditLogPathProvided: false }],
      ["redaction findings present", { redactionFindings: 1 }],
    ];
    for (const [label, breaker] of breakers) {
      const result = evaluateMainnetLiveGate({ ...fullyArmedInput(), ...breaker });
      expect(result.armed, `near-miss "${label}" must stay blocked`).toBe(false);
    }
  });
});

// --- mode resolution --------------------------------------------------------------------------

describe("resolveExecutionMode — fail-closed", () => {
  it("default and unknown requests resolve to paper", () => {
    expect(resolveExecutionMode().mode).toBe("paper");
    expect(resolveExecutionMode({ requested: "yolo" }).mode).toBe("paper");
    expect(resolveExecutionMode({ requested: "mainnet-live-armed" }).mode).toBe("paper"); // can't request the RESOLVED name
  });

  it("devnet requires BOTH the env flag and the CLI acknowledgment", () => {
    expect(resolveExecutionMode({ requested: "devnet" }).mode).toBe("paper");
    expect(resolveExecutionMode({ requested: "devnet", env: { [DEVNET_EXECUTION_ENV_FLAG]: DEVNET_EXECUTION_ENV_VALUE } }).mode).toBe("paper");
    expect(resolveExecutionMode({ requested: "devnet", devnetCliAcknowledged: true }).mode).toBe("paper");
    const enabled = resolveExecutionMode({
      requested: "devnet",
      env: { [DEVNET_EXECUTION_ENV_FLAG]: DEVNET_EXECUTION_ENV_VALUE },
      devnetCliAcknowledged: true,
    });
    expect(enabled.mode).toBe("devnet-execution");
  });

  it("mainnet-live resolves to BLOCKED with the checklist unless every gate passes", () => {
    const blocked = resolveExecutionMode({ requested: "mainnet-live" });
    expect(blocked.mode).toBe("mainnet-live-blocked");
    expect(blocked.liveGate?.checks).toHaveLength(14);
    expect(blocked.reasons.length).toBeGreaterThan(1);

    const armedInput = fullyArmedInput();
    const armed = resolveExecutionMode({ requested: "mainnet-live", env: armedInput.env, liveGateInput: armedInput });
    expect(armed.mode).toBe("mainnet-live-armed");
  });
});

// --- safety controls --------------------------------------------------------------------------

function cleanControls(overrides: Partial<OperatorSafetyControls> = {}): OperatorSafetyControls {
  return {
    killSwitchActive: false,
    emergencyStopFilePresent: false,
    maxSpendPerTradeLamports: "100000000",
    maxTradesPerSession: 5,
    sessionLossCapSol: 0.5,
    slippageCapBps: 100,
    riskScoreCap: 30,
    quoteAgeCapMs: 30_000,
    allowedMints: null,
    blockedMints: [],
    allowedProviders: null,
    networkLock: "devnet",
    auditLogRequired: true,
    cooldownMs: 1_000,
    duplicateMintProtection: true,
    ...overrides,
  };
}

function cleanTrade(overrides: Partial<TradeContext> = {}): TradeContext {
  return {
    mint: USDC,
    provider: "jupiter-swap-api",
    network: "devnet",
    spendLamports: "10000000",
    slippageBps: 50,
    riskScore: 10,
    quoteAgeMs: 500,
    auditLogPathProvided: true,
    ...overrides,
  };
}

function cleanSession(overrides: Partial<SessionState> = {}): SessionState {
  return { tradesCount: 0, sessionLossSol: 0, lastTradeAtMs: null, mintsTraded: [], ...overrides };
}

describe("operator safety controls — every violation code, enforced in code", () => {
  it("a fully clean trade passes", () => {
    expect(evaluateSafetyControls(cleanControls(), cleanTrade(), cleanSession(), 100_000).allowed).toBe(true);
  });

  const cases: Array<[string, Partial<OperatorSafetyControls>, Partial<TradeContext>, Partial<SessionState>, string]> = [
    ["kill switch", { killSwitchActive: true }, {}, {}, "safety-kill-switch-active"],
    ["emergency stop", { emergencyStopFilePresent: true }, {}, {}, "safety-emergency-stop-present"],
    ["spend cap missing", { maxSpendPerTradeLamports: null }, {}, {}, "safety-spend-cap-missing"],
    ["spend over cap", {}, { spendLamports: "999999999999" }, {}, "safety-spend-over-cap"],
    ["spend missing", {}, { spendLamports: null }, {}, "safety-spend-missing"],
    ["max trades missing", { maxTradesPerSession: null }, {}, {}, "safety-max-trades-missing"],
    ["max trades reached", {}, {}, { tradesCount: 5 }, "safety-max-trades-reached"],
    ["loss cap missing", { sessionLossCapSol: null }, {}, {}, "safety-session-loss-cap-missing"],
    ["loss cap breached", {}, {}, { sessionLossSol: 0.6 }, "safety-session-loss-cap-breached"],
    ["slippage cap missing", { slippageCapBps: null }, {}, {}, "safety-slippage-cap-missing"],
    ["slippage missing", {}, { slippageBps: null }, {}, "safety-slippage-missing"],
    ["slippage over cap", {}, { slippageBps: 500 }, {}, "safety-slippage-over-cap"],
    ["risk cap missing", { riskScoreCap: null }, {}, {}, "safety-risk-cap-missing"],
    ["risk missing", {}, { riskScore: null }, {}, "safety-risk-missing"],
    ["risk over cap", {}, { riskScore: 80 }, {}, "safety-risk-over-cap"],
    ["quote age cap missing", { quoteAgeCapMs: null }, {}, {}, "safety-quote-age-cap-missing"],
    ["quote age missing", {}, { quoteAgeMs: null }, {}, "safety-quote-age-missing"],
    ["quote stale", {}, { quoteAgeMs: 60_000 }, {}, "safety-quote-stale"],
    ["mint blocked", { blockedMints: [USDC] }, {}, {}, "safety-mint-blocked"],
    ["mint not allowlisted", { allowedMints: ["SomeOtherMint11111111111111111111111111111"] }, {}, {}, "safety-mint-not-allowlisted"],
    ["provider not allowed", { allowedProviders: ["other-provider"] }, {}, {}, "safety-provider-not-allowed"],
    ["network lock missing", { networkLock: null }, {}, {}, "safety-network-lock-missing"],
    ["network locked", {}, { network: "mainnet-beta" }, {}, "safety-network-locked"],
    ["audit log missing", {}, { auditLogPathProvided: false }, {}, "safety-audit-log-missing"],
    ["cooldown active", {}, {}, { lastTradeAtMs: 99_500 }, "safety-cooldown-active"],
    ["duplicate mint", {}, {}, { mintsTraded: [USDC] }, "safety-duplicate-mint"],
  ];
  for (const [label, c, t, s, expected] of cases) {
    it(`${label} -> ${expected}`, () => {
      const result = evaluateSafetyControls(cleanControls(c), cleanTrade(t), cleanSession(s), 100_000);
      expect(result.allowed).toBe(false);
      expect(result.violations.map((v) => v.code)).toContain(expected);
    });
  }
});

// --- signer boundary --------------------------------------------------------------------------

function signerEnv(): { env: Record<string, string>; readFile: (p: string) => string } {
  return {
    env: { TEST_SIGNER_FILE: "/fake/path/keypair.json" },
    readFile: (path: string) => {
      expect(path).toBe("/fake/path/keypair.json");
      return JSON.stringify(Array.from(SIGNER.secretKey));
    },
  };
}

describe("signer boundary — devnet-first; mainnet only behind the ARMED gate; secrets never leak", () => {
  it("loads a devnet signer from an env-named file and signs", () => {
    const { env, readFile } = signerEnv();
    const boundary = loadLocalSignerBoundary({ envVarName: "TEST_SIGNER_FILE", env, readFile, network: "devnet" });
    expect(boundary.kind).toBe("local-file");
    expect(boundary.publicKeyBase58).toBe(SIGNER.publicKey.toBase58());
  });

  it("REFUSES a mainnet signer without the armed gate (and with a forged partial gate)", () => {
    const { env, readFile } = signerEnv();
    expect(() => loadLocalSignerBoundary({ envVarName: "TEST_SIGNER_FILE", env, readFile, network: "mainnet-beta" })).toThrowError(SignerBoundaryError);
    expect(() =>
      loadLocalSignerBoundary({
        envVarName: "TEST_SIGNER_FILE",
        env,
        readFile,
        network: "mainnet-beta",
        mainnetLiveGate: { armed: true, checks: [] }, // forged: armed but no checks
      }),
    ).toThrowError(/fourteen/);
    const armed = evaluateMainnetLiveGate(fullyArmedInput());
    const boundary = loadLocalSignerBoundary({ envVarName: "TEST_SIGNER_FILE", env, readFile, network: "mainnet-beta", mainnetLiveGate: armed });
    expect(boundary.network).toBe("mainnet-beta");
  });

  it("refuses missing env var, unreadable file, and malformed key files — without echoing anything", () => {
    const { readFile } = signerEnv();
    expect(() => loadLocalSignerBoundary({ envVarName: "TEST_SIGNER_FILE", env: {}, readFile, network: "devnet" })).toThrowError(/is not set/);
    expect(() =>
      loadLocalSignerBoundary({
        envVarName: "TEST_SIGNER_FILE",
        env: { TEST_SIGNER_FILE: "/fake/path/keypair.json" },
        readFile: () => {
          throw new Error("ENOENT /fake/path/keypair.json");
        },
        network: "devnet",
      }),
    ).toThrowError(/could not be read/);
    try {
      loadLocalSignerBoundary({
        envVarName: "TEST_SIGNER_FILE",
        env: { TEST_SIGNER_FILE: "/fake/path/keypair.json" },
        readFile: () => JSON.stringify([1, 2, 3]),
        network: "devnet",
      });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("64-byte");
      expect((err as Error).message).not.toContain("/fake/path");
    }
  });

  it("never serializes or inspects into key material", () => {
    const { env, readFile } = signerEnv();
    const boundary = loadLocalSignerBoundary({ envVarName: "TEST_SIGNER_FILE", env, readFile, network: "devnet" });
    expect(JSON.stringify(boundary)).toBe(`"${SIGNER_REDACTION_MARKER}"`);
    const secretBase58 = Buffer.from(SIGNER.secretKey).toString("base64");
    expect(inspect(boundary)).not.toContain(secretBase58);
    expect(inspect(boundary)).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{80,}/);
  });
});

// --- the send path ----------------------------------------------------------------------------

function unsignedEnvelope(network: "devnet" | "mainnet-beta"): Record<string, unknown> {
  const message = new TransactionMessage({
    payerKey: SIGNER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: SIGNER.publicKey, toPubkey: SIGNER.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return {
    schemaVersion: "txpreview.envelope.v1",
    network,
    feePayerPublicKey: SIGNER.publicKey.toBase58(),
    txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    builderId: "test-builder",
    candidateMint: null,
    routeCaveats: [],
    constraints: { maxSpendLamports: "1", slippageBps: null },
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
  };
}

function fakeRpc(): { rpc: SendRpcLike; sent: Uint8Array[] } {
  const sent: Uint8Array[] = [];
  return {
    sent,
    rpc: {
      getLatestBlockhash: async () => ({ blockhash: new PublicKey(Buffer.alloc(32, 8)).toBase58() }),
      sendRawTransaction: async (bytes) => {
        sent.push(bytes);
        return "5".repeat(20); // a fake (short) signature label
      },
    },
  };
}

function devnetBoundary() {
  const { env, readFile } = signerEnv();
  return loadLocalSignerBoundary({ envVarName: "TEST_SIGNER_FILE", env, readFile, network: "devnet" });
}

function attemptBase(overrides: Partial<Parameters<typeof attemptExecution>[0]> = {}) {
  const { rpc } = fakeRpc();
  return {
    mode: "devnet-execution" as const,
    signer: devnetBoundary(),
    envelopeValue: unsignedEnvelope("devnet"),
    rpc,
    endpointHost: "rpc.example.com",
    controls: cleanControls(),
    trade: cleanTrade(),
    session: cleanSession(),
    nowMs: 100_000,
    clock: () => "2026-06-12T06:00:00.000Z",
    ...overrides,
  };
}

describe("attemptExecution — refusal-first; sending is structurally unreachable outside the two armed modes", () => {
  it("REFUSES in paper, readonly, mainnet-dry-run, and mainnet-live-blocked modes", async () => {
    for (const mode of ["paper", "readonly", "mainnet-dry-run", "mainnet-live-blocked"] as const) {
      const report = await attemptExecution(attemptBase({ mode }));
      expect(report.outcome).toBe("refused");
      expect(report.refusalCode).toBe("execution-refused-mode");
      expect(report.signature).toBeNull();
    }
  });

  it("mainnet-live-armed REFUSES without the full fourteen-check gate (incl. forged/partial gates)", async () => {
    for (const gate of [undefined, null, { armed: true, checks: [] }, evaluateMainnetLiveGate()] as const) {
      const report = await attemptExecution(
        attemptBase({ mode: "mainnet-live-armed", mainnetLiveGate: gate as never, envelopeValue: unsignedEnvelope("mainnet-beta") }),
      );
      expect(report.outcome).toBe("refused");
      expect(report.refusalCode).toBe("execution-refused-live-gate-not-armed");
    }
  });

  it("a safety-control violation refuses BEFORE the envelope is even opened", async () => {
    const report = await attemptExecution(attemptBase({ controls: cleanControls({ killSwitchActive: true }) }));
    expect(report.outcome).toBe("refused");
    expect(report.refusalCode).toBe("execution-refused-safety-controls");
    expect(report.safetyViolations.map((v) => v.code)).toContain("safety-kill-switch-active");
  });

  it("network mismatches refuse: wrong envelope network, wrong signer network", async () => {
    const wrongEnvelope = await attemptExecution(attemptBase({ envelopeValue: unsignedEnvelope("mainnet-beta") }));
    expect(wrongEnvelope.refusalCode).toBe("execution-refused-network-mismatch");

    const armed = evaluateMainnetLiveGate(fullyArmedInput());
    const { env, readFile } = signerEnv();
    const mainnetBoundary = loadLocalSignerBoundary({ envVarName: "TEST_SIGNER_FILE", env, readFile, network: "mainnet-beta", mainnetLiveGate: armed });
    const wrongSigner = await attemptExecution(attemptBase({ signer: mainnetBoundary }));
    expect(wrongSigner.refusalCode).toBe("execution-refused-network-mismatch");
  });

  it("devnet happy path: blockhash refreshed, signed through the boundary, submitted ONCE", async () => {
    const { rpc, sent } = fakeRpc();
    const report = await attemptExecution(attemptBase({ rpc, controls: cleanControls({ networkLock: "devnet" }) }));
    expect(report.outcome, report.refusalDetail ?? "").toBe("submitted");
    expect(report.signature).not.toBeNull();
    expect(report.signerPublicKey).toBe(SIGNER.publicKey.toBase58());
    expect(report.caveats.join("\n")).toContain("NOT confirmation");
    expect(report.phase7LiveTradingReady).toBe(false);
    expect(sent).toHaveLength(1);
    // The submitted bytes ARE signed (non-zero signature) — signing happened inside the boundary.
    const submitted = VersionedTransaction.deserialize(sent[0] as Uint8Array);
    expect(submitted.signatures[0]?.some((b) => b !== 0)).toBe(true);
  });

  it("an RPC failure is an honest refusal, never a throw", async () => {
    const failing: SendRpcLike = {
      getLatestBlockhash: async () => {
        throw new Error("ECONNREFUSED");
      },
      sendRawTransaction: async () => "never",
    };
    const report = await attemptExecution(attemptBase({ rpc: failing }));
    expect(report.outcome).toBe("refused");
    expect(report.refusalCode).toBe("execution-refused-rpc-unavailable");
  });
});
