/**
 * The swap-build REPORT artifact (`txbuild.report.v1`, Sprint 95).
 *
 * Every build attempt — BUILT or REFUSED — leaves one auditable artifact: the redacted request
 * summary, the full refusal list (each code joined to its operator guidance: plain message +
 * exact next safe action), the fresh-quote facts, and the decoded transaction SHAPE facts. A
 * refused build is a first-class outcome, not an error: the report says exactly why and what to
 * do next, deterministically.
 *
 * The envelope itself is NOT embedded (it has its own strictly-validated artifact); the report
 * references it by the path the caller wrote it to.
 */

import { redactString } from "@soulmaker/security";
import {
  BUILD_REFUSAL_GUIDANCE,
  type BuildRefusal,
  type BuildSwapRequest,
} from "./refusals.js";
import type { BuiltQuoteFacts } from "./jupiter-swap.js";
import type { TxShapeFacts } from "./inspect.js";

export const TXBUILD_REPORT_SCHEMA_VERSION = "txbuild.report.v1";

export const TXBUILD_REPORT_BANNER =
  "SWAP BUILD REPORT — an auditable record of ONE unsigned-build attempt. A refused build is the system working, not a bug: every refusal names its code, what it means, and the exact next safe action. Nothing here was signed, nothing was sent, and a built envelope is simulation material — never an order, never live-trading readiness.";

export const TXBUILD_REPORT_OUTCOMES = ["built", "refused"] as const;
export type TxBuildReportOutcome = (typeof TXBUILD_REPORT_OUTCOMES)[number];

/** One refusal joined to its operator guidance. */
export interface TxBuildReportRefusal {
  code: string;
  detail: string;
  message: string;
  nextAction: string;
}

export interface TxBuildReport {
  schemaVersion: string;
  banner: string;
  outcome: TxBuildReportOutcome;
  builderId: string;
  endpointHost: string;
  /** REAL ISO timestamp of the attempt (injected clock). */
  attemptedAt: string;
  /** Redacted, bounded request facts — all public data (mints, public key, caps). */
  requestSummary: {
    candidateMint: string | null;
    inputMint: string | null;
    amountRaw: string | null;
    slippageBps: number | null;
    walletPublicKey: string | null;
    network: string | null;
    executionMode: string | null;
    programAllowlistActive: boolean;
  };
  /** Every refusal with guidance; empty when built. */
  refusals: TxBuildReportRefusal[];
  /** Fresh-quote facts when the build got that far; null otherwise. */
  quoteFacts: BuiltQuoteFacts | null;
  /** Decoded transaction shape facts when a transaction existed; null otherwise. */
  txFacts: TxShapeFacts | null;
  /** Where the caller wrote the unsigned envelope (display path); null when refused/unwritten. */
  envelopeRef: string | null;
  neverSigns: true;
  neverSends: true;
  phase7LiveTradingReady: false;
  caveats: string[];
}

export const TXBUILD_REPORT_CAVEATS: readonly string[] = [
  "A build report is evidence of ONE attempt at one moment — quotes expire within seconds and chain state moves every slot.",
  "A built envelope is strictly UNSIGNED simulation material; the only next step is paper:simulation:tx, never a send.",
  "Refusals are deterministic: the same request facts produce the same codes. Fix the named cause; never route around a refusal.",
  "Mainnet live trading remains blocked by policy regardless of any outcome recorded here.",
];

const bound = (value: string | null | undefined, max = 120): string | null =>
  typeof value === "string" && value.length > 0 ? redactString(value).slice(0, max) : null;

export interface ComposeTxBuildReportInput {
  request: BuildSwapRequest;
  builderId: string;
  endpointHost: string;
  attemptedAt: string;
  refusals: BuildRefusal[];
  quoteFacts?: BuiltQuoteFacts | null;
  txFacts?: TxShapeFacts | null;
  envelopeRef?: string | null;
}

/** Compose the report for one attempt. Pure and total — never throws on odd request shapes. */
export function composeTxBuildReport(input: ComposeTxBuildReportInput): TxBuildReport {
  const refusals: TxBuildReportRefusal[] = input.refusals.map((r) => {
    const guidance = BUILD_REFUSAL_GUIDANCE[r.code];
    return {
      code: r.code,
      detail: redactString(r.detail).slice(0, 300),
      message: guidance.message,
      nextAction: guidance.nextAction,
    };
  });
  return {
    schemaVersion: TXBUILD_REPORT_SCHEMA_VERSION,
    banner: TXBUILD_REPORT_BANNER,
    outcome: refusals.length > 0 ? "refused" : "built",
    builderId: input.builderId,
    endpointHost: input.endpointHost,
    attemptedAt: input.attemptedAt,
    requestSummary: {
      candidateMint: bound(input.request.candidateMint),
      inputMint: bound(input.request.inputMint),
      amountRaw: bound(input.request.amountRaw, 30),
      slippageBps: Number.isInteger(input.request.slippageBps) ? (input.request.slippageBps as number) : null,
      walletPublicKey: bound(input.request.walletPublicKey),
      network: bound(input.request.network, 30),
      executionMode: bound(input.request.executionMode, 40),
      programAllowlistActive: Array.isArray(input.request.controls?.allowedPrograms),
    },
    refusals,
    quoteFacts: input.quoteFacts ?? null,
    txFacts: input.txFacts ?? null,
    envelopeRef: input.envelopeRef !== undefined && input.envelopeRef !== null ? redactString(input.envelopeRef).slice(0, 260) : null,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    caveats: [...TXBUILD_REPORT_CAVEATS],
  };
}
