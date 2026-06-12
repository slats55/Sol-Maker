/**
 * Execution-mode resolution (Sprint 92).
 *
 * The CLOSED execution-mode set the whole stack reasons about:
 *
 *   - `paper`               — the default. No build, no sign, no send.
 *   - `readonly`            — read-only intelligence (inspect/risk/quotes/feeds). Nothing else.
 *   - `devnet-execution`    — may build/sign/send ONLY on devnet, behind its own explicit opt-in.
 *   - `mainnet-dry-run`     — may build + simulate mainnet transactions; can NEVER send.
 *   - `mainnet-live-blocked`— mainnet live was REQUESTED but at least one gate failed. Blocked.
 *   - `mainnet-live-armed`  — every one of the fourteen live-gate conditions passed.
 *
 * Resolution is fail-closed: an unknown request resolves to `paper`; a live request with ANY
 * failed gate resolves to `mainnet-live-blocked` with the full checklist attached.
 */

import { evaluateMainnetLiveGate, type MainnetLiveGateInput, type MainnetLiveGateResult } from "./live-gate.js";

export const EXECUTION_MODES = [
  "paper",
  "readonly",
  "devnet-execution",
  "mainnet-dry-run",
  "mainnet-live-blocked",
  "mainnet-live-armed",
] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** The env opt-in required before `devnet-execution` resolves (devnet SOL is valueless, but the send path still demands an explicit switch). */
export const DEVNET_EXECUTION_ENV_FLAG = "SOLMAKER_ENABLE_DEVNET_EXECUTION";
export const DEVNET_EXECUTION_ENV_VALUE = "devnet-only";

export interface ResolveExecutionModeInput {
  /** What the operator asked for: "paper" | "readonly" | "devnet" | "mainnet-dry-run" | "mainnet-live". */
  requested?: string | null;
  env?: Record<string, string | undefined>;
  /** The explicit devnet CLI acknowledgment (--acknowledge-devnet-execution). */
  devnetCliAcknowledged?: boolean;
  /** Inputs for the mainnet live gate (only consulted for "mainnet-live"). */
  liveGateInput?: MainnetLiveGateInput;
}

export interface ResolvedExecutionMode {
  mode: ExecutionMode;
  /** Why the resolution landed where it did (operator-readable; empty for paper/readonly). */
  reasons: string[];
  /** The full live-gate checklist when "mainnet-live" was requested; null otherwise. */
  liveGate: MainnetLiveGateResult | null;
}

/** Resolve the execution mode fail-closed. Pure. */
export function resolveExecutionMode(input: ResolveExecutionModeInput = {}): ResolvedExecutionMode {
  const requested = input.requested ?? "paper";
  const env = input.env ?? {};

  if (requested === "readonly") {
    return { mode: "readonly", reasons: [], liveGate: null };
  }
  if (requested === "devnet") {
    const reasons: string[] = [];
    if (env[DEVNET_EXECUTION_ENV_FLAG] !== DEVNET_EXECUTION_ENV_VALUE) {
      reasons.push(`${DEVNET_EXECUTION_ENV_FLAG} must be EXACTLY "${DEVNET_EXECUTION_ENV_VALUE}"`);
    }
    if (input.devnetCliAcknowledged !== true) {
      reasons.push("the explicit devnet CLI acknowledgment flag was not passed");
    }
    if (reasons.length > 0) {
      return { mode: "paper", reasons: ["devnet execution NOT enabled — resolved to paper", ...reasons], liveGate: null };
    }
    return { mode: "devnet-execution", reasons: ["devnet execution explicitly enabled (env + CLI flag)"], liveGate: null };
  }
  if (requested === "mainnet-dry-run") {
    return {
      mode: "mainnet-dry-run",
      reasons: ["mainnet dry-run: transactions may be built and simulated; sending is structurally refused in this mode"],
      liveGate: null,
    };
  }
  if (requested === "mainnet-live") {
    const liveGate = evaluateMainnetLiveGate({ ...input.liveGateInput, env });
    if (liveGate.armed) {
      return {
        mode: "mainnet-live-armed",
        reasons: ["ALL fourteen mainnet live-gate conditions passed — real funds are at risk"],
        liveGate,
      };
    }
    const failed = liveGate.checks.filter((c) => !c.satisfied);
    return {
      mode: "mainnet-live-blocked",
      reasons: [
        `mainnet live BLOCKED: ${failed.length} of ${liveGate.checks.length} gate condition(s) failed`,
        ...failed.map((c) => `${c.gate}: ${c.detail}`),
      ],
      liveGate,
    };
  }
  // Default and anything unknown: paper.
  const reasons = requested === "paper" ? [] : [`unknown requested mode "${String(requested)}" — resolved to paper (fail-closed)`];
  return { mode: "paper", reasons, liveGate: null };
}
