/**
 * Table components: a generic data table, the mode capability matrix, and a
 * report-artifact table.
 */

import { html, type HtmlValue, type RawHtml } from "../lib/html.js";
import { MODES } from "../lib/safety.js";
import type { SampleArtifact } from "../lib/sample-data.js";
import { ReportSchemaBadge } from "./reports.js";

export type CellAlign = "left" | "right" | "center";

export interface TableColumn {
  readonly header: string;
  readonly align?: CellAlign;
}

export interface DataTableOptions {
  readonly columns: readonly TableColumn[];
  readonly rows: readonly (readonly HtmlValue[])[];
  readonly caption?: string;
  readonly emptyMessage?: string;
}

/** A generic, accessible data table. Renders an empty message when no rows. */
export function DataTable(opts: DataTableOptions): RawHtml {
  const colCount = opts.columns.length;
  return html`<div class="sm-tablewrap">
    <table class="sm-table">
      ${opts.caption ? html`<caption class="sm-table__caption">${opts.caption}</caption>` : null}
      <thead>
        <tr>
          ${opts.columns.map(
            (col) => html`<th scope="col" class="sm-td--${col.align ?? "left"}">${col.header}</th>`,
          )}
        </tr>
      </thead>
      <tbody>
        ${
          opts.rows.length === 0
            ? html`<tr>
                <td class="sm-table__empty" colspan="${colCount}">
                  ${opts.emptyMessage ?? "No rows."}
                </td>
              </tr>`
            : opts.rows.map(
                (row) => html`<tr>
                  ${row.map((cell, index) => {
                    const align = opts.columns[index]?.align ?? "left";
                    return html`<td class="sm-td--${align}">${cell}</td>`;
                  })}
                </tr>`,
              )
        }
      </tbody>
    </table>
  </div>`;
}

function bool(value: boolean, dangerWhenTrue: boolean): RawHtml {
  if (value) {
    const tone = dangerWhenTrue ? "danger" : "info";
    return html`<span class="sm-bool sm-bool--yes sm-bool--${tone}">yes</span>`;
  }
  return html`<span class="sm-bool sm-bool--no">no</span>`;
}

/** The mode capability matrix (key / reads / builds / simulates / sends). */
export function CapabilityTable(): RawHtml {
  const columns: readonly TableColumn[] = [
    { header: "Mode" },
    { header: "Needs key", align: "center" },
    { header: "Reads chain", align: "center" },
    { header: "Builds tx", align: "center" },
    { header: "Simulates", align: "center" },
    { header: "Sends", align: "center" },
  ];
  const rows: readonly (readonly HtmlValue[])[] = MODES.map((mode) => [
    html`<span class="sm-mode sm-mode--${mode.tone}">${mode.label}</span>`,
    bool(mode.needsKey, true),
    bool(mode.readsChain, false),
    bool(mode.buildsTx, true),
    bool(mode.simulates, false),
    bool(mode.sends, true),
  ]);
  return DataTable({
    columns,
    rows,
    caption: "Capabilities by mode (safest → most dangerous). Only DANGEROUS_BURNER_LIVE can send.",
  });
}

/** A table of (local) report artifacts. */
export function ReportTable(artifacts: readonly SampleArtifact[]): RawHtml {
  const columns: readonly TableColumn[] = [
    { header: "Artifact" },
    { header: "Kind" },
    { header: "Schema" },
  ];
  const rows: readonly (readonly HtmlValue[])[] = artifacts.map((artifact) => [
    html`<code>${artifact.name}</code>`,
    artifact.kind,
    ReportSchemaBadge(artifact.schema),
  ]);
  return DataTable({
    columns,
    rows,
    emptyMessage: "No local artifacts found.",
  });
}
