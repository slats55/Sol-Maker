/**
 * Report-viewer foundation components: a schema badge, a summary card, and a
 * placeholder for not-yet-loaded artifacts.
 *
 * These render typed, frontend-only data (see ../lib/report-types.ts and
 * ../lib/sample-data.ts). Nothing here loads, fetches, or parses a real file.
 */

import { html, type RawHtml } from "../lib/html.js";
import { knownSchema } from "../lib/report-types.js";
import type { SampleReportSummary } from "../lib/sample-data.js";
import { SampleBadge } from "./ui.js";

/** A badge for a report schema id; distinguishes known / emerging / unknown. */
export function ReportSchemaBadge(schemaId: string): RawHtml {
  const info = knownSchema(schemaId);
  if (!info) {
    return html`<span class="sm-schema sm-schema--unknown" title="Unrecognized schema id">
      <code>${schemaId}</code> · unknown
    </span>`;
  }
  const cls = info.stability === "stable" ? "sm-schema--stable" : "sm-schema--emerging";
  const suffix = info.stability === "emerging" ? " · emerging" : "";
  return html`<span class="sm-schema ${cls}" title="${info.description}">
    <code>${info.id}</code>${suffix}
  </span>`;
}

/** A summary card for a (sample) report envelope. */
export function ReportSummaryCard(summary: SampleReportSummary): RawHtml {
  const schema = summary.envelope.schemaVersion ?? "(no schemaVersion)";
  const digest = summary.envelope.scenarioDigest ?? "—";
  return html`<article class="sm-report">
    <div class="sm-report__head">
      ${ReportSchemaBadge(schema)}
      ${SampleBadge()}
    </div>
    <dl class="sm-report__grid">
      ${summary.metrics.map(
        (metric) => html`<div class="sm-report__cell">
          <dt>${metric.label}</dt>
          <dd>${metric.value}</dd>
        </div>`,
      )}
    </dl>
    <p class="sm-report__digest">scenarioDigest: <code>${digest}</code></p>
    <p class="sm-report__note">
      Simulated paper-only artifact. Not a live result, not advice, not a profitability claim.
    </p>
  </article>`;
}

export interface ReportPlaceholderOptions {
  readonly title: string;
  readonly schemaId?: string;
  readonly message: string;
}

/** A placeholder shown where a real artifact would render once load is wired. */
export function ReportPlaceholder(opts: ReportPlaceholderOptions): RawHtml {
  return html`<div class="sm-placeholder">
    <div class="sm-placeholder__head">
      <h3 class="sm-placeholder__title">${opts.title}</h3>
      ${opts.schemaId ? ReportSchemaBadge(opts.schemaId) : null}
    </div>
    <p class="sm-placeholder__message">${opts.message}</p>
    <p class="sm-placeholder__hint">
      No file is loaded. This is a viewer foundation — file loading is intentionally
      not wired yet (no upload, no network, no backend import).
    </p>
  </div>`;
}
