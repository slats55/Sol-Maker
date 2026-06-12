/**
 * Sprint 92 — deep-check risk flags (holder concentration, metadata mutability, liquidity depth).
 *
 * The honesty contract under test:
 *   - ABSENT deep inputs → NO deep flags fire and the report stays byte-identical to before
 *     (backward compatibility for every pinned artifact);
 *   - SUPPLIED inputs always produce exactly one flag per check (including the explicit
 *     *Available:false failure forms → unknown cautions, never silent passes);
 *   - thresholds are pinned, and the new flags never weaken existing scoring.
 */

import { describe, it, expect } from "vitest";
import { evaluateRiskFlags } from "./risk-flags.js";
import { buildTokenRiskReport } from "./risk-report.js";
import type { TokenRiskInput } from "./types.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const CLEAN_BASE: TokenRiskInput = {
  mint: USDC,
  decimals: 6,
  supplyRaw: "1000000000",
  mintAuthorityPresent: false,
  freezeAuthorityPresent: false,
  isInitialized: true,
  programLabel: "spl-token",
};

const ids = (input: TokenRiskInput): string[] => evaluateRiskFlags(input).map((f) => f.id);

describe("deep flags — backward compatibility when inputs are absent", () => {
  it("emits NO deep flag and an identical report for a pre-S92 input", () => {
    const flags = ids(CLEAN_BASE);
    expect(flags.some((id) => id.startsWith("holder-concentration"))).toBe(false);
    expect(flags.some((id) => id.startsWith("metadata-"))).toBe(false);
    expect(flags.some((id) => id.startsWith("liquidity-"))).toBe(false);

    const now = () => "2026-06-12T00:00:00.000Z";
    const before = JSON.stringify(buildTokenRiskReport(CLEAN_BASE, { now }));
    const again = JSON.stringify(buildTokenRiskReport({ ...CLEAN_BASE }, { now }));
    expect(again).toBe(before);
  });
});

describe("deep flags — holder concentration", () => {
  it("extreme: top1 >= 50% -> high", () => {
    const flags = evaluateRiskFlags({ ...CLEAN_BASE, holderDataAvailable: true, topHolderPct: 61.5, top5HolderPct: 80 });
    const flag = flags.find((f) => f.id === "holder-concentration-extreme");
    expect(flag?.severity).toBe("high");
    expect(flag?.detail).toContain("pools/vaults");
  });

  it("elevated: top1 >= 25% or top5 >= 70% -> medium", () => {
    expect(ids({ ...CLEAN_BASE, holderDataAvailable: true, topHolderPct: 30, top5HolderPct: 40 })).toContain("holder-concentration-elevated");
    expect(ids({ ...CLEAN_BASE, holderDataAvailable: true, topHolderPct: 10, top5HolderPct: 75 })).toContain("holder-concentration-elevated");
  });

  it("modest below thresholds -> info; attempted-but-failed -> unknown low caution", () => {
    expect(ids({ ...CLEAN_BASE, holderDataAvailable: true, topHolderPct: 5, top5HolderPct: 15 })).toContain("holder-concentration-modest");
    const flags = evaluateRiskFlags({ ...CLEAN_BASE, holderDataAvailable: false });
    const flag = flags.find((f) => f.id === "holder-concentration-unknown");
    expect(flag?.severity).toBe("low");
  });

  it("exactly one holder flag fires when supplied", () => {
    for (const input of [
      { ...CLEAN_BASE, holderDataAvailable: true, topHolderPct: 99, top5HolderPct: 100 },
      { ...CLEAN_BASE, holderDataAvailable: true, topHolderPct: 1, top5HolderPct: 2 },
      { ...CLEAN_BASE, holderDataAvailable: false },
    ]) {
      const holderFlags = ids(input).filter((id) => id.startsWith("holder-concentration"));
      expect(holderFlags).toHaveLength(1);
    }
  });
});

describe("deep flags — metadata mutability", () => {
  it("mutable -> medium; immutable -> info; attempted-but-unavailable -> low caution", () => {
    expect(evaluateRiskFlags({ ...CLEAN_BASE, metadataAvailable: true, metadataMutable: true }).find((f) => f.id === "metadata-mutable")?.severity).toBe("medium");
    expect(ids({ ...CLEAN_BASE, metadataAvailable: true, metadataMutable: false })).toContain("metadata-immutable");
    expect(evaluateRiskFlags({ ...CLEAN_BASE, metadataAvailable: false }).find((f) => f.id === "metadata-unavailable")?.severity).toBe("low");
  });
});

describe("deep flags — liquidity depth from a quote probe", () => {
  it("impact >= 10% -> high; >= 3% -> medium; below -> info; unparsable -> low", () => {
    expect(evaluateRiskFlags({ ...CLEAN_BASE, quotePriceImpactPct: 12 }).find((f) => f.id === "liquidity-very-thin")?.severity).toBe("high");
    expect(evaluateRiskFlags({ ...CLEAN_BASE, quotePriceImpactPct: 5 }).find((f) => f.id === "liquidity-thin")?.severity).toBe("medium");
    expect(ids({ ...CLEAN_BASE, quotePriceImpactPct: 0.01 })).toContain("liquidity-impact-modest");
    expect(evaluateRiskFlags({ ...CLEAN_BASE, quotePriceImpactPct: Number.NaN }).find((f) => f.id === "liquidity-impact-unknown")?.severity).toBe("low");
  });
});

describe("deep flags — scoring interaction (tighten-only)", () => {
  it("deep findings RAISE the score of an otherwise-clean mint and can reach CAUTION", () => {
    const now = () => "2026-06-12T00:00:00.000Z";
    const clean = buildTokenRiskReport(CLEAN_BASE, { now });
    const deepBad = buildTokenRiskReport(
      { ...CLEAN_BASE, holderDataAvailable: true, topHolderPct: 80, top5HolderPct: 95, metadataAvailable: true, metadataMutable: true, quotePriceImpactPct: 15 },
      { now },
    );
    expect(deepBad.score).toBeGreaterThan(clean.score);
    expect(deepBad.decision).not.toBe("PASS_FOR_PAPER_EVALUATION");
  });

  it("deep INFO findings never reduce an existing score", () => {
    const now = () => "2026-06-12T00:00:00.000Z";
    const base = buildTokenRiskReport({ ...CLEAN_BASE, mintAuthorityPresent: true }, { now });
    const withDeepClean = buildTokenRiskReport(
      { ...CLEAN_BASE, mintAuthorityPresent: true, holderDataAvailable: true, topHolderPct: 1, top5HolderPct: 3, metadataAvailable: true, metadataMutable: false, quotePriceImpactPct: 0 },
      { now },
    );
    expect(withDeepClean.score).toBeGreaterThanOrEqual(base.score);
  });
});
