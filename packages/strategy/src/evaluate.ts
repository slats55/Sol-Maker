/**
 * The deterministic, paper-only strategy rules engine.
 *
 * `evaluateStrategy` turns one {@link StrategyCandidate} (an advisory risk report
 * plus injected, read-only metrics) into a single {@link StrategyReport} with a
 * {@link StrategyDecision}. It is **pure**: no network, no RPC, no wallet, no
 * filesystem, no `Date.now`, no `Math.random`. The clock and id generator are
 * injected; the input candidate and config are never mutated.
 *
 * The output only ever feeds `@soulmaker/paper`. A `PAPER_BUY_CANDIDATE` /
 * `PAPER_SELL_CANDIDATE` is a candidate for *simulated* paper evaluation — it is
 * not a real buy/sell, not advice, not a profitability claim, and never builds,
 * signs, simulates, or sends a transaction.
 *
 * ## Decision flow (deterministic)
 *
 *  1. **Risk gate** (both entry & exit paths). Missing report ⇒ SKIP; `REJECT` ⇒
 *     always SKIP; `CAUTION` ⇒ SKIP unless `allowCaution`; advisory risk score
 *     above `maxRiskScore` ⇒ SKIP. These are hard disqualifiers.
 *  2. **Entry metric gates** (only when *not* holding). A configured-but-missing
 *     metric, or a metric below its minimum / above its max, is a disqualifier.
 *  3. **Loss cooldown** (only when *not* holding). Within the window ⇒ SKIP.
 *  4. **Score** (always computed). Disqualifiers always override the score — a
 *     high score can never turn a hard disqualifier into a buy.
 *  5. **Decide.** Any disqualifier ⇒ SKIP. Otherwise:
 *     - *Holding:* trade cooldown ⇒ WATCH; else take-profit / stop-loss ⇒
 *       `PAPER_SELL_CANDIDATE`; else WATCH.
 *     - *Not holding:* score ≥ buy threshold ⇒ `PAPER_BUY_CANDIDATE`, unless max
 *       open positions / concentration cap / trade cooldown caps it to WATCH;
 *       else score ≥ watch threshold ⇒ WATCH; else SKIP.
 */

import type { RiskDecision } from "@soulmaker/risk";
import { makeIdGen, type IdGen } from "./ids.js";
import { REASON_IDS, reason } from "./reasons.js";
import { scoreCandidate } from "./score.js";
import { STRATEGY_DISCLAIMER, STRATEGY_NOTES } from "./report.js";
import type {
  StrategyCandidate,
  StrategyConfig,
  StrategyDecision,
  StrategyPortfolio,
  StrategyReason,
  StrategyReport,
} from "./types.js";

export interface EvaluateStrategyInput {
  candidate: StrategyCandidate;
  config: StrategyConfig;
  /** Current simulated portfolio (for position-awareness rules). Optional. */
  portfolio?: StrategyPortfolio;
  /** Injectable clock (ISO string) for deterministic output/tests. */
  now?: () => string;
  /** Injectable id generator for the report id. Defaults to a seeded counter. */
  nextId?: IdGen;
}

/** Pure default clock — the engine never reads real wall-clock time itself. */
const DEFAULT_NOW = () => "1970-01-01T00:00:00.000Z";

/**
 * True when `since` is within the past `minutes` of `now`. Pure: parses the two
 * injected ISO strings. A non-positive window, an absent timestamp, or an
 * unparsable string means "not in cooldown" (the cooldown simply does not apply).
 * A **future** `since` (negative elapsed — clock skew, replayed or hand-edited
 * fixtures) is also "not in cooldown": the window is the *past*, so a stamp that
 * has not happened yet cannot suppress a decision.
 */
function withinCooldown(
  now: string,
  since: string | undefined,
  minutes: number | undefined,
): boolean {
  if (since === undefined || minutes === undefined || minutes <= 0) return false;
  const nowMs = Date.parse(now);
  const sinceMs = Date.parse(since);
  if (Number.isNaN(nowMs) || Number.isNaN(sinceMs)) return false;
  const elapsedMinutes = (nowMs - sinceMs) / 60_000;
  return elapsedMinutes >= 0 && elapsedMinutes < minutes;
}

