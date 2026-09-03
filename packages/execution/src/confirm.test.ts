import { describe, expect, it } from "vitest";
import { confirmSignature, sumRawAmounts, tokenDelta, type ConfirmRpcLike, type SignatureStatusLike } from "./index.js";

const SIG = "5".repeat(88);

function fakeRpc(sequence: Array<SignatureStatusLike | null | Error>): ConfirmRpcLike {
  let i = 0;
  return {
    getSignatureStatuses: async (_s: string[]) => {
      const next = sequence[Math.min(i, sequence.length - 1)] ?? null;
      i += 1;
      if (next instanceof Error) throw next;
      return { value: [next] };
    },
  };
}

function clock() {
  let t = 1_000_000;
  return { nowMs: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe("confirmSignature (S111)", () => {
  it("returns confirmed when the status reaches confirmed", async () => {
    const c = clock();
    const rpc = fakeRpc([null, { slot: 10, err: null, confirmationStatus: "processed" }, { slot: 10, err: null, confirmationStatus: "confirmed" }]);
    const r = await confirmSignature({ rpc, signature: SIG, ...c, pollMs: 100, timeoutMs: 5_000 });
    expect(r.status).toBe("confirmed");
    expect(r.landed).toBe(true);
    expect(r.slot).toBe(10);
    expect(r.polls).toBe(3);
  });

  it("returns failed with the on-chain error and never claims landed", async () => {
    const c = clock();
    const rpc = fakeRpc([{ slot: 11, err: { InstructionError: [2, "Custom"] }, confirmationStatus: "confirmed" }]);
    const r = await confirmSignature({ rpc, signature: SIG, ...c, pollMs: 100, timeoutMs: 5_000 });
    expect(r.status).toBe("failed");
    expect(r.landed).toBe(false);
    expect(r.errLabel).toContain("InstructionError");
  });

  it("returns timeout (honestly unknown) at the deadline, never failed", async () => {
    const c = clock();
    const rpc = fakeRpc([null]);
    const r = await confirmSignature({ rpc, signature: SIG, ...c, pollMs: 500, timeoutMs: 2_000 });
    expect(r.status).toBe("timeout");
    expect(r.landed).toBe(false);
    expect(r.polls).toBeGreaterThanOrEqual(4);
  });

  it("returns rpc-error on transport failure and never throws", async () => {
    const c = clock();
    const rpc = fakeRpc([new Error("socket hang up")]);
    const r = await confirmSignature({ rpc, signature: SIG, ...c });
    expect(r.status).toBe("rpc-error");
    expect(r.errLabel).toContain("socket hang up");
  });

  it("waits for finalized when asked", async () => {
    const c = clock();
    const rpc = fakeRpc([{ slot: 1, err: null, confirmationStatus: "confirmed" }, { slot: 1, err: null, confirmationStatus: "finalized" }]);
    const r = await confirmSignature({ rpc, signature: SIG, ...c, commitment: "finalized", pollMs: 10 });
    expect(r.status).toBe("finalized");
  });
});

describe("balances helpers (S111)", () => {
  it("sums raw amounts across accounts as BigInt strings", () => {
    const accounts = [
      { account: { data: { parsed: { info: { tokenAmount: { amount: "9000000000000000000" } } } } } },
      { account: { data: { parsed: { info: { tokenAmount: { amount: "1" } } } } } },
      { account: { data: {} } },
    ];
    expect(sumRawAmounts(accounts as never)).toBe("9000000000000000001");
  });
  it("computes signed deltas", () => {
    expect(tokenDelta("0", "500").deltaRaw).toBe("500");
    expect(tokenDelta("500", "0").deltaRaw).toBe("-500");
  });
});
