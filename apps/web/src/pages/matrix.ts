/** Sensitivity matrix viewer page (foundation — emerging backend schema). */

import { html, type RawHtml } from "../lib/html.js";
import { navItem } from "../lib/nav.js";
import { PageHeader } from "../components/layout.js";
import { EmptyState, RiskNotice, Section } from "../components/ui.js";
import { ICONS } from "../lib/nav.js";
import { ReportPlaceholder } from "../components/reports.js";

export function renderMatrix(): RawHtml {
  const nav = navItem("matrix");
  return html`
    ${PageHeader({ eyebrow: nav.group, title: "Sensitivity matrix", description: nav.description })}

    ${RiskNotice({
      tone: "caution",
      title: "Emerging schema.",
      body: html`The cross-scenario sensitivity matrix is backend research work-in-progress
        (<code>backtest.sensitivity.matrix.v1</code>). This page is a labelled placeholder so the viewer
        is ready once the schema stabilizes. It loads nothing and asserts nothing about results.`,
    })}

    ${Section({
      title: "Matrix viewer",
      body: ReportPlaceholder({
        title: "No matrix loaded",
        schemaId: "backtest.sensitivity.matrix.v1",
        message:
          "A sensitivity matrix compares each scenario against each perturbation. The grid renderer will live here once the schema is finalized.",
      }),
    })}

    ${Section({
      title: "Status",
      body: EmptyState({
        icon: ICONS.grid,
        title: "Nothing to display yet",
        message: "No local matrix artifact is loaded, and matrix loading is intentionally not wired.",
      }),
    })}
  `;
}
