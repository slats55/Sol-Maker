/**
 * Artifact-inspector view components.
 *
 * Render a {@link NormalizedArtifact} (see ../lib/local-artifact.ts) as safe,
 * static HTML. Every untrusted value arrives as a plain string and is therefore
 * HTML-escaped by the `html` tagged template. Nothing here loads, fetches, or
 * parses a file — it only renders an already-normalized, already-bounded summary.
 */

import { html, type HtmlValue, type RawHtml } from "../lib/html.js";
import type { SchemaRecognition } from "../lib/report-types.js";
import type { NormalizedArtifact } from "../lib/local-artifact.js";
import { DataTable } from "./tables.js";
import { DefinitionList, Pill, RiskNotice, Section, type Tone } from "./ui.js";
import { ReportSchemaBadge } from "./reports.js";

/** Tone for a schema-recognition status. */
function statusTone(status: SchemaRecognition): Tone | "muted" {
  switch (status) {
    case "stable":
      return "safe";
    case "emerging":
      return "caution";
    case "unknown":
      return "danger";
    case "absent":
      return "muted";
  }
}

/** Friendly label for a schema-recognition status (never fakes knowledge). */
function statusLabel(status: SchemaRecognition): string {
  switch (status) {
    case "stable":
      return "known (stable)";
    case "emerging":
      return "emerging (backend work-in-progress)";
    case "unknown":
      return "unrecognized schema";
    case "absent":
      return "no schemaVersion field";
  }
}

/** A schema badge that also handles the "no schemaVersion present" case. */
export function ArtifactSchemaBadge(view: NormalizedArtifact): RawHtml {
  if (view.schemaVersion === null) {
    return html`<span class="sm-schema sm-schema--unknown" title="No schemaVersion field present">
      no <code>schemaVersion</code>
    </span>`;
  }
  return ReportSchemaBadge(view.schemaVersion);
}

function summarySection(view: NormalizedArtifact): RawHtml {
  const items: { term: string; detail: HtmlValue }[] = [
    { term: "kind", detail: view.kind },
    { term: "schema status", detail: statusLabel(view.schemaStatus) },
    { term: "root shape", detail: view.rootShape },
  ];
  for (const id of view.identity) {
    items.push({ term: id.key, detail: id.value });
  }
  if (view.digest) {
    items.push({ term: view.digest.key, detail: html`<code>${view.digest.value}</code>` });
  }
  return Section({
    title: "Summary",
    description: "High-level fields recognized from the artifact envelope.",
    body: DefinitionList(items),
  });
}

function warningsSection(view: NormalizedArtifact): RawHtml {
  if (view.warnings.length === 0) {
    return Section({
      title: "Warnings & disclaimers",
      body: html`<p class="sm-muted-line">No warning, disclaimer, or error fields were found.</p>`,
    });
  }
  return Section({
    title: "Warnings & disclaimers",
    body: RiskNotice({
      tone: "caution",
      title: `${view.warnings.length} warning / disclaimer field(s) reported by the artifact`,
      body: html`<ul class="sm-bullets sm-bullets--deny">
        ${view.warnings.map((text) => html`<li>${text}</li>`)}
      </ul>`,
    }),
  });
}

function scalarsSection(view: NormalizedArtifact): RawHtml {
  const rows: readonly (readonly HtmlValue[])[] = view.scalars.map((field) => [
    html`<code>${field.key}</code>`,
    field.truncated ? html`${field.value}<span class="sm-trunc"> … (truncated)</span>` : field.value,
    Pill(field.kind, "muted"),
  ]);
  return Section({
    title: "Fields",
    description: "Top-level scalar fields (strings, numbers, booleans). Long values are capped.",
    body: DataTable({
      columns: [{ header: "Field" }, { header: "Value" }, { header: "Type" }],
      rows,
      emptyMessage: "No top-level scalar fields.",
    }),
  });
}

function nestedSection(view: NormalizedArtifact): RawHtml {
  const rows: readonly (readonly HtmlValue[])[] = view.nested.map((field) => [
    html`<code>${field.key}</code>`,
    field.summary,
  ]);
  return Section({
    title: "Nested structures",
    description: "Objects and arrays are summarized, never dumped inline. See the raw preview below.",
    body: DataTable({
      columns: [{ header: "Key" }, { header: "Structure" }],
      rows,
      emptyMessage: "No nested objects or arrays at the top level.",
    }),
  });
}

function previewSection(view: NormalizedArtifact): RawHtml {
  const meta = view.preview.truncated
    ? `Showing the first ${view.preview.text.length} of ${view.preview.totalChars} characters.`
    : `${view.preview.totalChars} characters.`;
  return Section({
    title: "Raw preview (capped)",
    description: "A length-capped, escaped copy of the JSON. The full file is never executed.",
    body: html`<div class="sm-pre">
      <pre class="sm-pre__code"><code>${view.preview.text}</code></pre>
      <p class="sm-pre__meta">${meta}</p>
    </div>`,
  });
}

function notesSection(view: NormalizedArtifact): RawHtml | null {
  if (view.notes.length === 0) return null;
  return Section({
    title: "Inspector notes",
    description: "What the inspector capped, redacted, or found unusual.",
    body: html`<ul class="sm-bullets sm-bullets--plain">
      ${view.notes.map((note) => html`<li>${note}</li>`)}
    </ul>`,
  });
}

/** Full inspector view for a normalized local artifact. */
export function ArtifactReportView(view: NormalizedArtifact): RawHtml {
  return html`<div class="sm-artifactview">
    <div class="sm-artifactview__head">
      ${ArtifactSchemaBadge(view)}
      ${Pill(view.kind, statusTone(view.schemaStatus))}
      <span class="sm-pill sm-pill--muted">local · read-only</span>
    </div>

    ${summarySection(view)}
    ${warningsSection(view)}
    ${scalarsSection(view)}
    ${nestedSection(view)}
    ${previewSection(view)}
    ${notesSection(view)}

    <p class="sm-artifactview__note">
      Read-only, local, simulated paper artifact. Not a live result, not advice, not a profitability claim.
    </p>
  </div>`;
}
