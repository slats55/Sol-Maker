/**
 * Deterministic scenario-authoring scaffolding for the injected-only paper
 * backtest. This is NOT generation of market data and NOT AI: it builds a small
 * set of fixed, hand-designed scenario SKELETONS so a user can start from a known
 * good shape, lint it, and run it — then edit the fixture by hand.
 *
 * Every template is a self-contained {@link BacktestScenario} of INJECTED data:
 * fake token symbols, fake mint-like identifiers, and injected prices. Nothing
 * here is historical market truth, a real token, a wallet, or a key. The builders
 * are **pure** (no network, no RPC, no filesystem, no `Date.now`, no `Math.random`)
 * and return a FRESH object each call, so callers can mutate the result freely.
 */

import type { BacktestScenario, BacktestStep } from "./types.js";

/** The built-in template identifiers. */
export type BacktestScenarioTemplate =
  | "buy-hold"
  | "buy-full-exit"
  | "partial-exit"
  | "seed-journal-continuation";

/** Static, deterministic description of a template (no scenario is built here). */
export interface BacktestScenarioTemplateInfo {
  template: BacktestScenarioTemplate;
  /** Default scenario name the builder uses when `opts.name` is not given. */
  defaultName: string;
  /** One-sentence summary of what the skeleton demonstrates. */
  summary: string;
  /** The exact lint warning codes the built scenario is expected to carry. */
  expectedWarnings: string[];
}

export interface BuildBacktestScenarioOptions {
  /** Override the scenario `name` (must be a non-empty string). */
  name?: string;
}

// --- injected fixture constants (fake — never real tokens/wallets/keys) -------

const MINT_A = "FakeAAA1111111111111111111111111111111111111";
const MINT_B = "FakeBBB2222222222222222222222222222222222222";
const MINT_C = "FakeCCC3333333333333333333333333333333333333";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T01:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

const RISK_DISCLAIMER = "Advisory only — INJECTED FIXTURE, not a real risk assessment.";
const PRICE_SOURCE = "injected-fixture";

const TEMPLATE_INFO: Record<BacktestScenarioTemplate, Omit<BacktestScenarioTemplateInfo, "template">> = {
  "buy-hold": {
    defaultName: "buy-hold — INJECTED FIXTURE (simulated, not real market data)",
    summary: "One PASS candidate buys and holds; one open position with deterministic unrealized PnL.",
    expectedWarnings: [],
  },
  "buy-full-exit": {
    defaultName: "buy-full-exit — INJECTED FIXTURE (simulated, not real market data)",
    summary: "Buy then a take-profit FULL exit; deterministic realized PnL and a closed trade.",
    expectedWarnings: [],
  },
  "partial-exit": {
    defaultName: "partial-exit — INJECTED FIXTURE (simulated, not real market data)",
    summary: "Multi-mint: buy A + B, reject C at the risk gate, then a PARTIAL take-profit exit of A.",
    expectedWarnings: [],
  },
  "seed-journal-continuation": {
    defaultName: "seed-journal-continuation — INJECTED FIXTURE (simulated, not real market data)",
    summary: "Seeds one open position from an embedded journal, then exits it on a take-profit.",
    expectedWarnings: ["initial-journal-open-positions"],
  },
};

// --- small typed builders ----------------------------------------------------

/** A PASS risk report. `as const` keeps `decision` a `RiskDecision` without a risk import. */
function passRisk(mint: string, at: string) {
  return {
    mint,
    decision: "PASS_FOR_PAPER_EVALUATION" as const,
    score: 12,
    flags: [],
    summary: [],
    generatedAt: at,
    disclaimer: RISK_DISCLAIMER,
  };
}

/** A REJECT risk report — the risk gate SKIPs it before any simulated buy. */
function rejectRisk(mint: string, at: string) {
  return {
    mint,
    decision: "REJECT" as const,
    score: 95,
    flags: [],
    summary: ["Injected REJECT fixture — demonstrates the risk-gate skip path."],
    generatedAt: at,
    disclaimer: RISK_DISCLAIMER,
  };
}

function passCandidate(mint: string, symbol: string, at: string) {
  return { mint, symbol, source: PRICE_SOURCE, riskReport: passRisk(mint, at) };
}

function price(mint: string, priceUsd: number, observedAt: string) {
  return { mint, priceUsd, observedAt, source: PRICE_SOURCE };
}

function strategyConfig(extra?: Record<string, number>): BacktestScenario["strategyConfig"] {
  return { minScoreForPaperBuy: 50, minScoreForWatch: 30, maxRiskScore: 60, ...extra };
}

function caps(): BacktestScenario["caps"] {
  return { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false };
}

// --- per-template builders ---------------------------------------------------

