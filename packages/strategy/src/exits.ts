/**
 * Pure, deterministic **simulated** exit rules for a held paper position
 * (Phase 5 / Sprint 7).
 *
 * `decideSimulatedExit` turns the injected, read-only metrics of a held position
 * plus the strategy config into a structured {@link SimulatedExitPlan} (full /
 * partial / hold) and the supporting reasons. It is **pure**: no clock, no
 * `Date.now`, no `Math.random`, no network, no filesystem, and it never mutates
 * its inputs. Everything it describes is simulated paper bookkeeping — never a
 * real order, fill, or transaction.
 *
 * ## Rule order (risk-first, deterministic)
 *
 *  1. **Stop loss**      — price change ≤ −`stopLossPct`            ⇒ FULL exit.
 *  2. **Trailing stop**  — drawdown from a positive peak ≥ `trailingStopPct` ⇒ FULL.
 *  3. **Take profit**    — price change ≥ `takeProfitPct`          ⇒ FULL exit.
 *  4. **Partial take profit** — price change ≥ `takeProfitPartialPct`, with a
 *     sizable injected position ⇒ PARTIAL exit of `partialExitFraction`.
 *  5. Otherwise                                                    ⇒ HOLD.
 *
 * Earlier rules win, so a position that is both past its stop and its trailing
 * stop is labelled `STOP_LOSS`. A `SKIP`/reject is never produced here: a held
 * candidate that fails the risk gate is disqualified upstream before exits run.
 */

import { REASON_IDS, reason } from "./reasons.js";
import type {
  SimulatedExitPlan,
  StrategyConfig,
  StrategyReason,
} from "./types.js";

/** Default fraction to scale out on a partial take-profit when none is configured. */
export const DEFAULT_PARTIAL_EXIT_FRACTION = 0.5;

/** Injected, read-only inputs for the simulated exit decision. Pure data. */
export interface SimulatedExitInput {
  /** Injected price change since entry, percent. Required (the caller ensures it). */
  priceChangePct: number;
  /** Injected peak price change since entry, percent. Optional. */
  peakPriceChangePct?: number;
  /** Injected drawdown from the peak, percent (≥ 0). Optional; derived when absent. */
  drawdownFromPeakPct?: number;
  /** Simulated position size (USD) used only to size a partial exit. Optional. */
  positionSizeUsd?: number;
  /** Strategy thresholds (`stopLossPct`, `takeProfitPct`, `trailingStopPct`, …). */
  config: StrategyConfig;
}

/** The exit plan plus the reasons the engine records on the report. */
export interface SimulatedExitDecision {
  /** Structured, JSON-serializable plan stored on the report as `report.exit`. */
  plan: SimulatedExitPlan;
  /** Supporting reasons; the engine pushes these onto `report.reasons`. */
  reasons: StrategyReason[];
}

/** A finite number guard (rejects NaN/Infinity and non-numbers). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A positive, enabled threshold: a finite number > 0 (≤ 0 means "disabled"). */
function enabledThreshold(value: number | undefined): number | undefined {
  return isFiniteNumber(value) && value > 0 ? value : undefined;
}

/** Round to cents so partial sizes are stable, comparable bookkeeping values. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Resolve the configured partial-exit fraction, clamped to the open interval (0, 1). */
function resolvePartialFraction(config: StrategyConfig): number {
  const configured = config.partialExitFraction;
  if (isFiniteNumber(configured) && configured > 0 && configured < 1) return configured;
  return DEFAULT_PARTIAL_EXIT_FRACTION;
}

/**
 * Derive the drawdown-from-peak (percent, ≥ 0) and whether the trailing stop is
 * armed. The stop arms only once the position reached a positive peak; below that
 * the stop-loss rule governs the downside. An explicit `drawdownFromPeakPct` is
 * preferred; otherwise it is derived from `peakPriceChangePct - priceChangePct`.
 */
function resolveDrawdown(
  input: SimulatedExitInput,
): { armed: false } | { armed: true; drawdownPct: number } {
  const peak = input.peakPriceChangePct;
  // The trail needs a positive peak to confirm the position was in profit.
  if (!isFiniteNumber(peak) || peak <= 0) return { armed: false };

  if (isFiniteNumber(input.drawdownFromPeakPct) && input.drawdownFromPeakPct >= 0) {
    return { armed: true, drawdownPct: input.drawdownFromPeakPct };
  }
  const derived = peak - input.priceChangePct;
  // A non-positive derived drawdown means price is at/above the peak — no pullback.
  return { armed: true, drawdownPct: derived > 0 ? derived : 0 };
}

