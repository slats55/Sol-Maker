import { describe, expect, it } from "vitest";

import { ALL_CHAIN_ADAPTERS, chainAdapterFor, isLiveCapableChain, SOLANA_MAINNET_ADAPTER } from "./chain-adapter.js";

describe("chain adapter boundary", () => {
  it("solana mainnet is the only live-capable chain", () => {
    expect(SOLANA_MAINNET_ADAPTER.liveStatus).toBe("live_capable");
    expect(SOLANA_MAINNET_ADAPTER.walletProvider).toBe("phantom");
    expect(isLiveCapableChain("solana-mainnet")).toBe(true);

    const liveCapable = ALL_CHAIN_ADAPTERS.filter((a) => a.liveStatus === "live_capable");
    expect(liveCapable).toHaveLength(1);
    expect(liveCapable[0]?.chainId).toBe("solana-mainnet");
  });

  it("every other chain is an honest disabled stub", () => {
    for (const adapter of ALL_CHAIN_ADAPTERS) {
      if (adapter.chainId === "solana-mainnet") continue;
      expect(adapter.liveStatus).toBe("not_implemented");
      expect(adapter.walletProvider).toBeNull();
      expect(adapter.capabilities).toEqual({ quote: false, risk: false, preflight: false, walletSign: false });
      expect(isLiveCapableChain(adapter.chainId)).toBe(false);
    }
  });

  it("an unknown chain resolves to null and is not live-capable", () => {
    expect(chainAdapterFor("dogecoin")).toBeNull();
    expect(isLiveCapableChain("dogecoin")).toBe(false);
  });
});
