/**
 * Adapter from a `@soulmaker/paper` `PaperState` to the strategy engine's
 * lightweight {@link StrategyPortfolio}. Pure: reads a (simulated) state, never
 * mutates it, and computes only the portfolio-level facts the position-awareness
 * rules need (open count, held mints, top concentration). It imports only the
 * `PaperState` **type** from `@soulmaker/paper` — no runtime coupling.
 */

import type { PaperState } from "@soulmaker/paper";
import type { StrategyPortfolio } from "./types.js";

/** Derive the strategy portfolio view from a simulated paper state. */
export function portfolioFromPaperState(state: PaperState): StrategyPortfolio {
  const open = Object.values(state.positions).filter(
    (p) => p !== undefined && p.quantity > 0,
  );

  const heldMints = open.map((p) => p.mint).sort();
  const totalCostBasisUsd = open.reduce((sum, p) => sum + p.costBasisUsd, 0);

  // Per-mint simulated cost basis, for position-aware partial-exit sizing. Only
  // finite, positive bases are recorded (a degenerate/zero basis cannot size one).
  const positionSizeUsdByMint: Record<string, number> = {};
  for (const p of open) {
    if (Number.isFinite(p.costBasisUsd) && p.costBasisUsd > 0) {
      positionSizeUsdByMint[p.mint] = p.costBasisUsd;
    }
  }

  const portfolio: StrategyPortfolio = {
    openPositionCount: open.length,
    heldMints,
  };

  if (Object.keys(positionSizeUsdByMint).length > 0) {
    portfolio.positionSizeUsdByMint = positionSizeUsdByMint;
  }

  if (totalCostBasisUsd > 0) {
    let maxBasis = 0;
    for (const p of open) if (p.costBasisUsd > maxBasis) maxBasis = p.costBasisUsd;
    portfolio.topPositionConcentrationPct = (maxBasis / totalCostBasisUsd) * 100;
  }

  return portfolio;
}
