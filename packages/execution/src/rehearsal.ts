/**
 * The DEVNET END-TO-END REHEARSAL (Sprint 93) — the first path in the repository that exercises
 * the FULL execution chain against a real cluster: fund a throwaway key, build the unsigned
 * self-transfer probe, simulate it, submit it through the refusal-first send path, and confirm
 * the signature. DEVNET ONLY by construction:
 *
 *   - the mode wall accepts `devnet-execution` and nothing else (there is no mainnet variant of
 *     this module and never will be — a mainnet rehearsal is exactly what the live gate blocks);
 *   - the signer must be a devnet boundary; the probe envelope is devnet; the send path
 *     re-validates both;
 *   - every step (including airdrop rate-limits and confirmation timeouts) is recorded HONESTLY
 *     in the report — a rehearsal that could not fund itself says `devnet-funding-blocked`, it
 *     never fakes success.
 *
 * This module never touches key material (that is signer.ts) and never names the raw send
 * method (that is send.ts) — it drives both through their boundaries.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { redactString } from "@soulmaker/security";
import { buildUnsignedSelfTransferProbe } from "@soulmaker/txpreview";
import type { ExecutionMode } from "./modes.js";
import type { OperatorSafetyControls } from "./safety-controls.js";
import { attemptExecution, createSendRpc } from "./send.js";
import type { ExecutionAttemptReport, SendRpcLike } from "./send.js";
import type { TransactionSigningBoundary } from "./signer.js";

export const DEVNET_REHEARSAL_REPORT_SCHEMA_VERSION = "execution.devnet.rehearsal.report.v1";

export const DEVNET_REHEARSAL_BANNER =
  "DEVNET END-TO-END REHEARSAL REPORT — a throwaway-funded self-transfer probe was driven through the full execution chain (fund -> build -> simulate -> send -> confirm) on DEVNET ONLY. Devnet SOL is valueless; this is execution-discipline evidence, never mainnet readiness and never a profit claim.";

/** Default airdrop request: 1 devnet SOL (the standard faucet unit; valueless). */
export const DEVNET_REHEARSAL_DEFAULT_AIRDROP_LAMPORTS = 1_000_000_000;
/** Minimum balance to attempt the probe: covers the 5000-lamport base fee with headroom. */
export const DEVNET_REHEARSAL_MIN_BALANCE_LAMPORTS = 100_000;

export const DEVNET_REHEARSAL_OUTCOMES = [
  "rehearsed",
  "submitted-unconfirmed",
  "devnet-funding-blocked",
  "blocked",
] as const;
export type DevnetRehearsalOutcome = (typeof DEVNET_REHEARSAL_OUTCOMES)[number];

/** How the rehearsal signer came to exist. Reuse (S94) keeps external funding on the same key. */
export type RehearsalSignerSource = "generated-throwaway" | "reused-throwaway" | "operator-env";

/** Bounded faucet retry (S94): never more than this many airdrop requests per rehearsal run. */
export const DEVNET_REHEARSAL_MAX_AIRDROP_ATTEMPTS = 5;
export const DEVNET_REHEARSAL_DEFAULT_AIRDROP_ATTEMPTS = 3;

export type RehearsalStepId = "mode" | "signer" | "funding" | "build-probe" | "simulate" | "send" | "confirm";
export type RehearsalStepStatus = "ok" | "failed" | "unavailable" | "skipped";

export interface RehearsalStep {
  step: RehearsalStepId;
  status: RehearsalStepStatus;
  detail: string;
}

/** The narrow devnet faucet/confirmation seam (production: a Connection wrapper; tests: a fake). */
export interface RehearsalFaucetRpcLike {
  getBalanceLamports(publicKeyBase58: string): Promise<number>;
  /** Devnet faucet request. Returns the airdrop signature. Rate limits surface as throws. */
  requestAirdrop(publicKeyBase58: string, lamports: number): Promise<string>;
  getSignatureStatus(signature: string): Promise<{ confirmed: boolean; slot: number | null; errLabel: string | null }>;
}

export interface RehearsalRpc {
  readonly endpointHost: string;
  readonly faucet: RehearsalFaucetRpcLike;
  readonly send: SendRpcLike;
}

/**
 * Production factory: wrap one devnet RPC URL into the rehearsal seams. REFUSES anything that
 * names mainnet. The send half is built by the send path's own factory — this module never
 * names the raw send method.
 */
