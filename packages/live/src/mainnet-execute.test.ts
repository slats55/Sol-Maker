import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { LIVE_TRADING_ENV_FLAG, LIVE_TRADING_ENV_VALUE } from "@soulmaker/execution";
import { buildLedger, openPosition } from "./position.js";
import { executeMainnetBuy, executeMainnetSell, type MainnetBuyInput, type MainnetCaps, type MainnetSellInput } from "./mainnet-execute.js";

const SIGNER = Keypair.generate();
const OTHER = Keypair.generate();
const MINT = new PublicKey(Buffer.alloc(32, 7)).toBase58();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 3)).toBase58();
const SIG = "4".repeat(88);
const T0 = Date.parse("2026-09-03T12:00:00.000Z");

function envelope(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const message = new TransactionMessage({
    payerKey: SIGNER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: SIGNER.publicKey, toPubkey: SIGNER.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return {
    schemaVersion: "txpreview.envelope.v1",
    network: "mainnet-beta",
    feePayerPublicKey: SIGNER.publicKey.toBase58(),
    txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    builderId: "jupiter-swap-api",
    candidateMint: MINT,
    routeCaveats: [],
    constraints: { maxSpendLamports: "5000000", slippageBps: 100 },
    quotedAt: new Date(T0 - 2_000).toISOString(),
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
    ...over,
  };
}

function simulation(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    outcome: "simulated-ok",
    feePayerPublicKey: SIGNER.publicKey.toBase58(),
    candidateMint: MINT,
    builderId: "jupiter-swap-api",
    simulatedAt: new Date(T0 - 5_000).toISOString(),
    ...over,
  };
}

const CAPS: MainnetCaps = {
  maxSpendLamports: "10000000",
  sessionLossCapSol: 0.05,
  slippageCapBps: 300,
  riskScoreCap: 50,
  quoteAgeCapMs: 8_000,
  maxTradesPerSession: 5,
  maxOpenPositions: 2,
  minSolReserveLamports: 10_000_000,
};

interface World {
  sent: Uint8Array[];
  statuses: Array<{ slot: number; err: unknown; confirmationStatus?: string } | null>;
  sol: number[];
  token: string[];
  sendError?: Error;
}

function rpc(w: World) {
  let si = 0, ti = 0, ci = 0;
  return {
    endpointHost: "rpc.test",
    send: {
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH }),
      sendRawTransaction: async (bytes: Uint8Array) => {
        if (w.sendError) throw w.sendError;
        w.sent.push(bytes);
        return SIG;
      },
    },
    confirm: {
      getSignatureStatuses: async () => ({ value: [w.statuses[Math.min(ci++, w.statuses.length - 1)] ?? null] }),
    },
    balance: {
      getBalanceLamports: async () => w.sol[Math.min(si++, w.sol.length - 1)] as number,
      getTokenBalanceRaw: async () => w.token[Math.min(ti++, w.token.length - 1)] as string,
    },
  };
}

function common(w: World, over: Partial<MainnetBuyInput> = {}): MainnetBuyInput {
  let t = T0;
  return {
    envelopeValue: envelope(),
    simulationValue: simulation(),
    riskScore: 10,
    env: { [LIVE_TRADING_ENV_FLAG]: LIVE_TRADING_ENV_VALUE, HOT_WALLET_FILE: "/fake/hot.keypair" },
    configPhase7LiveTradingReady: true,
    configKillSwitch: false,
    emergencyStopFilePresent: false,
    cliAcknowledged: true,
    caps: CAPS,
    ledger: buildLedger([]),
    session: { tradesCount: 0, sessionLossSol: 0, lastTradeAtMs: null, mintsTraded: [] },
    signerEnvVar: "HOT_WALLET_FILE",
    readFile: () => JSON.stringify(Array.from(SIGNER.secretKey)),
    rpc: rpc(w),
    auditLogPathProvided: true,
    nowMs: () => t,
    clock: () => new Date(t).toISOString(),
    sleep: async (ms: number) => { t += ms; },
    confirmTimeoutMs: 3_000,
    confirmPollMs: 500,
    ...over,
  };
}

