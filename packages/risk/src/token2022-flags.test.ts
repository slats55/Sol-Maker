/**
 * Sprint 93 — Token-2022 extension risk flags.
 *
 * Honesty contract pins:
 *   - NO token2022 block supplied -> NO extension flag fires (existing reports byte-identical);
 *   - status "unavailable" -> an explicit unknown caution, never "all clear";
 *   - status "not-applicable" (classic SPL) -> no extension flags;
 *   - each high-risk extension fires its own flag with the right severity, and the criticals
 *     (hook, permanent delegate, non-transferable, default-frozen, pausable, extreme fee)
 *     force REJECT through the existing scoring rules.
 */

import { describe, it, expect } from "vitest";
import { evaluateRiskFlags, TRANSFER_FEE_EXTREME_BPS } from "./risk-flags.js";
import { buildTokenRiskReport } from "./risk-report.js";
import type { TokenRiskInput } from "./types.js";

const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function cleanToken2022Input(token2022: TokenRiskInput["token2022"]): TokenRiskInput {
  return {
    mint: MINT,
    decimals: 9,
    supplyRaw: "1000000000",
    mintAuthorityPresent: false,
    freezeAuthorityPresent: false,
    isInitialized: true,
    programLabel: "spl-token-2022",
    token2022,
  };
}

function flagIds(input: TokenRiskInput): string[] {
  return evaluateRiskFlags(input).map((f) => f.id);
}

describe("token-2022 extension flags — honesty contract", () => {
  it("NO token2022 block -> NO extension flag fires (back-compat byte-identical)", () => {
    const ids = flagIds({ ...cleanToken2022Input(undefined), token2022: undefined });
    // The long-standing "token-2022-program" info flag still fires (program detection is not an
    // extension check); none of the S93 EXTENSION flags may appear.
    expect(ids).toContain("token-2022-program");
    for (const extensionFlag of [
      "token-2022-extensions-unknown",
      "token-2022-no-risky-extensions",
      "token-2022-unexamined-extension",
      "transfer-hook-present",
      "permanent-delegate-present",
      "non-transferable-token",
      "default-account-state-frozen",
      "pausable-token",
      "transfer-fee-present",
      "transfer-fee-extreme",
      "mint-close-authority-present",
      "confidential-transfers-enabled",
      "scaled-ui-amount-present",
      "interest-bearing-token",
      "metadata-pointer-present",
    ]) {
      expect(ids).not.toContain(extensionFlag);
    }
  });

  it('status "unavailable" -> explicit unknown caution (medium), never all-clear', () => {
    const flags = evaluateRiskFlags(cleanToken2022Input({ status: "unavailable" }));
    const flag = flags.find((f) => f.id === "token-2022-extensions-unknown");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("medium");
    expect(flags.some((f) => f.id === "token-2022-no-risky-extensions")).toBe(false);
  });

  it('status "not-applicable" (classic SPL) -> no extension flags at all', () => {
    const input: TokenRiskInput = { ...cleanToken2022Input({ status: "not-applicable" }), programLabel: "spl-token" };
    const ids = flagIds(input);
    expect(ids.some((id) => id.startsWith("token-2022") || id === "transfer-hook-present")).toBe(false);
  });

  it("a clean parsed Token-2022 mint gets the informational no-risky-extensions flag (clears extension checks ONLY)", () => {
    const flags = evaluateRiskFlags(cleanToken2022Input({ status: "parsed", transferHookPresent: false, permanentDelegatePresent: false }));
    const flag = flags.find((f) => f.id === "token-2022-no-risky-extensions");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("info");
  });

  const criticalCases: Array<[string, TokenRiskInput["token2022"], string]> = [
    ["transfer hook", { status: "parsed", transferHookPresent: true, transferHookProgramId: "hook11111111111111111111111111111111111111" }, "transfer-hook-present"],
    ["permanent delegate", { status: "parsed", permanentDelegatePresent: true }, "permanent-delegate-present"],
    ["non-transferable", { status: "parsed", nonTransferable: true }, "non-transferable-token"],
    ["default account state frozen", { status: "parsed", defaultAccountStateFrozen: true }, "default-account-state-frozen"],
    ["pausable", { status: "parsed", pausable: true }, "pausable-token"],
    ["extreme transfer fee", { status: "parsed", transferFeeBps: TRANSFER_FEE_EXTREME_BPS }, "transfer-fee-extreme"],
  ];
  for (const [label, t22, expectedId] of criticalCases) {
    it(`${label} -> CRITICAL ${expectedId} and the report decision is REJECT`, () => {
      const input = cleanToken2022Input(t22);
      const flag = evaluateRiskFlags(input).find((f) => f.id === expectedId);
      expect(flag).toBeDefined();
      expect(flag?.severity).toBe("critical");
      const report = buildTokenRiskReport(input, { now: () => "2026-06-12T00:00:00.000Z" });
      expect(report.decision).toBe("REJECT");
      // The clean-extensions info flag never co-fires with a risky one.
      expect(report.flags.some((f) => f.id === "token-2022-no-risky-extensions")).toBe(false);
    });
  }

  it("a sub-extreme transfer fee is HIGH (caution economics), not critical", () => {
    const flags = evaluateRiskFlags(cleanToken2022Input({ status: "parsed", transferFeeBps: 300 }));
    const flag = flags.find((f) => f.id === "transfer-fee-present");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("high");
    expect(flag?.evidence).toEqual({ transferFeeBps: 300 });
  });

  it("a ZERO transfer fee config fires no fee flag (no fee is currently charged)", () => {
    const ids = flagIds(cleanToken2022Input({ status: "parsed", transferFeeBps: 0 }));
    expect(ids).not.toContain("transfer-fee-present");
    expect(ids).not.toContain("transfer-fee-extreme");
  });

  it("mint close authority -> HIGH; confidential/scaled-ui -> MEDIUM; interest-bearing -> LOW; metadata pointer -> INFO", () => {
    const flags = evaluateRiskFlags(
      cleanToken2022Input({
        status: "parsed",
        mintCloseAuthorityPresent: true,
        confidentialTransfersEnabled: true,
        scaledUiAmount: true,
        interestBearing: true,
        metadataPointerPresent: true,
      }),
    );
    expect(flags.find((f) => f.id === "mint-close-authority-present")?.severity).toBe("high");
    expect(flags.find((f) => f.id === "confidential-transfers-enabled")?.severity).toBe("medium");
    expect(flags.find((f) => f.id === "scaled-ui-amount-present")?.severity).toBe("medium");
    expect(flags.find((f) => f.id === "interest-bearing-token")?.severity).toBe("low");
    expect(flags.find((f) => f.id === "metadata-pointer-present")?.severity).toBe("info");
  });

  it("an unexamined extension is a MEDIUM caution naming the extension (a caution, not a pass)", () => {
    const flags = evaluateRiskFlags(cleanToken2022Input({ status: "parsed", unexaminedNames: ["futureWeirdExtension"] }));
    const flag = flags.find((f) => f.id === "token-2022-unexamined-extension");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("medium");
    expect(flag?.detail).toContain("futureWeirdExtension");
    expect(flags.some((f) => f.id === "token-2022-no-risky-extensions")).toBe(false);
  });

  it("determinism: identical input yields byte-identical flags", () => {
    const input = cleanToken2022Input({ status: "parsed", transferHookPresent: true, transferFeeBps: 250 });
    expect(JSON.stringify(evaluateRiskFlags(input))).toBe(JSON.stringify(evaluateRiskFlags(input)));
  });
});
