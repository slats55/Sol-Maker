/** Suite coverage viewer page (foundation). */

import { html, type RawHtml } from "../lib/html.js";
import { navItem, ICONS } from "../lib/nav.js";
import { PageHeader } from "../components/layout.js";
import { BulletList, EmptyState, RiskNotice, Section } from "../components/ui.js";
import { ReportPlaceholder } from "../components/reports.js";

const BEHAVIOURS: readonly string[] = [
  "PAPER_BUY_CANDIDATE entered (a simulated buy was opened)",
  "PAPER_SELL_CANDIDATE / exits: FULL_EXIT, PARTIAL_EXIT, HOLD",
  "Take-profit / stop-loss / trailing-stop triggers fired",
  "Rejections (risk gate, caps, or kill switch blocked an action)",
  "Open vs. closed positions at end of run",
];

export function renderCoverage(): RawHtml {
  const nav = navItem("coverage");
  return html`
    ${PageHeader({ eyebrow: nav.group, title: "Suite coverage", description: nav.description })}

    ${RiskNotice({
      tone: "info",
      title: "Behavioural bookkeeping — not market or test coverage.",
      body: html`Coverage (<code>backtest.coverage.v1</code>) reports which simulated paper behaviours a suite
        exercised across injected scenarios. It is <strong>not</strong> market coverage, <strong>not</strong>
        code/test coverage, and <strong>not</strong> a profitability claim.`,
    })}

    ${Section({
      title: "Coverage viewer",
      body: ReportPlaceholder({
        title: "No coverage report loaded",
        schemaId: "backtest.coverage.v1",
        message:
          "Generate coverage with paper:backtest:suite:coverage over a suite index, then view it here once a local read bridge is wired.",
      }),
    })}

    ${Section({
      title: "What a coverage report tracks",
      description: "The kinds of simulated paper behaviours summarized per suite.",
      body: BulletList(BEHAVIOURS, "plain"),
    })}

    ${Section({
      title: "Status",
      body: EmptyState({
        icon: ICONS.layers,
        title: "Nothing to display yet",
        message: "No local coverage artifact is loaded, and loading is intentionally not wired.",
      }),
    })}
  `;
}
