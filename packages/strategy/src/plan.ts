/**
 * Paper-only strategy → paper **planning** pipeline (Phase 6 / Sprint 6).
 *
 * Where `evaluateStrategy` judges a single candidate, this module evaluates a
 * *batch* of injected candidates and bridges the eligible ones into the shape
 * `@soulmaker/paper` consumes: a `PaperCandidate[]`. It is the deterministic,
 * offline glue between `@soulmaker/strategy` and `@soulmaker/paper` — and it only
 * ever *produces* a plan. It never runs a paper session, never fills, never
 * touches a journal, and (like everything in this package) never builds, signs,
 * simulates, or sends a transaction. There is no signer, keypair, secret key,
 * RPC, wallet, network, filesystem, `Date.now`, or `Math.random` here; the clock
 * and id generator are injected and the inputs are never mutated.
 *
 * ## Flow
 *
 *   StrategyCandidate[]  →  evaluateStrategy (per candidate)  →  StrategyReport[]
 *      →  keep only PAPER_BUY_CANDIDATE / PAPER_SELL_CANDIDATE
 *      →  convert each to a PaperCandidate (carrying the advisory risk report)
 *      →  PaperCandidate[]   (the operator may LATER hand this to `paper:run`)
 *
 * SKIP and WATCH are never converted into paper candidates. They are omitted
 * from the report `items` by default too, and only surfaced there when the
 * caller explicitly opts in (`includeSkipped` / `includeWatch`) — even then they
 * stay out of `paperCandidates`. A `PAPER_BUY_CANDIDATE` is a candidate for
 * *simulated* paper evaluation, never "safe to buy", advice, or a profit claim.
 */

import { redactString } from "@soulmaker/security";
import type { PaperCandidate, PaperSide, PaperState } from "@soulmaker/paper";
import { evaluateStrategy } from "./evaluate.js";
import { makeIdGen, type IdGen } from "./ids.js";
import { portfolioFromPaperState } from "./portfolio.js";
import {
  STRATEGY_DISCLAIMER,
  STRATEGY_NOTES,
  STRATEGY_ONLY_BANNER,
} from "./report.js";
import type {
  StrategyCandidate,
  StrategyConfig,
  StrategyDecision,
  StrategyReason,
  StrategyReport,
} from "./types.js";

/** Pure default clock — the pipeline never reads real wall-clock time itself. */
const DEFAULT_NOW = (): string => "1970-01-01T00:00:00.000Z";

/**
 * A simulated notional of `0` USD is the deliberate, fail-safe default for a
 * converted *buy* candidate when no size was provided or configured: `paper:run`
 * rejects a non-positive buy size by its caps, so a sizeless plan can never open
 * a simulated position by accident. For a *sell* candidate a `0` size means
 * "exit the whole simulated position" in `paper:run` — the natural exit default.
 */
export const DEFAULT_PAPER_SIZE_USD = 0;

/** Options that shape how a single report is converted into a paper candidate. */
export interface PaperCandidateConversionOptions {
  /**
   * Fallback simulated notional (USD) for a converted candidate that does not
   * carry its own `proposedSizeUsd`. Defaults to {@link DEFAULT_PAPER_SIZE_USD}.
   */
  defaultPaperSizeUsd?: number;
}

/** Input to {@link planStrategyBatch}. Deterministic given an injected clock + id gen. */
export interface StrategyPlanInput {
  /** Injected, read-only candidate list (e.g. a snipe-/candidate-list). */
  candidates: StrategyCandidate[];
  /** Strategy thresholds + gates (shared with `evaluateStrategy`). */
  config: StrategyConfig;
  /**
   * Optional injected, simulated paper state. Adapted internally (read-only) via
   * `portfolioFromPaperState` so the position-awareness rules apply to the batch.
   */
  paperState?: PaperState;
  /**
   * Keep `SKIP` decisions in the report `items` (they are never converted into
   * `paperCandidates`). Default false.
   */
  includeSkipped?: boolean;
  /**
   * Keep `WATCH` decisions in the report `items` (they are never converted into
   * `paperCandidates`). Default false.
   */
  includeWatch?: boolean;
  /**
   * Fallback simulated notional (USD) for converted candidates lacking their own
   * `proposedSizeUsd`. See {@link DEFAULT_PAPER_SIZE_USD}.
   */
  defaultPaperSizeUsd?: number;
  /** Injectable clock (ISO string) for deterministic output/tests. */
  now?: () => string;
  /** Injectable id generator. Defaults to a seeded `strategy-plan-N` counter. */
  nextId?: IdGen;
}

