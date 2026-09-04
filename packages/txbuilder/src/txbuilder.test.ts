import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { evaluateBuildRefusals, type BuildSwapRequest } from "./refusals.js";
import { createJupiterSwapBuilder } from "./jupiter-swap.js";
import type { FetchLike } from "./jupiter-swap.js";

// Keypair appears ONLY to fabricate test inputs (throwaway public keys + the forbidden signed case).
const WALLET = Keypair.generate();
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 3)).toBase58();

function cleanRequest(overrides: Partial<BuildSwapRequest> = {}): BuildSwapRequest {
  return {
    candidateMint: USDC,
    inputMint: WSOL,
    amountRaw: "10000000",
    slippageBps: 50,
    walletPublicKey: WALLET.publicKey.toBase58(),
    network: "mainnet-beta",
    executionMode: "mainnet-dry-run",
    killSwitchActive: false,
    risk: { score: 10, decision: "PASS_FOR_PAPER_EVALUATION" },
    controls: { maxSpendLamports: "100000000", slippageCapBps: 100, riskScoreCap: 30 },
    ...overrides,
  };
}

const codes = (request: BuildSwapRequest): string[] => evaluateBuildRefusals(request).map((r) => r.code);

describe("evaluateBuildRefusals — every refusal reason, individually", () => {
  it("a fully clean request has ZERO refusals", () => {
    expect(codes(cleanRequest())).toEqual([]);
  });

  const cases: Array<[string, Partial<BuildSwapRequest>, string]> = [
    ["kill switch", { killSwitchActive: true }, "build-refused-kill-switch-active"],
    ["paper mode", { executionMode: "paper" }, "build-refused-mode-cannot-build"],
    ["readonly mode", { executionMode: "readonly" }, "build-refused-mode-cannot-build"],
    ["blocked live mode", { executionMode: "mainnet-live-blocked" }, "build-refused-mode-cannot-build"],
    ["missing mode (default)", { executionMode: undefined }, "build-refused-mode-cannot-build"],
    ["bad network", { network: "testnet" }, "build-refused-network-unsupported"],
    ["devnet mode vs mainnet tx", { executionMode: "devnet-execution", network: "mainnet-beta" }, "build-refused-network-mismatch"],
    ["mainnet mode vs devnet tx", { executionMode: "mainnet-dry-run", network: "devnet" }, "build-refused-network-mismatch"],
    ["wallet missing", { walletPublicKey: null }, "build-refused-wallet-missing"],
    ["wallet invalid", { walletPublicKey: "nope" }, "build-refused-wallet-invalid"],
    ["wallet secret-length", { walletPublicKey: "5".repeat(88) }, "build-refused-wallet-invalid"],
    ["candidate mint missing", { candidateMint: null }, "build-refused-mint-missing"],
    ["candidate mint invalid", { candidateMint: "xx" }, "build-refused-mint-invalid"],
    ["amount missing", { amountRaw: null }, "build-refused-amount-missing"],
    ["amount zero", { amountRaw: "0" }, "build-refused-amount-missing"],
    ["risk missing", { risk: null }, "build-refused-risk-missing"],
    ["risk REJECT", { risk: { score: 10, decision: "REJECT" } }, "build-refused-risk-rejected"],
    ["risk over cap", { risk: { score: 95, decision: "CAUTION" } }, "build-refused-risk-over-threshold"],
    ["risk cap missing", { controls: { maxSpendLamports: "100000000", slippageCapBps: 100, riskScoreCap: null } }, "build-refused-risk-cap-missing"],
    ["spend cap missing", { controls: { maxSpendLamports: null, slippageCapBps: 100, riskScoreCap: 30 } }, "build-refused-spend-cap-missing"],
    ["spend over cap", { amountRaw: "200000000" }, "build-refused-spend-over-cap"],
    ["slippage missing", { slippageBps: null }, "build-refused-slippage-missing"],
    ["slippage over cap", { slippageBps: 500 }, "build-refused-slippage-over-cap"],
    ["slippage cap missing", { controls: { maxSpendLamports: "100000000", slippageCapBps: null, riskScoreCap: 30 } }, "build-refused-slippage-cap-missing"],
  ];
  for (const [label, overrides, expected] of cases) {
    it(`${label} -> ${expected}`, () => {
      expect(codes(cleanRequest(overrides))).toContain(expected);
    });
  }

  it("S111: the lamport spend cap applies to a SOL-input BUY only; a token->SOL SELL of a held amount is not compared to it, but the cap stays required", () => {
    const sell = cleanRequest({ inputMint: USDC, candidateMint: WSOL, amountRaw: "16514881510", controls: { maxSpendLamports: "5000000", slippageCapBps: 100, riskScoreCap: 100 } });
    expect(codes(sell)).not.toContain("build-refused-spend-over-cap");
    expect(codes({ ...sell, controls: { maxSpendLamports: null, slippageCapBps: 100, riskScoreCap: 100 } })).toContain("build-refused-spend-cap-missing");
    expect(codes(cleanRequest({ inputMint: WSOL, amountRaw: "16514881510", controls: { maxSpendLamports: "5000000", slippageCapBps: 100, riskScoreCap: 100 } }))).toContain("build-refused-spend-over-cap");
  });

  it("refusals ACCUMULATE — a many-problem request reports them all at once", () => {
    const all = codes(cleanRequest({ killSwitchActive: true, executionMode: "paper", risk: null, slippageBps: 50000 }));
    expect(all.length).toBeGreaterThanOrEqual(4);
  });
});

