/** Sensitivity matrix viewer page (foundation; schema shipped — grid lives in the inspector). */

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
      tone: "info",
      title: "Shipped schema — inspect a matrix in the artifact inspector.",
      body: html`The cross-scenario sensitivity matrix (<code>backtest.sensitivity.matrix.v1</code>) is a
        shipped, stable schema, produced by <code>paper:backtest:sensitivity:matrix</code>. The
        <a href="research-artifact.html">artifact inspector</a> renders a typed
        <strong>base × variant grid</strong> for a local matrix JSON. This page stays a foundation
        placeholder: it loads nothing, makes no network call, and asserts nothing about results.`,
    })}

    ${Section({
      title: "Matrix viewer",
      body: ReportPlaceholder({
        title: "No matrix loaded",
        schemaId: "backtest.sensitivity.matrix.v1",
        message:
          "A sensitivity matrix compares each base scenario against each variant. Render one locally with `pnpm web:inspect --input <matrix>.json` — the inspector draws the base × variant grid.",
      }),
    })}

    ${Section({
      title: "Status",
      body: EmptyState({
        icon: ICONS.grid,
        title: "Nothing to display here",
        message: "This page loads no artifact; use the artifact inspector to render a local matrix grid.",
      }),
    })}
  `;
}
