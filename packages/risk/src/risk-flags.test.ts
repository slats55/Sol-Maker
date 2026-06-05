import { describe, it, expect } from "vitest";
import { evaluateRiskFlags } from "./risk-flags.js";
import type { TokenRiskInput } from "./types.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** A clean, fully-renounced standard SPL mint with a healthy supply. */
const CLEAN: TokenRiskInput = {
  mint: MINT,
  decimals: 6,
  supplyRaw: "1000000000000",
  uiSupply: 1_000_000,
  mintAuthorityPresent: false,
  freezeAuthorityPresent: false,
  isInitialized: true,
  programLabel: "spl-token",
};

function ids(input: TokenRiskInput): string[] {
  return evaluateRiskFlags(input).map((f) => f.id);
}

function flag(input: TokenRiskInput, id: string) {
  return evaluateRiskFlags(input).find((f) => f.id === id);
}

describe("evaluateRiskFlags — critical flags", () => {
  it("denylisted mint produces a critical denylisted-mint flag", () => {
    const f = flag({ ...CLEAN, denylist: [MINT] }, "denylisted-mint");
    expect(f?.severity).toBe("critical");
  });

  it("uninitialized mint produces a critical mint-not-initialized flag", () => {
    const f = flag({ ...CLEAN, isInitialized: false }, "mint-not-initialized");
    expect(f?.severity).toBe("critical");
  });

  it("freeze authority present produces a critical freeze-authority-present flag", () => {
    const f = flag(
      { ...CLEAN, freezeAuthorityPresent: true },
      "freeze-authority-present",
    );
    expect(f?.severity).toBe("critical");
  });
});

describe("evaluateRiskFlags — high flags", () => {
  it("mint authority present produces a high mint-authority-present flag", () => {
    const f = flag({ ...CLEAN, mintAuthorityPresent: true }, "mint-authority-present");
    expect(f?.severity).toBe("high");
  });

  it("unknown token program produces a high unknown-token-program flag", () => {
    const f = flag({ ...CLEAN, programLabel: "weird-program" }, "unknown-token-program");
    expect(f?.severity).toBe("high");
  });

  it("suspicious (out-of-range) decimals produce a high suspicious-decimals flag", () => {
    const f = flag({ ...CLEAN, decimals: 42 }, "suspicious-decimals");
    expect(f?.severity).toBe("high");
  });
});

describe("evaluateRiskFlags — medium flags", () => {
  it("zero supply produces a medium zero-supply caution flag", () => {
    const f = flag({ ...CLEAN, supplyRaw: "0", uiSupply: 0 }, "zero-supply");
    expect(f?.severity).toBe("medium");
  });

  it("missing/unparsable supply produces a medium supply-unparsable flag", () => {
    const f = flag(
      { ...CLEAN, supplyRaw: undefined, uiSupply: undefined },
      "supply-unparsable",
    );
    expect(f?.severity).toBe("medium");
    const garbage = flag({ ...CLEAN, supplyRaw: "not-a-number" }, "supply-unparsable");
    expect(garbage?.severity).toBe("medium");
  });

  it("blank, non-base-10, and negative supply are unparsable — not zero/known", () => {
    // BigInt("") === 0n and BigInt("0x10") parse, so these must be guarded.
    for (const supplyRaw of ["", "   ", "0x10", "0b101", "+5", "-5", "12.5"]) {
      const got = ids({ ...CLEAN, supplyRaw, uiSupply: undefined });
      expect(got).toContain("supply-unparsable");
      expect(got).not.toContain("zero-supply");
    }
    // A negative UI-supply fallback (no raw) is unparsable, not a healthy supply.
    const neg = ids({ ...CLEAN, supplyRaw: undefined, uiSupply: -5 });
    expect(neg).toContain("supply-unparsable");
    expect(neg).not.toContain("zero-supply");
  });

  it("previously-traded mint produces a medium previously-traded-mint flag", () => {
    const f = flag(
      { ...CLEAN, previouslyTradedMints: [MINT] },
      "previously-traded-mint",
    );
    expect(f?.severity).toBe("medium");
  });
});

describe("evaluateRiskFlags — positive / informational flags", () => {
  it("a clean mint emits only positive informational flags", () => {
    const flags = evaluateRiskFlags(CLEAN);
    expect(flags.every((f) => f.severity === "info")).toBe(true);
    expect(ids(CLEAN)).toEqual([
      "freeze-authority-renounced",
      "mint-authority-renounced",
      "standard-spl-token-program",
    ]);
  });

  it("allowlisted mint emits an info allowlisted-mint flag", () => {
    const f = flag({ ...CLEAN, allowlist: [MINT] }, "allowlisted-mint");
    expect(f?.severity).toBe("info");
  });

  it("token-2022 program is an informational caution, not unknown", () => {
    const f = flag({ ...CLEAN, programLabel: "spl-token-2022" }, "token-2022-program");
    expect(f?.severity).toBe("info");
    expect(ids({ ...CLEAN, programLabel: "spl-token-2022" })).not.toContain(
      "unknown-token-program",
    );
  });
});

describe("evaluateRiskFlags — unknown facts are cautions, not assumed safe", () => {
  it("undefined authorities/initialization produce low-severity unknown flags", () => {
    const partial: TokenRiskInput = { mint: MINT, programLabel: "spl-token" };
    const got = ids(partial);
    expect(got).toContain("freeze-authority-unknown");
    expect(got).toContain("mint-authority-unknown");
    expect(got).toContain("initialization-unknown");
  });
});

describe("evaluateRiskFlags — determinism", () => {
  it("produces byte-identical flags for the same input", () => {
    expect(JSON.stringify(evaluateRiskFlags(CLEAN))).toBe(
      JSON.stringify(evaluateRiskFlags(CLEAN)),
    );
  });
});