const CONFIRMED = { slot: 100, err: null, confirmationStatus: "confirmed" };

describe("executeMainnetBuy (S111) — refusal walls send NOTHING", () => {
  it("refuses when the live gate is not armed (missing env sentence) and sends nothing", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["0"] };
    const r = await executeMainnetBuy(common(w, { env: { HOT_WALLET_FILE: "/fake" } }));
    expect(r.outcome).toBe("refused");
    expect(r.refusalDetail).toContain("env-acknowledgment");
    expect(r.liveGate?.armed).toBe(false);
    expect(w.sent).toHaveLength(0);
    expect(r.position).toBeNull();
  });

  it("refuses a stale quote", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["0"] };
    const r = await executeMainnetBuy(common(w, { envelopeValue: envelope({ quotedAt: new Date(T0 - 30_000).toISOString() }) }));
    expect(r.outcome).toBe("refused");
    expect(r.refusalDetail).toContain("quote-fresh");
    expect(w.sent).toHaveLength(0);
  });

  it("refuses a simulation that is not simulated-ok, or for another envelope, or too old", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["0"] };
    expect((await executeMainnetBuy(common(w, { simulationValue: simulation({ outcome: "simulated-failed" }) }))).refusalDetail).toContain("not simulated-ok");
    expect((await executeMainnetBuy(common(w, { simulationValue: simulation({ candidateMint: OTHER.publicKey.toBase58() }) }))).refusalDetail).toContain("does not describe this envelope");
    expect((await executeMainnetBuy(common(w, { simulationValue: simulation({ simulatedAt: new Date(T0 - 600_000).toISOString() }) }))).refusalDetail).toContain("simulate again");
    expect(w.sent).toHaveLength(0);
  });

  it("refuses a devnet envelope on the mainnet path", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["0"] };
    const r = await executeMainnetBuy(common(w, { envelopeValue: envelope({ network: "devnet" }) }));
    expect(r.refusalDetail).toContain("not mainnet-beta");
    expect(w.sent).toHaveLength(0);
  });

  it("refuses when the signer is not the envelope's fee payer", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["0"] };
    const r = await executeMainnetBuy(common(w, { readFile: () => JSON.stringify(Array.from(OTHER.secretKey)) }));
    expect(r.refusalDetail).toContain("NOT the envelope's fee payer");
    expect(w.sent).toHaveLength(0);
  });

  it("refuses a duplicate buy (open position for the same mint) and max-open", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["0"] };
    const open = openPosition({ kind: "live", mint: MINT, openedAt: new Date(T0 - 60_000).toISOString(), entrySpendLamports: 1_000_000, entrySignature: "3".repeat(88) });
    const r = await executeMainnetBuy(common(w, { ledger: buildLedger([open]) }));
    expect(r.refusalDetail).toContain("duplicate buy refused");
    const m2 = new PublicKey(Buffer.alloc(32, 9)).toBase58();
    const m3 = new PublicKey(Buffer.alloc(32, 10)).toBase58();
    const two = [m2, m3].map((m) => openPosition({ kind: "live", mint: m, openedAt: new Date(T0 - 60_000).toISOString(), entrySpendLamports: 1_000_000, entrySignature: "3".repeat(88) }));
    const r2 = await executeMainnetBuy(common(w, { ledger: buildLedger(two) }));
    expect(r2.refusalDetail).toContain("max open positions reached");
    expect(w.sent).toHaveLength(0);
  });

  it("refuses when spend would breach the SOL reserve, and when spend exceeds the cap", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [12_000_000], token: ["0"] };
    const r = await executeMainnetBuy(common(w));
    expect(r.refusalDetail).toContain("SOL reserve");
    const r2 = await executeMainnetBuy(common({ ...w, sol: [1e9] }, { envelopeValue: envelope({ constraints: { maxSpendLamports: "20000000", slippageBps: 100 } }) }));
    expect(r2.refusalDetail).toContain("exceeds the per-trade cap");
    expect(w.sent).toHaveLength(0);
  });

  it("refuses when the kill switch / emergency stop is set", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["0"] };
    const r = await executeMainnetBuy(common(w, { emergencyStopFilePresent: true }));
    expect(r.refusalDetail).toContain("kill-switch-clear");
    expect(w.sent).toHaveLength(0);
  });
});