// --- builder over a fake provider ------------------------------------------------------------

function unsignedSwapTxBase64(payer: PublicKey): string {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 })],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

function quoteBody(): string {
  return JSON.stringify({
    inputMint: WSOL,
    inAmount: "10000000",
    outputMint: USDC,
    outAmount: "665932",
    otherAmountThreshold: "662603",
    priceImpactPct: "0.01",
    routePlan: [{ swapInfo: { label: "TestVenue" } }],
    contextSlot: 12345,
  });
}

/** A fake provider that serves the quote GET and the swap POST; counts calls. */
function fakeProvider(opts: { swapTxBase64?: string; quoteStatus?: number; swapStatus?: number } = {}) {
  let calls = 0;
  const fetchLike: FetchLike = async (url, init) => {
    calls += 1;
    if (url.includes("/quote")) {
      const status = opts.quoteStatus ?? 200;
      return { ok: status < 300, status, text: async () => (status < 300 ? quoteBody() : "err") };
    }
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(body.userPublicKey).toBe(WALLET.publicKey.toBase58());
    const status = opts.swapStatus ?? 200;
    return {
      ok: status < 300,
      status,
      text: async () =>
        status < 300 ? JSON.stringify({ swapTransaction: opts.swapTxBase64 ?? unsignedSwapTxBase64(WALLET.publicKey) }) : "err",
    };
  };
  return { fetchLike, callCount: () => calls };
}

const FIXED_CLOCK = (): string => "2026-06-12T05:45:00.000Z";