/** One candidate's place in the plan: its decision plus any converted candidate. */
export interface StrategyPlanItem {
  /** Stable id from the injected id generator (shared with the underlying report). */
  id: string;
  mint: string;
  symbol?: string;
  decision: StrategyDecision;
  /** Deterministic strategy score, clamped to `[0, 100]`. */
  score: number;
  reasons: StrategyReason[];
  disqualifiers: StrategyReason[];
  /** True iff this item produced an entry in `paperCandidates`. */
  includedInPaperCandidates: boolean;
  /** Why it was not included (present iff `includedInPaperCandidates` is false). */
  omissionReason?: string;
  /** The converted paper candidate (present iff `includedInPaperCandidates`). */
  paperCandidate?: PaperCandidate;
  /** The full underlying strategy report (deterministic, JSON-serializable). */
  report: StrategyReport;
}

/** The full result of planning a batch. JSON-serializable and deterministic. */
export interface StrategyPlanResult {
  /** ISO-8601 timestamp from the injected clock (deterministic in tests). */
  createdAt: string;
  /** Number of input candidates evaluated (regardless of item inclusion). */
  totalCandidates: number;
  paperBuyCandidateCount: number;
  paperSellCandidateCount: number;
  /** `SKIP` decisions with NO disqualifier (score below the watch threshold). */
  skippedCount: number;
  watchCount: number;
  /** `SKIP` decisions caused by a hard disqualifier (risk/metric/cooldown gate). */
  rejectedCount: number;
  /**
   * The per-candidate breakdown. Always contains the paper-eligible items; also
   * contains `WATCH`/`SKIP` items when the caller opted in. Counts above are
   * computed over ALL candidates, independent of which items are kept here.
   */
  items: StrategyPlanItem[];
  /**
   * The deterministic `PaperCandidate[]` the operator may LATER pass to
   * `paper:run`. Only `PAPER_BUY_CANDIDATE` / `PAPER_SELL_CANDIDATE` appear here.
   */
  paperCandidates: PaperCandidate[];
  /** The required paper-only / not-advice statements (stable order). */
  disclaimers: string[];
  /** Always true: this pipeline only ever feeds paper simulation. */
  paperOnly: true;
}

/** Map a paper-eligible decision to a {@link PaperSide}; non-eligible ⇒ undefined. */
function sideForDecision(decision: StrategyDecision): PaperSide | undefined {
  if (decision === "PAPER_BUY_CANDIDATE") return "BUY";
  if (decision === "PAPER_SELL_CANDIDATE") return "SELL";
  return undefined;
}

/** Resolve a non-negative simulated size: per-candidate ► configured default ► 0. */
function resolveSizeUsd(
  candidate: StrategyCandidate,
  options: PaperCandidateConversionOptions,
): number {
  const perCandidate = candidate.proposedSizeUsd;
  if (typeof perCandidate === "number" && Number.isFinite(perCandidate) && perCandidate >= 0) {
    return perCandidate;
  }
  const configured = options.defaultPaperSizeUsd;
  if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return DEFAULT_PAPER_SIZE_USD;
}

/**
 * Convert ONE strategy report into a `PaperCandidate`, or `undefined` when the
 * decision is not paper-eligible (`SKIP` / `WATCH` are never converted). The
 * converted candidate carries the advisory risk report, the proposed side, a
 * resolved simulated size, and provenance metadata making clear it came from the
 * strategy pipeline and is paper-only. Pure: never mutates its inputs.
 */