const fullPlan = (trigger: SimulatedExitPlan["trigger"]): SimulatedExitPlan => ({
  action: "FULL_EXIT",
  trigger,
  fraction: 1,
  paperOnly: true,
  simulated: true,
});

const holdPlan = (): SimulatedExitPlan => ({
  action: "HOLD",
  fraction: 0,
  paperOnly: true,
  simulated: true,
});

/**
 * Decide the simulated exit for a held position. Deterministic and pure: the same
 * inputs always yield the same plan and reasons, and the inputs are never mutated.
 */
export function decideSimulatedExit(input: SimulatedExitInput): SimulatedExitDecision {
  const { config, priceChangePct } = input;
  const reasons: StrategyReason[] = [];

  // 1) Stop loss (downside protection) — highest priority.
  const stopLossPct = enabledThreshold(config.stopLossPct);
  if (stopLossPct !== undefined && priceChangePct <= -stopLossPct) {
    reasons.push(
      reason(
        REASON_IDS.SELL_STOP_LOSS,
        `price change ${priceChangePct}% ≤ -stopLossPct ${stopLossPct}%; simulated full exit`,
        { priceChangePct, stopLossPct },
      ),
    );
    return { plan: fullPlan("STOP_LOSS"), reasons };
  }

  // 2) Trailing stop — gave back gains from a positive peak.
  const trailingStopPct = enabledThreshold(config.trailingStopPct);
  if (trailingStopPct !== undefined) {
    const dd = resolveDrawdown(input);
    if (dd.armed && dd.drawdownPct >= trailingStopPct) {
      reasons.push(
        reason(
          REASON_IDS.SELL_TRAILING_STOP,
          `drawdown ${round2(dd.drawdownPct)}% from peak ${input.peakPriceChangePct}% ` +
            `≥ trailingStopPct ${trailingStopPct}%; simulated full exit`,
          {
            priceChangePct,
            peakPriceChangePct: input.peakPriceChangePct,
            drawdownFromPeakPct: round2(dd.drawdownPct),
            trailingStopPct,
          },
        ),
      );
      return { plan: fullPlan("TRAILING_STOP"), reasons };
    }
  }

  // 3) Full take profit.
  const takeProfitPct = enabledThreshold(config.takeProfitPct);
  if (takeProfitPct !== undefined && priceChangePct >= takeProfitPct) {
    reasons.push(
      reason(
        REASON_IDS.SELL_TAKE_PROFIT,
        `price change ${priceChangePct}% ≥ takeProfitPct ${takeProfitPct}%; simulated full exit`,
        { priceChangePct, takeProfitPct },
      ),
    );
    return { plan: fullPlan("TAKE_PROFIT"), reasons };
  }

  // 4) Partial take profit (scaled exit) — needs a sizable injected position.
  const takeProfitPartialPct = enabledThreshold(config.takeProfitPartialPct);
  if (takeProfitPartialPct !== undefined && priceChangePct >= takeProfitPartialPct) {
    const fraction = resolvePartialFraction(config);
    const positionSizeUsd = input.positionSizeUsd;
    if (isFiniteNumber(positionSizeUsd) && positionSizeUsd > 0) {
      const sizeUsd = round2(fraction * positionSizeUsd);
      if (sizeUsd > 0) {
        reasons.push(
          reason(
            REASON_IDS.SELL_PARTIAL_TAKE_PROFIT,
            `price change ${priceChangePct}% ≥ takeProfitPartialPct ${takeProfitPartialPct}%; ` +
              `simulated partial exit of ${fraction} (${sizeUsd} USD of ${positionSizeUsd} USD)`,
            { priceChangePct, takeProfitPartialPct, fraction, positionSizeUsd, sizeUsd },
          ),
        );
        return {
          plan: {
            action: "PARTIAL_EXIT",
            trigger: "PARTIAL_TAKE_PROFIT",
            fraction,
            sizeUsd,
            paperOnly: true,
            simulated: true,
          },
          reasons,
        };
      }
    }
    // Threshold met but the partial cannot be sized → hold (fail-safe, deterministic).
    reasons.push(
      reason(
        REASON_IDS.PARTIAL_EXIT_UNSIZED,
        `partial take-profit threshold ${takeProfitPartialPct}% met but no positive injected ` +
          "position size to scale the simulated exit; holding",
        { priceChangePct, takeProfitPartialPct },
      ),
    );
    return { plan: holdPlan(), reasons };
  }

  // 5) No exit signal crossed — hold the simulated position.
  reasons.push(
    reason(
      REASON_IDS.HOLDING_NO_EXIT_SIGNAL,
      `price change ${priceChangePct}% did not cross any simulated exit threshold; holding`,
      { priceChangePct },
    ),
  );
  return { plan: holdPlan(), reasons };
}