describe("createJupiterSwapBuilder — refusal-first, then the real two-leg flow", () => {
  it("a refused request NEVER reaches the provider (zero network calls)", async () => {
    const provider = fakeProvider();
    const builder = createJupiterSwapBuilder({ fetchLike: provider.fetchLike, clock: FIXED_CLOCK });
    const result = await builder.build(cleanRequest({ killSwitchActive: true }));
    expect(result.built).toBe(false);
    expect(provider.callCount()).toBe(0);
  });

  it("devnet build is refused — the lite swap API has no devnet", async () => {
    const provider = fakeProvider();
    const builder = createJupiterSwapBuilder({ fetchLike: provider.fetchLike });
    const result = await builder.build(cleanRequest({ network: "devnet", executionMode: "devnet-execution" }));
    expect(result.built).toBe(false);
    if (!result.built) {
      expect(result.refusals.some((r) => r.code === "build-refused-network-unsupported")).toBe(true);
    }
    expect(provider.callCount()).toBe(0);
  });

  it("happy path: fresh quote -> swap build -> strictly-validated UNSIGNED envelope", async () => {
    const provider = fakeProvider();
    const builder = createJupiterSwapBuilder({ fetchLike: provider.fetchLike, clock: FIXED_CLOCK });
    const result = await builder.build(cleanRequest());
    expect(result.built, JSON.stringify(result)).toBe(true);
    if (result.built) {
      expect(result.envelope.schemaVersion).toBe("txpreview.envelope.v1");
      expect(result.envelope.network).toBe("mainnet-beta");
      expect(result.envelope.builderId).toBe("jupiter-swap-api");
      expect(result.envelope.unsigned).toBe(true);
      expect(result.envelope.phase7LiveTradingReady).toBe(false);
      expect(result.envelope.candidateMint).toBe(USDC);
      expect(result.envelope.routeCaveats.join("\n")).toContain("never an order");
      expect(result.quoteFacts.inAmountRaw).toBe("10000000");
      expect(result.quoteFacts.quotedAt).toBe("2026-06-12T05:45:00.000Z");
      // Sprint 93: the envelope itself carries the quote provenance for downstream freshness gates.
      expect(result.envelope.quotedAt).toBe("2026-06-12T05:45:00.000Z");
    }
    expect(provider.callCount()).toBe(2);
  });

  it("S93: an explicit maxQuoteAgeMs refuses a build whose quote aged out mid-flight (build-refused-quote-stale)", async () => {
    const provider = fakeProvider();
    // The clock advances 5s between the quote stamp and the post-swap freshness check.
    const ticks = ["2026-06-12T05:45:00.000Z", "2026-06-12T05:45:05.000Z"];
    const slowClock = (): string => ticks.length > 1 ? (ticks.shift() as string) : (ticks[0] as string);
    const builder = createJupiterSwapBuilder({ fetchLike: provider.fetchLike, clock: slowClock });
    const result = await builder.build(cleanRequest({ controls: { maxSpendLamports: "100000000", slippageCapBps: 100, riskScoreCap: 50, maxQuoteAgeMs: 1000 } }));
    expect(result.built).toBe(false);
    if (!result.built) {
      expect(result.refusals).toHaveLength(1);
      expect(result.refusals[0]?.code).toBe("build-refused-quote-stale");
      expect(result.refusals[0]?.detail).toContain("aged out");
    }
  });

  it("S93: a build within the explicit maxQuoteAgeMs cap succeeds (the cap only refuses, never fakes)", async () => {
    const provider = fakeProvider();
    const builder = createJupiterSwapBuilder({ fetchLike: provider.fetchLike, clock: FIXED_CLOCK });
    const result = await builder.build(cleanRequest({ controls: { maxSpendLamports: "100000000", slippageCapBps: 100, riskScoreCap: 50, maxQuoteAgeMs: 1000 } }));
    expect(result.built, JSON.stringify(result)).toBe(true);
  });

  it("a SIGNED provider transaction is refused (the envelope validator is the wall)", async () => {
    const message = new TransactionMessage({
      payerKey: WALLET.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: [SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: WALLET.publicKey, lamports: 1 })],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([WALLET]);
    const provider = fakeProvider({ swapTxBase64: Buffer.from(tx.serialize()).toString("base64") });
    const builder = createJupiterSwapBuilder({ fetchLike: provider.fetchLike });
    const result = await builder.build(cleanRequest());
    expect(result.built).toBe(false);
    if (!result.built) {
      expect(result.refusals[0]?.code).toBe("build-refused-provider-response-unsupported");
      expect(result.refusals[0]?.detail).toContain("SIGNED");
    }
  });

  it("quote-leg failures map onto the closed refusal codes", async () => {
    for (const [status, code] of [
      [429, "build-refused-quote-blocked"],
      [500, "build-refused-quote-error"],
    ] as const) {
      const provider = fakeProvider({ quoteStatus: status });
      const builder = createJupiterSwapBuilder({ fetchLike: provider.fetchLike });
      const result = await builder.build(cleanRequest());
      expect(result.built).toBe(false);
      if (!result.built) expect(result.refusals[0]?.code).toBe(code);
    }
    const failing: FetchLike = async () => {
      throw new Error("ENOTFOUND");
    };
    const result = await createJupiterSwapBuilder({ fetchLike: failing }).build(cleanRequest());
    expect(result.built).toBe(false);
    if (!result.built) expect(result.refusals[0]?.code).toBe("build-refused-quote-unavailable");
  });

  it("a fresh quote whose mints contradict the request is refused", async () => {
    const badQuote: FetchLike = async (url) => {
      if (url.includes("/quote")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ inputMint: USDC, outputMint: WSOL, inAmount: "1", outAmount: "1" }) };
      }
      throw new Error("swap leg must not be reached");
    };
    const result = await createJupiterSwapBuilder({ fetchLike: badQuote }).build(cleanRequest());
    expect(result.built).toBe(false);
    if (!result.built) expect(result.refusals[0]?.code).toBe("build-refused-quote-mint-mismatch");
  });

  it("nothing secret-shaped survives into a build result", async () => {
    const provider = fakeProvider();
    const builder = createJupiterSwapBuilder({ fetchLike: provider.fetchLike });
    const result = await builder.build(cleanRequest());
    // The base64 transaction is allowed; scan the rest of the result.
    const { envelope, ...rest } = result as { envelope?: { txBase64?: string } } & Record<string, unknown>;
    const scrubbed = JSON.stringify({ ...rest, envelope: { ...envelope, txBase64: "[tx]" } });
    expect(scrubbed).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{80,}/);
    expect(scrubbed).not.toMatch(/[0-9a-f]{64,}/i);
  });
});