export function strategyReportToPaperCandidate(
  report: StrategyReport,
  candidate: StrategyCandidate,
  options: PaperCandidateConversionOptions = {},
): PaperCandidate | undefined {
  const side = sideForDecision(report.decision);
  if (side === undefined) return undefined;

  // A sized PARTIAL simulated exit carries its own deterministic positive size; a
  // FULL exit keeps the existing default (0 ⇒ paper:run exits the whole position).
  const exit = report.exit;
  let proposedSizeUsd: number;
  if (
    exit !== undefined &&
    exit.action === "PARTIAL_EXIT" &&
    typeof exit.sizeUsd === "number" &&
    exit.sizeUsd > 0
  ) {
    proposedSizeUsd = exit.sizeUsd;
  } else {
    proposedSizeUsd = resolveSizeUsd(candidate, options);
  }

  const exitDetail =
    side === "SELL" && exit?.trigger !== undefined
      ? `simulated ${exit.action === "PARTIAL_EXIT" ? "partial" : "full"} exit ` +
        `triggered by ${exit.trigger}; `
      : "";

  const paperCandidate: PaperCandidate = {
    mint: report.mint,
    proposedSide: side,
    proposedSizeUsd,
    source: report.source !== undefined ? `strategy-plan:${report.source}` : "strategy-plan",
    reason:
      `PAPER ONLY: strategy ${report.decision} (score ${report.score}/100); ` +
      exitDetail +
      "simulated paper candidate, not a buy recommendation — " +
      "no transaction was built, signed, simulated, or sent.",
  };
  if (report.symbol !== undefined) paperCandidate.symbol = report.symbol;
  // Carry the advisory risk report so `paper:run` re-gates on the same evidence.
  if (candidate.riskReport !== undefined) paperCandidate.riskReport = candidate.riskReport;
  return paperCandidate;
}

/** Explain why a non-converted decision did not become a paper candidate. */
function omissionReasonFor(report: StrategyReport): string {
  if (report.decision === "WATCH") {
    return "decision WATCH — observed only; not submitted as a paper candidate";
  }
  if (report.decision === "SKIP") {
    if (report.disqualifiers.length > 0) {
      const ids = report.disqualifiers.map((d) => d.id).join(", ");
      return `decision SKIP — disqualified (${ids})`;
    }
    return "decision SKIP — strategy score below the watch threshold";
  }
  // Unreachable for the four known decisions, but fail safe rather than convert.
  return "decision not paper-eligible";
}

/**
 * Evaluate a batch of injected candidates and produce a deterministic plan plus
 * the `PaperCandidate[]` the operator may LATER feed to `paper:run`. Pure: no
 * fs, no network, no RPC, no wallet, no clock beyond the injected one. The input
 * candidates and config are never mutated. Candidate order is preserved, and
 * duplicate mints are PRESERVED (each gets its own stable item id) rather than
 * deduplicated — the strategy layer does not assume a one-position-per-mint
 * model; `paper:run` and its caps remain the place where that is enforced.
 */
export function planStrategyBatch(input: StrategyPlanInput): StrategyPlanResult {
  const nowFn = input.now ?? DEFAULT_NOW;
  const createdAt = nowFn();
  const nextId = input.nextId ?? makeIdGen("strategy-plan");
  const portfolio = input.paperState ? portfolioFromPaperState(input.paperState) : undefined;
  const conversion: PaperCandidateConversionOptions =
    input.defaultPaperSizeUsd !== undefined
      ? { defaultPaperSizeUsd: input.defaultPaperSizeUsd }
      : {};

  const items: StrategyPlanItem[] = [];
  const paperCandidates: PaperCandidate[] = [];
  let paperBuyCandidateCount = 0;
  let paperSellCandidateCount = 0;
  let skippedCount = 0;
  let watchCount = 0;
  let rejectedCount = 0;

  for (const candidate of input.candidates) {
    const report = evaluateStrategy({
      candidate,
      config: input.config,
      ...(portfolio !== undefined ? { portfolio } : {}),
      now: nowFn,
      nextId,
    });

    // Counts are over ALL candidates, independent of item-inclusion flags.
    switch (report.decision) {
      case "PAPER_BUY_CANDIDATE":
        paperBuyCandidateCount += 1;
        break;
      case "PAPER_SELL_CANDIDATE":
        paperSellCandidateCount += 1;
        break;
      case "WATCH":
        watchCount += 1;
        break;
      case "SKIP":
        if (report.disqualifiers.length > 0) rejectedCount += 1;
        else skippedCount += 1;
        break;
    }

    const paperCandidate = strategyReportToPaperCandidate(report, candidate, conversion);
    const included = paperCandidate !== undefined;

    const item: StrategyPlanItem = {
      id: report.id,
      mint: report.mint,
      decision: report.decision,
      score: report.score,
      reasons: report.reasons,
      disqualifiers: report.disqualifiers,
      includedInPaperCandidates: included,
      report,
    };
    if (report.symbol !== undefined) item.symbol = report.symbol;
    if (paperCandidate !== undefined) {
      item.paperCandidate = paperCandidate;
      paperCandidates.push(paperCandidate);
    } else {
      item.omissionReason = omissionReasonFor(report);
    }

    // Keep paper-eligible items always; keep WATCH/SKIP only when opted in.
    const keepItem =
      included ||
      (report.decision === "WATCH" && input.includeWatch === true) ||
      (report.decision === "SKIP" && input.includeSkipped === true);
    if (keepItem) items.push(item);
  }

  return {
    createdAt,
    totalCandidates: input.candidates.length,
    paperBuyCandidateCount,
    paperSellCandidateCount,
    skippedCount,
    watchCount,
    rejectedCount,
    items,
    paperCandidates,
    disclaimers: [...STRATEGY_NOTES],
    paperOnly: true,
  };
}

