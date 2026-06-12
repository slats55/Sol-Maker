/**
 * The quote FETCH REPORT (`routequote.fetch.report.v1`, Sprint 92).
 *
 * Records what a read-only fetch pass over a candidate list actually produced: one validated
 * observation + freshness metadata per candidate, honest tallies, and the mandatory caveats.
 * This artifact is PROVENANCE — it carries a REAL wall-clock `fetchedAt`, so unlike the
 * deterministic simulation chain it is honest about being a point-in-time record.
 *
 * A fetch report can never claim execution capability: the literals are pinned, the status set
 * is closed, and the validator downstream (`paper:routequote:prepare`) re-validates every
 * observation it consumes.
 */

import { redactString } from "@soulmaker/security";
import { ROUTE_QUOTE_CAVEATS, type RouteQuoteStatus } from "@soulmaker/routequote";
import type { SniperCandidateList } from "@soulmaker/sniper";
import type { QuoteFetchRequest, QuoteFetchResult, QuoteProviderAdapter } from "./types.js";

/** Stable schema identifier. Bump only on a breaking change. */
export const ROUTE_QUOTE_FETCH_REPORT_SCHEMA_VERSION = "routequote.fetch.report.v1";

export const ROUTE_QUOTE_FETCH_REPORT_BANNER =
  "READ-ONLY ROUTE QUOTE FETCH REPORT — real provider quotes observed over public HTTP, never executable, never an order, never live-trading readiness.";

/** The S91 mandatory caveats plus the freshness truths a REAL fetcher must state. */
export const ROUTE_QUOTE_FETCH_CAVEATS: readonly string[] = [
  ...ROUTE_QUOTE_CAVEATS,
  "A fetched quote expires within seconds; `fetchedAt` records when it was observed, never that it is still valid.",
  "Freshness metadata (timestamp, slot, digest) is provenance — it does not upgrade an observation into a route, a transaction, or readiness.",
];

/** One candidate's fetch outcome inside the report. */
export interface RouteQuoteFetchEntry {
  candidateId: string;
  mint: string;
  status: RouteQuoteStatus;
  /** The validated observation — exactly what paper:routequote:prepare consumes. */
  observation: QuoteFetchResult["observation"];
  metadata: QuoteFetchResult["metadata"];
}

export interface RouteQuoteFetchReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  readOnly: true;
  notExecutable: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  neverSigns: true;
  neverSends: true;
  phase7LiveTradingReady: false;
  providerId: string;
  endpointHost: string;
  /** REAL ISO timestamp of the pass (first request's clock value). */
  fetchedAt: string;
  requestedInputMint: string;
  requestedAmountRaw: string;
  requestedSlippageBps: number;
  candidateListRef: string | null;
  entryCount: number;
  observedCount: number;
  unavailableCount: number;
  blockedCount: number;
  errorCount: number;
  unsupportedCount: number;
  entries: RouteQuoteFetchEntry[];
  caveats: string[];
  warnings: string[];
}

export interface FetchQuotesForCandidatesOptions {
  /** Base request facts applied to every candidate (candidateMint comes from the list). */
  inputMint: string;
  amountRaw: string;
  slippageBps: number;
  /** Recorded on the report for provenance (e.g. the candidates file path). */
  candidateListRef?: string | null;
}

/**
 * Run the adapter over EVERY candidate in the list (sequentially — public quote endpoints are
 * rate-limited; one candidate's failure never aborts the batch) and fold the outcomes into a
 * fetch report. Duplicate mints get ONE fetch (first candidate wins; the rest reuse the result).
 */
export async function fetchQuotesForCandidates(
  adapter: QuoteProviderAdapter,
  candidateList: SniperCandidateList,
  options: FetchQuotesForCandidatesOptions,
): Promise<RouteQuoteFetchReport> {
  const entries: RouteQuoteFetchEntry[] = [];
  const warnings: string[] = [];
  const byMint = new Map<string, QuoteFetchResult>();
  let fetchedAt: string | null = null;

  for (const candidate of candidateList.candidates) {
    let result = byMint.get(candidate.mint);
    if (result === undefined) {
      const request: QuoteFetchRequest = {
        candidateMint: candidate.mint,
        inputMint: options.inputMint,
        amountRaw: options.amountRaw,
        slippageBps: options.slippageBps,
      };
      result = await adapter.fetchQuote(request);
      byMint.set(candidate.mint, result);
    }
    if (fetchedAt === null) fetchedAt = result.metadata.fetchedAt;
    entries.push({
      candidateId: candidate.candidateId,
      mint: candidate.mint,
      status: result.status,
      observation: result.observation,
      metadata: result.metadata,
    });
    if (result.status !== "quote-observed") {
      warnings.push(
        `candidate "${candidate.candidateId}" quote ${result.status}: ${result.metadata.statusDetail ?? "no detail"}`,
      );
    }
  }

  const tally = (s: RouteQuoteStatus): number => entries.filter((e) => e.status === s).length;

  return {
    schemaVersion: ROUTE_QUOTE_FETCH_REPORT_SCHEMA_VERSION,
    banner: ROUTE_QUOTE_FETCH_REPORT_BANNER,
    paperOnly: true,
    readOnly: true,
    notExecutable: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    providerId: adapter.providerId,
    endpointHost: adapter.endpointHost,
    fetchedAt: fetchedAt ?? "no-fetch-attempted",
    requestedInputMint: options.inputMint,
    requestedAmountRaw: options.amountRaw,
    requestedSlippageBps: options.slippageBps,
    candidateListRef: options.candidateListRef ?? null,
    entryCount: entries.length,
    observedCount: tally("quote-observed"),
    unavailableCount: tally("unavailable"),
    blockedCount: tally("blocked"),
    errorCount: tally("error"),
    unsupportedCount: tally("unsupported"),
    entries,
    caveats: [...ROUTE_QUOTE_FETCH_CAVEATS],
    warnings: warnings.map((w) => redactString(w).slice(0, 300)),
  };
}

/** Human-readable, redacted text summary of a fetch report. */
export function formatRouteQuoteFetchReport(report: RouteQuoteFetchReport): string {
  const lines: string[] = [];
  lines.push(report.banner);
  lines.push("");
  lines.push(`provider:      ${report.providerId} (${report.endpointHost})`);
  lines.push(`fetched at:    ${report.fetchedAt}`);
  lines.push(`request:       ${report.requestedAmountRaw} raw of ${report.requestedInputMint} -> each candidate @ ${report.requestedSlippageBps} bps`);
  lines.push(
    `outcomes:      ${report.observedCount} observed / ${report.unavailableCount} unavailable / ` +
      `${report.blockedCount} blocked / ${report.errorCount} error / ${report.unsupportedCount} unsupported (of ${report.entryCount})`,
  );
  lines.push("");
  for (const entry of report.entries) {
    const impact = entry.metadata.priceImpactPct !== null ? ` impact ${entry.metadata.priceImpactPct}%` : "";
    const venue = entry.metadata.routeLabels.length > 0 ? ` via ${entry.metadata.routeLabels.join(" > ")}` : "";
    lines.push(`  - ${entry.candidateId} [${entry.status}]${venue}${impact}`);
  }
  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("warnings:");
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  lines.push("");
  for (const caveat of report.caveats) lines.push(`CAVEAT: ${caveat}`);
  return redactString(lines.join("\n"));
}