export function createRehearsalRpc(rpcUrl: string): RehearsalRpc {
  if (!rpcUrl || rpcUrl.trim().length === 0) {
    throw new Error("createRehearsalRpc requires a non-empty rpcUrl");
  }
  if (rpcUrl.toLowerCase().includes("mainnet")) {
    throw new Error("createRehearsalRpc never talks to a mainnet endpoint — devnet only");
  }
  const sendRpc = createSendRpc(rpcUrl);
  // The send factory's seam is deliberately narrow; faucet/confirmation reads get their own
  // connection (reads + the devnet faucet only — no send method is exposed from here).
  const connection = new Connection(rpcUrl, "confirmed");
  return Object.freeze({
    endpointHost: sendRpc.endpointHost,
    faucet: Object.freeze({
      getBalanceLamports: async (publicKeyBase58: string) => connection.getBalance(new PublicKey(publicKeyBase58), "confirmed"),
      requestAirdrop: async (publicKeyBase58: string, lamports: number) =>
        connection.requestAirdrop(new PublicKey(publicKeyBase58), lamports),
      getSignatureStatus: async (signature: string) => {
        const statuses = await connection.getSignatureStatuses([signature]);
        const status = statuses.value[0];
        if (status === null || status === undefined) return { confirmed: false, slot: null, errLabel: null };
        const confirmed = status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized";
        return {
          confirmed,
          slot: typeof status.slot === "number" ? status.slot : null,
          errLabel: status.err === null ? null : redactString(JSON.stringify(status.err)).slice(0, 300),
        };
      },
    }),
    send: sendRpc.rpc,
  });
}

export interface DevnetRehearsalReport {
  schemaVersion: string;
  banner: string;
  network: "devnet";
  endpointHost: string;
  outcome: DevnetRehearsalOutcome;
  steps: RehearsalStep[];
  /** PUBLIC key of the rehearsal signer. */
  signerPublicKey: string | null;
  /** Path of the throwaway keypair file (path only — never contents); null for operator-env signers. */
  throwawayFilePath: string | null;
  signerSource: RehearsalSignerSource;
  airdrop: {
    requested: boolean;
    lamports: number | null;
    signature: string | null;
    status: "confirmed" | "submitted" | "unavailable" | "skipped";
    /** Faucet requests actually made this run (bounded; 0 when none were needed). */
    attempts: number;
    /** The bound the run was configured with. */
    maxAttempts: number;
  };
  balanceLamportsBefore: number | null;
  balanceLamportsAfter: number | null;
  simulation: { outcome: string; errLabel: string | null } | null;
  /** The FULL send-path attempt report (refused or submitted), verbatim. */
  attempt: ExecutionAttemptReport | null;
  /** The probe's transaction signature when submitted. Public chain data. */
  signature: string | null;
  confirmation: { confirmed: boolean; slot: number | null; errLabel: string | null; polls: number } | null;
  /**
   * Present ONLY on a devnet-funding-blocked outcome: the exact safe ways to fund the rehearsal
   * key externally and rerun against the SAME key. Never instructions toward mainnet.
   */
  fundingGuidance: string[] | null;
  startedAt: string;
  finishedAt: string;
  caveats: string[];
  neverMainnet: true;
  phase7LiveTradingReady: false;
}

const REHEARSAL_CAVEATS: readonly string[] = [
  "Devnet SOL is valueless — this rehearsal proves execution DISCIPLINE (boundaries, gates, journaling), not trading readiness.",
  "The probe is a self-transfer: sender == recipient, so no value moved anywhere even on devnet.",
  "A confirmed devnet signature is public chain data and safe to share; the keypair file is throwaway and gitignored.",
  "Nothing here arms, weakens, or substitutes for the fourteen-condition mainnet live gate.",
];

export interface RunDevnetRehearsalInput {
  /** Must be devnet-execution — every other mode refuses structurally. */
  mode: ExecutionMode;
  signer: TransactionSigningBoundary;
  rpc: RehearsalRpc;
  signerSource: RehearsalSignerSource;
  /** Path of the throwaway keypair file when generated (echoed as a path only). */
  throwawayFilePath?: string | null;
  /** Injected simulation seam (CLI backs it with txpreview); absent = step skipped honestly. */
  simulate?: (envelopeValue: unknown) => Promise<{ outcome: string; errLabel: string | null }>;
  killSwitchActive: boolean;
  emergencyStopFilePresent: boolean;
  skipAirdrop?: boolean;
  airdropLamports?: number;
  /** Bounded faucet retries per run (default 3, hard cap 5 — never spam the faucet). */
  airdropAttempts?: number;
  minBalanceLamports?: number;
  /** Confirmation polling bounds (defaults: 30 polls, 2000 ms apart). */
  confirmPolls?: number;
  pollDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => string;
  nowMs?: () => number;
}