/**
 * Convenience: run {@link planStrategyBatch} and return ONLY the deterministic
 * `PaperCandidate[]`. This is exactly what a `--out` file should contain — the
 * array an operator can later hand to `paper:run`. Nothing here runs a session.
 */
export function buildPaperCandidateBatch(input: StrategyPlanInput): PaperCandidate[] {
  return planStrategyBatch(input).paperCandidates;
}

export interface FormatStrategyPlanOptions {
  /** Optional title for the rendered block. Default "Strategy plan". */
  title?: string;
}

/** A stable, JSON-serializable envelope for `--json` output of a plan. */
export interface StrategyPlanEnvelope {
  banner: string;
  paperOnly: true;
  notFinancialAdvice: true;
  disclaimer: string;
  notes: string[];
  result: StrategyPlanResult;
}

/**
 * Build the `--json` envelope. It always carries the banner + disclaimer + notes
 * so the required product language survives serialization even if a consumer
 * only reads the envelope's top level.
 */
export function buildStrategyPlanEnvelope(result: StrategyPlanResult): StrategyPlanEnvelope {
  return {
    banner: STRATEGY_ONLY_BANNER,
    paperOnly: true,
    notFinancialAdvice: true,
    disclaimer: STRATEGY_DISCLAIMER,
    notes: [...STRATEGY_NOTES],
    result,
  };
}

function renderPlanItem(item: StrategyPlanItem): string[] {
  const lines: string[] = [];
  const symbol = item.symbol !== undefined ? ` (${item.symbol})` : "";
  lines.push(`- ${item.decision}  ${item.mint}${symbol}  score ${item.score}/100`);
  if (item.paperCandidate) {
    const pc = item.paperCandidate;
    lines.push(`    → paper candidate: ${pc.proposedSide ?? "BUY"} size ${pc.proposedSizeUsd} USD`);
    const exit = item.report.exit;
    if (exit?.trigger !== undefined) {
      const sized = exit.action === "PARTIAL_EXIT" ? ` (${exit.sizeUsd} USD)` : "";
      lines.push(`      exit (simulated): ${exit.action} via ${exit.trigger}${sized}`);
    }
  } else if (item.omissionReason) {
    lines.push(`    omitted: ${item.omissionReason}`);
  }
  return lines;
}

/**
 * Render a redacted, human-readable PAPER-ONLY plan report. Stable for a given
 * result (no clock/randomness beyond the result's own `createdAt`). Carries the
 * required statements: PAPER ONLY, not financial advice, not a buy
 * recommendation, and "no transaction was built, signed, simulated, or sent".
 */
export function formatStrategyPlanReport(
  result: StrategyPlanResult,
  options: FormatStrategyPlanOptions = {},
): string {
  const title = options.title ?? "Strategy plan";
  const header = `${title} (${STRATEGY_ONLY_BANNER})`;
  const lines: string[] = [];
  lines.push(header);
  lines.push("-".repeat(header.length));
  lines.push(`created:           ${result.createdAt}`);
  lines.push(`candidates:        ${result.totalCandidates}`);
  lines.push(
    `paper candidates:  ${result.paperCandidates.length} ` +
      `(${result.paperBuyCandidateCount} buy / ${result.paperSellCandidateCount} sell)`,
  );
  lines.push(`watch:             ${result.watchCount}`);
  lines.push(`skipped:           ${result.skippedCount}`);
  lines.push(`rejected:          ${result.rejectedCount}`);
  lines.push("");

  lines.push("Items:");
  if (result.items.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of result.items) lines.push(...renderPlanItem(item));
  }
  lines.push("");

  lines.push("Notes:");
  for (const note of result.disclaimers) lines.push(`- ${note}`);
  lines.push("");
  lines.push(
    "Next step is MANUAL: review the paper candidates, then (optionally) pass " +
      "them to `paper:run`. This command does not run paper trades automatically.",
  );
  lines.push("");
  lines.push(STRATEGY_DISCLAIMER);

  return redactString(lines.join("\n"));
}