describe("executeMainnetBuy (S111) — outcomes after a send", () => {
  it("a failed submit creates NO position and reports refused", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["0"], sendError: new Error("blockhash not found") };
    const r = await executeMainnetBuy(common(w));
    expect(r.outcome).toBe("refused");
    expect(r.attempt?.refusalCode).toBe("execution-refused-rpc-unavailable");
    expect(r.position).toBeNull();
    expect(r.ledger.positions).toHaveLength(0);
  });

  it("a transaction that lands with an error is failed-onchain: NO position", async () => {
    const w: World = { sent: [], statuses: [{ slot: 5, err: { InstructionError: [3, { Custom: 6001 }] } }], sol: [1e9, 1e9 - 5_000], token: ["0", "0"] };
    const r = await executeMainnetBuy(common(w));
    expect(r.outcome).toBe("failed-onchain");
    expect(r.signature).toBe(SIG);
    expect(r.position).toBeNull();
    expect(r.ledger.positions).toHaveLength(0);
    expect(w.sent).toHaveLength(1);
  });

  it("an unconfirmed submit (timeout) creates NO position and demands reconciliation", async () => {
    const w: World = { sent: [], statuses: [null], sol: [1e9], token: ["0"] };
    const r = await executeMainnetBuy(common(w));
    expect(r.outcome).toBe("submitted-unconfirmed");
    expect(r.signature).toBe(SIG);
    expect(r.confirm?.status).toBe("timeout");
    expect(r.position).toBeNull();
    expect(r.caveats.join(" ")).toContain("MUST be reconciled");
  });

  it("a CONFIRMED buy opens a live position carrying the signature and the observed token delta", async () => {
    const w: World = { sent: [], statuses: [null, CONFIRMED], sol: [1e9, 1e9, 1e9 - 5_005_000], token: ["0", "123456789"] };
    const r = await executeMainnetBuy(common(w, { symbol: "TEST" }));
    expect(r.outcome).toBe("confirmed");
    expect(r.confirm?.slot).toBe(100);
    expect(r.tokenDelta?.deltaRaw).toBe("123456789");
    expect(r.solDeltaLamports).toBe(-5_005_000);
    expect(r.position?.kind).toBe("live");
    expect(r.position?.entrySignature).toBe(SIG);
    expect(r.position?.tokenAmountRaw).toBe("123456789");
    expect(r.position?.entrySpendLamports).toBe(5_000_000);
    expect(r.ledger.positions).toHaveLength(1);
    expect(r.ledger.totals.open).toBe(1);
    // The submitted bytes are a SIGNED transaction from the boundary signer.
    const tx = VersionedTransaction.deserialize(w.sent[0] as Uint8Array);
    expect(tx.signatures[0]?.some((b) => b !== 0)).toBe(true);
  });

  it("a confirmed buy with no observable token delta still opens the position (amount unknown) with a loud caveat", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9, 1e9, 1e9], token: ["0", "0"] };
    const r = await executeMainnetBuy(common(w));
    expect(r.outcome).toBe("confirmed");
    expect(r.position?.tokenAmountRaw).toBeNull();
    expect(r.caveats.join(" ")).toContain("tokenAmountRaw unknown");
  });

  it("never serializes the secret: the report JSON contains no 64-byte key material", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9, 1e9, 1e9], token: ["0", "1"] };
    const r = await executeMainnetBuy(common(w));
    const json = JSON.stringify(r);
    expect(json).not.toContain(Buffer.from(SIGNER.secretKey).toString("base64"));
    expect(json).not.toContain(JSON.stringify(Array.from(SIGNER.secretKey)));
  });
});

