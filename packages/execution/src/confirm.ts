/**
 * CONFIRMATION (Sprint 111) — the step the S92 send path deliberately stopped short of.
 *
 * `attemptExecution` returns a signature and says "submission is not confirmation". This module
 * turns that signature into a fact: it polls `getSignatureStatuses` until the transaction is
 * confirmed/finalized, failed on-chain, or the deadline passes. It never retries a send, never
 * re-signs, and never invents a status — `timeout` means "honestly unknown", not "failed".
 */

export const CONFIRM_DEFAULT_TIMEOUT_MS = 45_000;
export const CONFIRM_DEFAULT_POLL_MS = 1_500;
/** Absolute poll ceiling — guarantees termination even if an injected clock never advances. */
export const CONFIRM_MAX_POLLS = 400;

export const CONFIRM_STATUSES = ["confirmed", "finalized", "failed", "timeout", "rpc-error"] as const;
export type ConfirmStatus = (typeof CONFIRM_STATUSES)[number];

export interface SignatureStatusLike {
  slot: number;
  err: unknown | null;
  confirmationStatus?: string | null;
}

/** The ONLY RPC capability the confirmation path accepts. */
export interface ConfirmRpcLike {
  getSignatureStatuses(signatures: string[]): Promise<{ value: Array<SignatureStatusLike | null> }>;
}

export interface ConfirmSignatureInput {
  rpc: ConfirmRpcLike;
  signature: string;
  timeoutMs?: number;
  pollMs?: number;
  /** Injected for tests. */
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Stop at "confirmed" (default) or require "finalized". */
  commitment?: "confirmed" | "finalized";
}

export interface ConfirmResult {
  status: ConfirmStatus;
  signature: string;
  slot: number | null;
  /** Stringified on-chain error when `failed`; transport detail when `rpc-error`; else null. */
  errLabel: string | null;
  polls: number;
  elapsedMs: number;
  /** True only for confirmed/finalized. */
  landed: boolean;
}

function labelErr(err: unknown): string {
  try {
    const s = typeof err === "string" ? err : JSON.stringify(err);
    return s.slice(0, 300);
  } catch {
    return "unlabelable error";
  }
}

/** Poll until the signature lands, fails, or the deadline passes. NEVER throws. */
export async function confirmSignature(input: ConfirmSignatureInput): Promise<ConfirmResult> {
  const nowMs = input.nowMs ?? ((): number => Date.now());
  const sleep = input.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = input.timeoutMs ?? CONFIRM_DEFAULT_TIMEOUT_MS;
  const pollMs = input.pollMs ?? CONFIRM_DEFAULT_POLL_MS;
  const want = input.commitment ?? "confirmed";
  const start = nowMs();
  let polls = 0;
  const done = (status: ConfirmStatus, slot: number | null, errLabel: string | null): ConfirmResult => ({
    status,
    signature: input.signature,
    slot,
    errLabel,
    polls,
    elapsedMs: nowMs() - start,
    landed: status === "confirmed" || status === "finalized",
  });

  while (true) {
    polls += 1;
    let entry: SignatureStatusLike | null;
    try {
      const res = await input.rpc.getSignatureStatuses([input.signature]);
      entry = res.value[0] ?? null;
    } catch (err) {
      return done("rpc-error", null, labelErr((err as Error).message ?? err));
    }
    if (entry) {
      if (entry.err !== null && entry.err !== undefined) return done("failed", entry.slot, labelErr(entry.err));
      const cs = entry.confirmationStatus ?? null;
      if (cs === "finalized") return done("finalized", entry.slot, null);
      if (cs === "confirmed" && want === "confirmed") return done("confirmed", entry.slot, null);
    }
    if (nowMs() - start >= timeoutMs || polls >= CONFIRM_MAX_POLLS) return done("timeout", entry?.slot ?? null, null);
    await sleep(pollMs);
  }
}