/** Evaluate a single candidate. Deterministic given an injected clock + id gen. */
export function evaluateStrategy(input: EvaluateStrategyInput): StrategyReport {
  const { candidate, config, portfolio } = input;
  const now = (input.now ?? DEFAULT_NOW)();
  const nextId = input.nextId ?? makeIdGen("strategy");

  const reasons: StrategyReason[] = [];
  const disqualifiers: StrategyReason[] = [];

  const riskReport = candidate.riskReport;
  const riskDecision: RiskDecision | "MISSING" = riskReport?.decision ?? "MISSING";
  const riskScore: number | null = riskReport ? riskReport.score : null;

  const holding =
    candidate.previousPaperTrade?.holdingPosition === true ||
    (portfolio?.heldMints?.includes(candidate.mint) ?? false);

  // 1) Risk gate (hard disqualifiers; applies to both entry and exit paths).
  applyRiskGate();

  // 2) Entry-only gates (a held position is managed by the exit rules instead).
  if (!holding) {
    applyMetricGates();
    applyLossCooldown();
  }

  // 3) Deterministic score (always computed; disqualifiers still override it).
  const score = scoreCandidate({
    riskScore,
    metrics: candidate.metrics,
    minLiquidityUsd: config.minLiquidityUsd,
    minVolumeUsd: config.minVolumeUsd,
  });

  // 4) Decide. A disqualifier always wins.
  let decision: StrategyDecision;
  if (disqualifiers.length > 0) {
    decision = "SKIP";
  } else if (holding) {
    decision = decideExit();
  } else {
    decision = decideEntry();
  }

  const report: StrategyReport = {
    id: nextId(),
    mint: candidate.mint,
    decision,
    score,
    reasons,
    disqualifiers,
    riskDecision,
    riskScore,
    createdAt: now,
    disclaimer: STRATEGY_DISCLAIMER,
    paperOnly: true,
    notFinancialAdvice: true,
    notes: [...STRATEGY_NOTES],
  };
  if (candidate.symbol !== undefined) report.symbol = candidate.symbol;
  if (candidate.source !== undefined) report.source = candidate.source;
  return report;

  // --- gate helpers (close over reasons/disqualifiers/config/candidate) -----

  function applyRiskGate(): void {
    if (!riskReport) {
      disqualifiers.push(
        reason(
          REASON_IDS.RISK_REPORT_MISSING,
          "no advisory risk report provided; treated as REJECT (fail-safe)",
          { riskDecision: "MISSING" },
        ),
      );
      return;
    }

    switch (riskReport.decision) {
      case "REJECT":
        disqualifiers.push(
          reason(
            REASON_IDS.RISK_DECISION_REJECT,
            "advisory risk decision is REJECT; always SKIP",
            { riskDecision: "REJECT" },
          ),
        );
        break;
      case "CAUTION":
        if (config.allowCaution === true) {
          reasons.push(
            reason(
              REASON_IDS.RISK_CAUTION_ALLOWED,
              "advisory risk decision is CAUTION; allowed to continue by config (allowCaution=true)",
              { riskDecision: "CAUTION" },
            ),
          );
        } else {
          disqualifiers.push(
            reason(
              REASON_IDS.RISK_DECISION_CAUTION,
              "advisory risk decision is CAUTION; SKIP by default (set allowCaution to continue)",
              { riskDecision: "CAUTION" },
            ),
          );
        }
        break;
      case "PASS_FOR_PAPER_EVALUATION":
        reasons.push(
          reason(
            REASON_IDS.RISK_GATE_PASS,
            "advisory risk decision is PASS_FOR_PAPER_EVALUATION (eligible for paper evaluation only)",
            { riskDecision: "PASS_FOR_PAPER_EVALUATION" },
          ),
        );
        break;
      default:
        // A present-but-unrecognized decision (malformed/injected input) must
        // fail safe to SKIP, never fall through to scoring as if it had passed.
        disqualifiers.push(
          reason(
            REASON_IDS.RISK_DECISION_UNKNOWN,
            `advisory risk decision is unrecognized; treated as REJECT (fail-safe)`,
            { riskDecision: String(riskReport.decision) },
          ),
        );
        break;
    }

    // Independent rule: validate the advisory score, then cap on it. An
    // out-of-range or non-finite score (injected/untrusted input) is a
    // disqualifier (fail-safe) — it must never silently skip the cap because
    // `NaN > max` is false. Otherwise a score above the cap disqualifies even a
    // CAUTION-allowed or PASS candidate; it can never be bypassed by a high
    // strategy score.
    const riskScore = riskReport.score;
    if (!Number.isFinite(riskScore) || riskScore < 0 || riskScore > 100) {
      disqualifiers.push(
        reason(
          REASON_IDS.RISK_SCORE_INVALID,
          `advisory risk score ${riskScore} is not a finite number in [0, 100]; treated as invalid (fail-safe)`,
          { riskScore },
        ),
      );
    } else if (riskScore > config.maxRiskScore) {
      disqualifiers.push(
        reason(
          REASON_IDS.RISK_SCORE_ABOVE_MAX,
          `advisory risk score ${riskScore} exceeds maxRiskScore ${config.maxRiskScore}`,
          { riskScore, maxRiskScore: config.maxRiskScore },
        ),
      );
    }
  }

  function applyMetricGates(): void {
    const m = candidate.metrics;

    if (config.minLiquidityUsd !== undefined) {
      if (typeof m?.liquidityUsd !== "number") {
        disqualifiers.push(
          reason(
            REASON_IDS.LIQUIDITY_METRIC_MISSING,
            "minLiquidityUsd is configured but no liquidity metric was provided",
            { minLiquidityUsd: config.minLiquidityUsd },
          ),
        );
      } else if (m.liquidityUsd < config.minLiquidityUsd) {
        disqualifiers.push(
          reason(
            REASON_IDS.LIQUIDITY_BELOW_MIN,
            `liquidity ${m.liquidityUsd} is below minLiquidityUsd ${config.minLiquidityUsd}`,
            { liquidityUsd: m.liquidityUsd, minLiquidityUsd: config.minLiquidityUsd },
          ),
        );
      } else {
        reasons.push(
          reason(REASON_IDS.LIQUIDITY_OK, `liquidity ${m.liquidityUsd} meets the minimum`, {
            liquidityUsd: m.liquidityUsd,
          }),
        );
      }
    }

    if (config.minVolumeUsd !== undefined) {
      if (typeof m?.volumeUsd !== "number") {
        disqualifiers.push(
          reason(
            REASON_IDS.VOLUME_METRIC_MISSING,
            "minVolumeUsd is configured but no volume metric was provided",
            { minVolumeUsd: config.minVolumeUsd },
          ),
        );
      } else if (m.volumeUsd < config.minVolumeUsd) {
        disqualifiers.push(
          reason(
            REASON_IDS.VOLUME_BELOW_MIN,
            `volume ${m.volumeUsd} is below minVolumeUsd ${config.minVolumeUsd}`,
            { volumeUsd: m.volumeUsd, minVolumeUsd: config.minVolumeUsd },
          ),
        );
      } else {
        reasons.push(
          reason(REASON_IDS.VOLUME_OK, `volume ${m.volumeUsd} meets the minimum`, {
            volumeUsd: m.volumeUsd,
          }),
        );
      }
    }

    if (config.maxPriceChangePct !== undefined) {
      if (typeof m?.priceChangePct !== "number") {
        disqualifiers.push(
          reason(
            REASON_IDS.PRICE_CHANGE_METRIC_MISSING,
            "maxPriceChangePct is configured but no priceChangePct metric was provided",
            { maxPriceChangePct: config.maxPriceChangePct },
          ),
        );
      } else if (Math.abs(m.priceChangePct) > config.maxPriceChangePct) {
        disqualifiers.push(
          reason(
            REASON_IDS.PRICE_CHANGE_EXCESSIVE,
            `absolute price change ${Math.abs(m.priceChangePct)}% exceeds maxPriceChangePct ${config.maxPriceChangePct}%`,
            {
              priceChangePct: m.priceChangePct,
              maxPriceChangePct: config.maxPriceChangePct,
            },
          ),
        );
      } else {
        reasons.push(
          reason(
            REASON_IDS.PRICE_CHANGE_OK,
            `price change ${m.priceChangePct}% is within the configured limit`,
            { priceChangePct: m.priceChangePct },
          ),
        );
      }
    }
  }

  function applyLossCooldown(): void {
    const lastLossAt = candidate.previousPaperTrade?.lastLossAt;
    if (withinCooldown(now, lastLossAt, config.cooldownAfterLossMinutes)) {
      disqualifiers.push(
        reason(
          REASON_IDS.COOLDOWN_AFTER_LOSS,
          `within the post-loss cooldown of ${config.cooldownAfterLossMinutes} minute(s); SKIP`,
          { lastLossAt, cooldownAfterLossMinutes: config.cooldownAfterLossMinutes },
        ),
      );
    }
  }

  function decideEntry(): StrategyDecision {
    if (score >= config.minScoreForPaperBuy) {
      reasons.push(
        reason(
          REASON_IDS.SCORE_MEETS_BUY_THRESHOLD,
          `strategy score ${score} ≥ paper-buy threshold ${config.minScoreForPaperBuy}`,
          { score, minScoreForPaperBuy: config.minScoreForPaperBuy },
        ),
      );

      if (
        config.maxOpenPositions !== undefined &&
        portfolio !== undefined &&
        portfolio.openPositionCount >= config.maxOpenPositions
      ) {
        reasons.push(
          reason(
            REASON_IDS.MAX_OPEN_POSITIONS_REACHED,
            `open positions ${portfolio.openPositionCount} ≥ maxOpenPositions ${config.maxOpenPositions}; not opening a new paper buy`,
            {
              openPositionCount: portfolio.openPositionCount,
              maxOpenPositions: config.maxOpenPositions,
            },
          ),
        );
        return "WATCH";
      }

      if (
        config.maxPositionConcentrationPct !== undefined &&
        portfolio?.topPositionConcentrationPct !== undefined &&
        portfolio.topPositionConcentrationPct >= config.maxPositionConcentrationPct
      ) {
        reasons.push(
          reason(
            REASON_IDS.CONCENTRATION_CAP_REACHED,
            `portfolio concentration ${portfolio.topPositionConcentrationPct}% ≥ cap ${config.maxPositionConcentrationPct}%; not opening a new paper buy`,
            {
              topPositionConcentrationPct: portfolio.topPositionConcentrationPct,
              maxPositionConcentrationPct: config.maxPositionConcentrationPct,
            },
          ),
        );
        return "WATCH";
      }

      if (
        withinCooldown(
          now,
          candidate.previousPaperTrade?.lastTradeAt,
          config.cooldownAfterTradeMinutes,
        )
      ) {
        reasons.push(
          reason(
            REASON_IDS.COOLDOWN_AFTER_TRADE,
            `within the post-trade cooldown of ${config.cooldownAfterTradeMinutes} minute(s); watching instead of opening a new paper buy`,
            {
              lastTradeAt: candidate.previousPaperTrade?.lastTradeAt,
              cooldownAfterTradeMinutes: config.cooldownAfterTradeMinutes,
            },
          ),
        );
        return "WATCH";
      }

      return "PAPER_BUY_CANDIDATE";
    }

    if (score >= config.minScoreForWatch) {
      reasons.push(
        reason(
          REASON_IDS.SCORE_MEETS_WATCH_THRESHOLD,
          `strategy score ${score} ≥ watch threshold ${config.minScoreForWatch} (below buy threshold ${config.minScoreForPaperBuy})`,
          {
            score,
            minScoreForWatch: config.minScoreForWatch,
            minScoreForPaperBuy: config.minScoreForPaperBuy,
          },
        ),
      );
      return "WATCH";
    }

    reasons.push(
      reason(
        REASON_IDS.SCORE_BELOW_WATCH_THRESHOLD,
        `strategy score ${score} is below the watch threshold ${config.minScoreForWatch}`,
        { score, minScoreForWatch: config.minScoreForWatch },
      ),
    );
    return "SKIP";
  }

  function decideExit(): StrategyDecision {
    reasons.push(
      reason(
        REASON_IDS.HOLDING_POSITION,
        "a simulated position in this mint is currently open; evaluating exit rules only",
      ),
    );

    if (
      withinCooldown(
        now,
        candidate.previousPaperTrade?.lastTradeAt,
        config.cooldownAfterTradeMinutes,
      )
    ) {
      reasons.push(
        reason(
          REASON_IDS.COOLDOWN_AFTER_TRADE,
          `within the post-trade cooldown of ${config.cooldownAfterTradeMinutes} minute(s); watching the held position instead of acting`,
          {
            lastTradeAt: candidate.previousPaperTrade?.lastTradeAt,
            cooldownAfterTradeMinutes: config.cooldownAfterTradeMinutes,
          },
        ),
      );
      return "WATCH";
    }

    const pct = candidate.metrics?.priceChangePct;
    if (typeof pct !== "number") {
      reasons.push(
        reason(
          REASON_IDS.HOLDING_NO_PRICE_METRIC,
          "no priceChangePct metric for the held position; watching (no exit signal)",
        ),
      );
      return "WATCH";
    }

    if (config.takeProfitPct !== undefined && pct >= config.takeProfitPct) {
      reasons.push(
        reason(
          REASON_IDS.SELL_TAKE_PROFIT,
          `price change ${pct}% ≥ takeProfitPct ${config.takeProfitPct}%; simulated sell candidate`,
          { priceChangePct: pct, takeProfitPct: config.takeProfitPct },
        ),
      );
      return "PAPER_SELL_CANDIDATE";
    }

    if (config.stopLossPct !== undefined && pct <= -config.stopLossPct) {
      reasons.push(
        reason(
          REASON_IDS.SELL_STOP_LOSS,
          `price change ${pct}% ≤ -stopLossPct ${config.stopLossPct}%; simulated sell candidate`,
          { priceChangePct: pct, stopLossPct: config.stopLossPct },
        ),
      );
      return "PAPER_SELL_CANDIDATE";
    }

    reasons.push(
      reason(
        REASON_IDS.HOLDING_NO_EXIT_SIGNAL,
        `price change ${pct}% did not cross take-profit/stop-loss; watching the held position`,
        { priceChangePct: pct },
      ),
    );
    return "WATCH";
  }
}