/**
 * Run one devnet end-to-end rehearsal. NEVER throws on cluster problems — every failure mode is
 * an honest report with the steps preserved up to the failure.
 */
export async function runDevnetRehearsal(input: RunDevnetRehearsalInput): Promise<DevnetRehearsalReport> {
  const clock = input.clock ?? ((): string => new Date().toISOString());
  const nowMs = input.nowMs ?? ((): number => Date.now());
  const sleep = input.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const startedAt = clock();
  const steps: RehearsalStep[] = [];
  const minBalance = input.minBalanceLamports ?? DEVNET_REHEARSAL_MIN_BALANCE_LAMPORTS;
  const airdropLamports = input.airdropLamports ?? DEVNET_REHEARSAL_DEFAULT_AIRDROP_LAMPORTS;
  const maxAirdropAttempts = Math.min(
    Math.max(Math.trunc(input.airdropAttempts ?? DEVNET_REHEARSAL_DEFAULT_AIRDROP_ATTEMPTS), 1),
    DEVNET_REHEARSAL_MAX_AIRDROP_ATTEMPTS,
  );

  const base = {
    schemaVersion: DEVNET_REHEARSAL_REPORT_SCHEMA_VERSION,
    banner: DEVNET_REHEARSAL_BANNER,
    network: "devnet" as const,
    endpointHost: input.rpc.endpointHost,
    signerPublicKey: null as string | null,
    throwawayFilePath: input.throwawayFilePath ?? null,
    signerSource: input.signerSource,
    airdrop: {
      requested: false,
      lamports: null as number | null,
      signature: null as string | null,
      status: "skipped" as "confirmed" | "submitted" | "unavailable" | "skipped",
      attempts: 0,
      maxAttempts: maxAirdropAttempts,
    },
    balanceLamportsBefore: null as number | null,
    balanceLamportsAfter: null as number | null,
    simulation: null as { outcome: string; errLabel: string | null } | null,
    attempt: null as ExecutionAttemptReport | null,
    signature: null as string | null,
    confirmation: null as { confirmed: boolean; slot: number | null; errLabel: string | null; polls: number } | null,
    fundingGuidance: null as string[] | null,
    startedAt,
    caveats: [...REHEARSAL_CAVEATS],
    neverMainnet: true as const,
    phase7LiveTradingReady: false as const,
  };
  const finish = (outcome: DevnetRehearsalOutcome): DevnetRehearsalReport => ({
    ...base,
    outcome,
    steps,
    finishedAt: clock(),
  });

  // 1) Mode wall — devnet-execution and nothing else.
  if (input.mode !== "devnet-execution") {
    steps.push({ step: "mode", status: "failed", detail: `mode "${input.mode}" can never rehearse — only devnet-execution` });
    return finish("blocked");
  }
  steps.push({ step: "mode", status: "ok", detail: "devnet-execution (env flag + CLI acknowledgment)" });

  // 2) Signer boundary — must be devnet.
  if (input.signer.network !== "devnet") {
    steps.push({ step: "signer", status: "failed", detail: "the signer boundary is not a devnet boundary — refused" });
    return finish("blocked");
  }
  base.signerPublicKey = input.signer.publicKeyBase58;
  const signerLabel =
    input.signerSource === "generated-throwaway"
      ? "throwaway devnet keypair generated (gitignored .keypair file)"
      : input.signerSource === "reused-throwaway"
        ? "EXISTING throwaway devnet keypair reused (gitignored .keypair file; external funding sticks to this key)"
        : "operator devnet signer loaded through the boundary";
  steps.push({
    step: "signer",
    status: "ok",
    detail: `${signerLabel}; public key ${input.signer.publicKeyBase58}`,
  });
  // Funding guidance attaches ONLY to a funding-blocked exit — devnet faucets and reuse, never
  // a mainnet instruction.
  const fundingGuidance = [
    `Fund the rehearsal public key ${input.signer.publicKeyBase58} with valueless DEVNET SOL: https://faucet.solana.com (select devnet) or \`solana airdrop 1 ${input.signer.publicKeyBase58} --url devnet\`.`,
    "Rerun the SAME command with --force: an existing throwaway keypair in the output directory is REUSED, so external funding stays on this key.",
    "Never fund this key on mainnet — the rehearsal refuses mainnet endpoints and the key is throwaway by design.",
  ];

  // 3) Funding — balance, then a BOUNDED airdrop retry loop when short (rate limits become an
  //    HONEST artifact with the attempt count preserved; the faucet is never spammed).
  try {
    base.balanceLamportsBefore = await input.rpc.faucet.getBalanceLamports(input.signer.publicKeyBase58);
  } catch (err) {
    steps.push({ step: "funding", status: "unavailable", detail: redactString(`balance read failed: ${(err as Error).message ?? "unknown"}`).slice(0, 300) });
    base.fundingGuidance = fundingGuidance;
    return finish("devnet-funding-blocked");
  }
  let balance = base.balanceLamportsBefore;
  if (balance < minBalance && input.skipAirdrop !== true) {
    base.airdrop.requested = true;
    base.airdrop.lamports = airdropLamports;
    const retryDelay = input.pollDelayMs ?? 2000;
    let lastAirdropError: string | null = null;
    for (let attempt = 1; attempt <= maxAirdropAttempts && base.airdrop.signature === null; attempt += 1) {
      base.airdrop.attempts = attempt;
      try {
        base.airdrop.signature = await input.rpc.faucet.requestAirdrop(input.signer.publicKeyBase58, airdropLamports);
        base.airdrop.status = "submitted";
      } catch (err) {
        lastAirdropError = redactString((err as Error).message ?? "unknown").slice(0, 200);
        if (attempt < maxAirdropAttempts) await sleep(retryDelay);
      }
    }
    if (base.airdrop.signature !== null) {
      try {
        // Bounded wait for the airdrop to land before re-reading the balance.
        const polls = input.confirmPolls ?? 30;
        for (let i = 0; i < polls; i += 1) {
          const status = await input.rpc.faucet.getSignatureStatus(base.airdrop.signature);
          if (status.confirmed) {
            base.airdrop.status = "confirmed";
            break;
          }
          await sleep(retryDelay);
        }
        balance = await input.rpc.faucet.getBalanceLamports(input.signer.publicKeyBase58);
      } catch (err) {
        base.airdrop.status = "unavailable";
        steps.push({
          step: "funding",
          status: "unavailable",
          detail: redactString(`airdrop submitted but its status/balance could not be read: ${(err as Error).message ?? "unknown"}`).slice(0, 300),
        });
        base.fundingGuidance = fundingGuidance;
        return finish("devnet-funding-blocked");
      }
    } else {
      base.airdrop.status = "unavailable";
      steps.push({
        step: "funding",
        status: "unavailable",
        detail: redactString(
          `airdrop unavailable after ${base.airdrop.attempts} bounded attempt(s) (rate limit or faucet outage): ${lastAirdropError ?? "unknown"}`,
        ).slice(0, 300),
      });
      base.fundingGuidance = fundingGuidance;
      return finish("devnet-funding-blocked");
    }
  }
  base.balanceLamportsAfter = balance;
  if (balance < minBalance) {
    steps.push({
      step: "funding",
      status: "failed",
      detail: `balance ${balance} lamports is below the ${minBalance}-lamport rehearsal minimum and no airdrop landed`,
    });
    base.fundingGuidance = fundingGuidance;
    return finish("devnet-funding-blocked");
  }
  if (steps[steps.length - 1]?.step !== "funding") {
    steps.push({ step: "funding", status: "ok", detail: `balance ${balance} lamports (airdrop: ${base.airdrop.status})` });
  }

  // 4) Build the unsigned self-transfer probe (the strict validator proves it is unsigned).
  let envelope: unknown;
  try {
    envelope = buildUnsignedSelfTransferProbe({ feePayerPublicKey: input.signer.publicKeyBase58, network: "devnet" });
    steps.push({ step: "build-probe", status: "ok", detail: "unsigned 1-lamport self-transfer probe built and strictly validated" });
  } catch (err) {
    steps.push({ step: "build-probe", status: "failed", detail: redactString((err as Error).message ?? "probe build failed").slice(0, 300) });
    return finish("blocked");
  }

  // 5) Simulate (injected seam). A probe that fails simulation is never sent.
  if (input.simulate) {
    try {
      base.simulation = await input.simulate(envelope);
    } catch (err) {
      base.simulation = { outcome: "unavailable", errLabel: redactString((err as Error).message ?? "simulation seam failed").slice(0, 300) };
    }
    if (base.simulation.outcome === "simulated-ok") {
      steps.push({ step: "simulate", status: "ok", detail: "probe simulated ok against recent devnet state" });
    } else if (base.simulation.outcome === "unavailable") {
      steps.push({ step: "simulate", status: "unavailable", detail: `simulation unavailable (${base.simulation.errLabel ?? "no detail"}) — proceeding; the send path preflights anyway` });
    } else {
      steps.push({ step: "simulate", status: "failed", detail: `probe did not simulate ok (${base.simulation.outcome}) — refusing to send it` });
      return finish("blocked");
    }
  } else {
    steps.push({ step: "simulate", status: "skipped", detail: "no simulation seam supplied" });
  }

  // 6) Send through the refusal-first path with probe-tight safety controls.
  const controls: OperatorSafetyControls = {
    killSwitchActive: input.killSwitchActive,
    emergencyStopFilePresent: input.emergencyStopFilePresent,
    maxSpendPerTradeLamports: "1",
    maxTradesPerSession: 1,
    sessionLossCapSol: 0.01,
    slippageCapBps: 0,
    riskScoreCap: 100,
    quoteAgeCapMs: 60_000,
    allowedMints: null,
    blockedMints: [],
    allowedProviders: null,
    networkLock: "devnet",
    auditLogRequired: true,
    cooldownMs: 0,
    duplicateMintProtection: true,
  };
  base.attempt = await attemptExecution({
    mode: input.mode,
    signer: input.signer,
    envelopeValue: envelope,
    rpc: input.rpc.send,
    endpointHost: input.rpc.endpointHost,
    controls,
    trade: {
      mint: input.signer.publicKeyBase58,
      provider: "self-transfer-probe",
      network: "devnet",
      spendLamports: "1",
      slippageBps: 0,
      riskScore: 0,
      quoteAgeMs: 0,
      auditLogPathProvided: true,
    },
    session: { tradesCount: 0, sessionLossSol: 0, lastTradeAtMs: null, mintsTraded: [] },
    nowMs: nowMs(),
    clock,
  });
  if (base.attempt.outcome !== "submitted" || base.attempt.signature === null) {
    steps.push({
      step: "send",
      status: "failed",
      detail: `send refused: ${base.attempt.refusalCode ?? "unknown"} — ${base.attempt.refusalDetail ?? "no detail"}`,
    });
    return finish("blocked");
  }
  base.signature = base.attempt.signature;
  steps.push({ step: "send", status: "ok", detail: `submitted once; signature ${base.attempt.signature}` });

  // 7) Confirm — bounded polling; a timeout is reported honestly, never upgraded.
  const polls = input.confirmPolls ?? 30;
  const delay = input.pollDelayMs ?? 2000;
  let confirmation: { confirmed: boolean; slot: number | null; errLabel: string | null; polls: number } = {
    confirmed: false,
    slot: null,
    errLabel: null,
    polls: 0,
  };
  for (let i = 1; i <= polls; i += 1) {
    let status: { confirmed: boolean; slot: number | null; errLabel: string | null };
    try {
      status = await input.rpc.faucet.getSignatureStatus(base.signature);
    } catch (err) {
      confirmation = { confirmed: false, slot: null, errLabel: redactString((err as Error).message ?? "status read failed").slice(0, 300), polls: i };
      break;
    }
    confirmation = { ...status, polls: i };
    if (status.confirmed || status.errLabel !== null) break;
    if (i < polls) await sleep(delay);
  }
  base.confirmation = confirmation;
  if (confirmation.confirmed && confirmation.errLabel === null) {
    steps.push({ step: "confirm", status: "ok", detail: `confirmed at slot ${confirmation.slot ?? "unknown"} after ${confirmation.polls} poll(s)` });
    return finish("rehearsed");
  }
  if (confirmation.errLabel !== null) {
    steps.push({ step: "confirm", status: "failed", detail: `the transaction landed with an error: ${confirmation.errLabel}` });
    return finish("submitted-unconfirmed");
  }
  steps.push({
    step: "confirm",
    status: "unavailable",
    detail: `not confirmed within ${confirmation.polls} poll(s) — submission is not confirmation; verify the signature independently`,
  });
  return finish("submitted-unconfirmed");
}
