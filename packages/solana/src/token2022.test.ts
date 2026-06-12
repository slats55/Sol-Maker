import { describe, it, expect } from "vitest";
import { summarizeToken2022Extensions } from "./token2022.js";

const HOOK_PROGRAM = "hook111111111111111111111111111111111111111";
const DELEGATE = "de1egate111111111111111111111111111111111111";

describe("summarizeToken2022Extensions — honest tri-state", () => {
  it("a classic spl-token mint is not-applicable with all-null facts", () => {
    const s = summarizeToken2022Extensions("spl-token", undefined);
    expect(s.status).toBe("not-applicable");
    expect(s.transferHookPresent).toBeNull();
    expect(s.permanentDelegatePresent).toBeNull();
    expect(s.extensionNames).toEqual([]);
  });

  it("a Token-2022 mint with NO extensions array is parsed with explicit all-false facts (the encoding omits the array)", () => {
    const s = summarizeToken2022Extensions("spl-token-2022", undefined);
    expect(s.status).toBe("parsed");
    expect(s.transferHookPresent).toBe(false);
    expect(s.permanentDelegatePresent).toBe(false);
    expect(s.nonTransferable).toBe(false);
    expect(s.defaultAccountStateFrozen).toBe(false);
  });

  it("a malformed extensions value is unavailable — never 'no extensions, all clear'", () => {
    for (const junk of ["nope", 42, { extension: "x" }, [{ notExtension: true }], [{ extension: 7 }]]) {
      const s = summarizeToken2022Extensions("spl-token-2022", junk);
      expect(s.status, JSON.stringify(junk)).toBe("unavailable");
      expect(s.transferHookPresent).toBeNull();
    }
  });

  it("extracts every examined high-signal fact from a fully-loaded mint", () => {
    const s = summarizeToken2022Extensions("spl-token-2022", [
      { extension: "transferFeeConfig", state: { newerTransferFee: { transferFeeBasisPoints: 300, maximumFee: "5000000" } } },
      { extension: "transferHook", state: { authority: DELEGATE, programId: HOOK_PROGRAM } },
      { extension: "permanentDelegate", state: { delegate: DELEGATE } },
      { extension: "defaultAccountState", state: { accountState: "frozen" } },
      { extension: "confidentialTransferMint", state: { autoApproveNewAccounts: false } },
      { extension: "metadataPointer", state: { authority: DELEGATE, metadataAddress: DELEGATE } },
      { extension: "mintCloseAuthority", state: { closeAuthority: DELEGATE } },
      { extension: "nonTransferable", state: {} },
      { extension: "interestBearingConfig", state: { currentRate: 50 } },
      { extension: "pausableConfig", state: { paused: false } },
      { extension: "scaledUiAmountConfig", state: { multiplier: "2" } },
    ]);
    expect(s.status).toBe("parsed");
    expect(s.transferFeeBps).toBe(300);
    expect(s.transferHookPresent).toBe(true);
    expect(s.transferHookProgramId).toBe(HOOK_PROGRAM);
    expect(s.permanentDelegatePresent).toBe(true);
    expect(s.permanentDelegate).toBe(DELEGATE);
    expect(s.defaultAccountStateFrozen).toBe(true);
    expect(s.confidentialTransfersEnabled).toBe(true);
    expect(s.metadataPointerPresent).toBe(true);
    expect(s.mintCloseAuthorityPresent).toBe(true);
    expect(s.nonTransferable).toBe(true);
    expect(s.interestBearing).toBe(true);
    expect(s.pausable).toBe(true);
    expect(s.scaledUiAmount).toBe(true);
    expect(s.extensionNames).toHaveLength(11);
    expect(s.unexaminedNames).toEqual([]);
  });

  it("a transferHook extension with a NULL programId still counts as hook-present (the authority can set one)", () => {
    const s = summarizeToken2022Extensions("spl-token-2022", [{ extension: "transferHook", state: { authority: DELEGATE, programId: null } }]);
    expect(s.transferHookPresent).toBe(true);
    expect(s.transferHookProgramId).toBeNull();
  });

  it("defaultAccountState 'initialized' is NOT frozen", () => {
    const s = summarizeToken2022Extensions("spl-token-2022", [{ extension: "defaultAccountState", state: { accountState: "initialized" } }]);
    expect(s.defaultAccountStateFrozen).toBe(false);
  });

  it("an unrecognized extension name is listed as unexamined (behavior unverified, kept verbatim)", () => {
    const s = summarizeToken2022Extensions("spl-token-2022", [{ extension: "futureWeirdExtension", state: {} }]);
    expect(s.status).toBe("parsed");
    expect(s.extensionNames).toEqual(["futureWeirdExtension"]);
    expect(s.unexaminedNames).toEqual(["futureWeirdExtension"]);
  });

  it("an odd transferFee shape becomes a null fact, never a guess", () => {
    const s = summarizeToken2022Extensions("spl-token-2022", [{ extension: "transferFeeConfig", state: { newerTransferFee: { transferFeeBasisPoints: "not-a-number" } } }]);
    expect(s.status).toBe("parsed");
    expect(s.transferFeeBps).toBeNull();
    expect(s.extensionNames).toEqual(["transferFeeConfig"]);
  });
});