describe("executeMainnetSell (S111)", () => {
  const OPENED = openPosition({ kind: "live", mint: MINT, openedAt: new Date(T0 - 120_000).toISOString(), entrySpendLamports: 5_000_000, tokenAmountRaw: "123456789", entrySignature: "3".repeat(88) });
  const sellInput = (w: World, over: Partial<MainnetSellInput> = {}): MainnetSellInput => ({
    ...common(w),
    ledger: buildLedger([OPENED]),
    positionId: OPENED.positionId,
    reason: "take-profit",
    ...over,
  });

  it("refuses an unknown position, a closed position, and a non-live kind — sending nothing", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["123456789"] };
    expect((await executeMainnetSell(sellInput(w, { positionId: "live:nope:x" }))).refusalDetail).toContain("unknown position can never be sold");
    const paper = openPosition({ kind: "paper", mint: MINT, openedAt: new Date(T0 - 1000).toISOString(), entrySpendLamports: 1000 });
    expect((await executeMainnetSell(sellInput(w, { ledger: buildLedger([paper]), positionId: paper.positionId }))).refusalDetail).toContain("only backend-signed live positions");
    expect(w.sent).toHaveLength(0);
  });

  it("S111: accepts the builder's real sell shape (inputMint = position mint, output = SOL) and refuses selling a different held token", async () => {
    const WSOL = "So11111111111111111111111111111111111111112";
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9, 1e9 + 5_400_000], token: ["123456789", "0"] };
    const r = await executeMainnetSell(sellInput(w, { envelopeValue: envelope({ inputMint: MINT, candidateMint: WSOL }), simulationValue: simulation({ candidateMint: WSOL }) }));
    expect(r.outcome).toBe("confirmed");
    expect(r.position?.close?.signature).toBe(SIG);
    const w2: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["123456789"] };
    const wrong = await executeMainnetSell(sellInput(w2, { envelopeValue: envelope({ inputMint: OTHER.publicKey.toBase58(), candidateMint: WSOL }), simulationValue: simulation({ candidateMint: WSOL }) }));
    expect(wrong.outcome).toBe("refused");
    expect(wrong.refusalDetail).toContain("must swap the position");
    expect(w2.sent).toHaveLength(0);
  });

  it("refuses a sell envelope for a different mint", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9], token: ["123456789"] };
    const r = await executeMainnetSell(sellInput(w, { envelopeValue: envelope({ candidateMint: OTHER.publicKey.toBase58() }), simulationValue: simulation({ candidateMint: OTHER.publicKey.toBase58() }) }));
    expect(r.refusalDetail).toContain("must swap the position");
    expect(w.sent).toHaveLength(0);
  });

  it("an unconfirmed sell leaves the position OPEN (visible and retryable)", async () => {
    const w: World = { sent: [], statuses: [null], sol: [1e9], token: ["123456789"] };
    const r = await executeMainnetSell(sellInput(w));
    expect(r.outcome).toBe("submitted-unconfirmed");
    expect(r.ledger.positions[0]?.status).toBe("open");
  });

  it("a CONFIRMED sell closes the position live-auto with realized PnL from the REAL SOL delta", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9, 1e9 + 5_400_000], token: ["123456789", "0"] };
    const r = await executeMainnetSell(sellInput(w));
    expect(r.outcome).toBe("confirmed");
    expect(r.solDeltaLamports).toBe(5_400_000);
    expect(r.position?.status).toBe("closed");
    expect(r.position?.close?.closeKind).toBe("live-auto");
    expect(r.position?.close?.signature).toBe(SIG);
    expect(r.position?.close?.valueLamports).toBe(5_400_000);
    expect(r.position?.close?.pnlLamports).toBe(400_000);
    expect(r.ledger.totals.closed).toBe(1);
    expect(r.ledger.totals.realizedPnlKnownLamports).toBe(400_000);
  });

  it("a confirmed sell with a token remainder says so", async () => {
    const w: World = { sent: [], statuses: [CONFIRMED], sol: [1e9, 1e9 + 100], token: ["123456789", "5"] };
    const r = await executeMainnetSell(sellInput(w));
    expect(r.caveats.join(" ")).toContain("remainder of 5");
  });
});