function buildBuyHold(name: string): BacktestScenario {
  const step: BacktestStep = {
    id: "step-1",
    at: T0,
    candidates: [passCandidate(MINT_A, "FAKEA", T0)],
    prices: [price(MINT_A, 2, T0), price(MINT_A, 3, T1)],
  };
  return { name, strategyConfig: strategyConfig(), caps: caps(), defaultPaperSizeUsd: 100, steps: [step] };
}

function buildBuyFullExit(name: string): BacktestScenario {
  const step: BacktestStep = {
    id: "step-1",
    at: T0,
    takeProfitPct: 50, // 2 → 3 is +50%, so the held position fully exits this step.
    candidates: [passCandidate(MINT_A, "FAKEA", T0)],
    prices: [price(MINT_A, 2, T0), price(MINT_A, 3, T1)],
  };
  return { name, strategyConfig: strategyConfig(), caps: caps(), defaultPaperSizeUsd: 100, steps: [step] };
}

function buildPartialExit(name: string): BacktestScenario {
  const entries: BacktestStep = {
    id: "step-1-entries",
    at: T0,
    candidates: [
      passCandidate(MINT_A, "FAKEA", T0),
      passCandidate(MINT_B, "FAKEB", T0),
      { mint: MINT_C, symbol: "FAKEC", source: PRICE_SOURCE, riskReport: rejectRisk(MINT_C, T0) },
    ],
    prices: [price(MINT_A, 2, T0), price(MINT_B, 4, T0), price(MINT_C, 1, T0)],
  };
  const partial: BacktestStep = {
    id: "step-2-partial-exit",
    at: T2,
    candidates: [{ ...passCandidate(MINT_A, "FAKEA", T2), metrics: { priceChangePct: 40 } }],
    prices: [price(MINT_A, 3, T2), price(MINT_B, 5, T2)],
  };
  return {
    name,
    strategyConfig: strategyConfig({ takeProfitPartialPct: 30, partialExitFraction: 0.5 }),
    caps: caps(),
    defaultPaperSizeUsd: 100,
    steps: [entries, partial],
  };
}

function buildSeedJournalContinuation(name: string): BacktestScenario {
  // An embedded append-only journal seeding ONE open MINT_A position (50 @ $2).
  const seedFill = {
    type: "PAPER_BUY_FILLED",
    at: T0,
    fill: {
      id: "seed-fill-1",
      orderId: "seed-order-1",
      mint: MINT_A,
      side: "BUY",
      priceUsd: 2,
      quantity: 50,
      notionalUsd: 100,
      feeUsd: 0,
      filledAt: T0,
    },
  };
  const step: BacktestStep = {
    id: "step-1-continue",
    at: T2,
    takeProfitPct: 50, // seeded A entered at 2; price 3 (+50%) fully exits it.
    candidates: [passCandidate(MINT_B, "FAKEB", T2)],
    prices: [price(MINT_A, 3, T2), price(MINT_B, 4, T2)],
  };
  return {
    name,
    strategyConfig: strategyConfig(),
    caps: caps(),
    defaultPaperSizeUsd: 100,
    initialJournal: `${JSON.stringify(seedFill)}\n`,
    steps: [step],
  };
}

// --- public API --------------------------------------------------------------

/** List the built-in scenario templates with their default name + expected warnings. */
export function listBacktestScenarioTemplates(): BacktestScenarioTemplateInfo[] {
  return (Object.keys(TEMPLATE_INFO) as BacktestScenarioTemplate[]).map((template) => ({
    template,
    ...TEMPLATE_INFO[template],
  }));
}

/**
 * Build a fresh, deterministic, INJECTED backtest scenario from a built-in
 * template. The result validates and runs through `runBacktest`; it carries only
 * fake mints/symbols and injected prices. Throws on an unknown template or an empty
 * `opts.name`.
 */
export function buildExampleBacktestScenario(
  template: BacktestScenarioTemplate,
  opts: BuildBacktestScenarioOptions = {},
): BacktestScenario {
  if (opts.name !== undefined && opts.name.length === 0) {
    throw new Error("scenario name override must be a non-empty string");
  }
  const info = TEMPLATE_INFO[template] as BacktestScenarioTemplateInfo | undefined;
  if (!info) {
    throw new Error(`unknown backtest scenario template: ${String(template)}`);
  }
  const name = opts.name ?? info.defaultName;

  switch (template) {
    case "buy-hold":
      return buildBuyHold(name);
    case "buy-full-exit":
      return buildBuyFullExit(name);
    case "partial-exit":
      return buildPartialExit(name);
    case "seed-journal-continuation":
      return buildSeedJournalContinuation(name);
    default: {
      // Exhaustive: a new template must be handled above.
      const exhaustive: never = template;
      throw new Error(`unknown backtest scenario template: ${String(exhaustive)}`);
    }
  }
}
