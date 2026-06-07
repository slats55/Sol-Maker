/** Report viewer page — sample report, artifact list, and the schema catalogue. */

import { html, type HtmlValue, type RawHtml } from "../lib/html.js";
import { navItem } from "../lib/nav.js";
import { KNOWN_REPORT_SCHEMAS } from "../lib/report-types.js";
import { SAMPLE_ARTIFACTS, SAMPLE_BACKTEST_REPORT } from "../lib/sample-data.js";
import { PageHeader } from "../components/layout.js";
import { Pill, Section } from "../components/ui.js";
import { DataTable, ReportTable } from "../components/tables.js";
import { ReportPlaceholder, ReportSchemaBadge, ReportSummaryCard } from "../components/reports.js";

function schemaTable(): RawHtml {
  const rows: readonly (readonly HtmlValue[])[] = KNOWN_REPORT_SCHEMAS.map((schema) => [
    ReportSchemaBadge(schema.id),
    schema.family,
    Pill(schema.stability, schema.stability === "stable" ? "safe" : "caution"),
    html`<code>${schema.cli}</code>`,
  ]);
  return DataTable({
    columns: [
      { header: "Schema" },
      { header: "Family" },
      { header: "Stability" },
      { header: "Emitted by" },
    ],
    rows,
    caption: "Report artifact schemas the viewer foundation recognizes.",
  });
}

export function renderReports(): RawHtml {
  const nav = navItem("reports");
  return html`
    ${PageHeader({ eyebrow: nav.group, title: "Report viewer", description: nav.description })}

    ${Section({
      title: "Sample report",
      description: "A representative backtest report summary, rendered from a labelled local fixture.",
      body: ReportSummaryCard(SAMPLE_BACKTEST_REPORT),
    })}

    ${Section({
      title: "Local artifacts",
      description: "How a list of generated report files would appear (sample fixture).",
      body: ReportTable(SAMPLE_ARTIFACTS),
    })}

    ${Section({
      title: "Load a report",
      description: "Where a real artifact would render once a local read bridge is wired.",
      body: ReportPlaceholder({
        title: "No report loaded",
        schemaId: "backtest.report.v1",
        message:
          "Point a future local file bridge at a generated report JSON to render it here. No upload, network, or backend import is wired today.",
      }),
    })}

    ${Section({
      title: "Known schemas",
      description: "Every schema the viewer can label. Emerging schemas are backend work-in-progress.",
      body: schemaTable(),
    })}
  `;
}
