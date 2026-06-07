/** Overview / cockpit landing page. */

import { html, type RawHtml } from "../lib/html.js";
import { navItem } from "../lib/nav.js";
import { SAMPLE_METRICS, SAMPLE_STATUS_CARDS } from "../lib/sample-data.js";
import { ModeBadge, PageHeader } from "../components/layout.js";
import { MetricCard, Pill, RiskNotice, Section, StatusCard } from "../components/ui.js";
import { CapabilityTable } from "../components/tables.js";

function JumpCard(href: string, title: string, desc: string): RawHtml {
  return html`<a class="sm-jump" href="${href}">
    <span class="sm-jump__title">${title}</span>
    <span class="sm-jump__desc">${desc}</span>
    <span class="sm-jump__arrow" aria-hidden="true">→</span>
  </a>`;
}

export function renderOverview(): RawHtml {
  const nav = navItem("overview");
  return html`
    ${PageHeader({
      eyebrow: nav.group,
      title: "Cockpit overview",
      description: nav.description,
      aside: ModeBadge("PAPER", { showStatus: true }),
    })}

    <div class="sm-cardgrid">
      ${SAMPLE_STATUS_CARDS.map((card) =>
        StatusCard({
          label: card.label,
          value: card.value,
          tone: card.tone,
          note: card.note,
          sample: true,
        }),
      )}
    </div>

    ${Section({
      title: "Foundation at a glance",
      description: "Counts of the research scaffolding this dashboard surfaces — no money, no performance.",
      body: html`<div class="sm-metricgrid">
        ${SAMPLE_METRICS.map((metric) =>
          MetricCard({ label: metric.label, value: metric.value, hint: metric.hint, sample: true }),
        )}
      </div>`,
    })}

    ${RiskNotice({
      tone: "info",
      title: "This is a cockpit, not a live trader.",
      body: html`Everything shown is local, simulated, and clearly labelled. The dashboard never connects a
        wallet, signs, sends, or fetches live data. Research artifacts are produced by the
        <a href="commands.html">CLI</a>, then viewed here.`,
    })}

    ${Section({
      title: "Modes",
      description:
        "Soulmaker is PAPER by default. Only DANGEROUS_BURNER_LIVE can ever send — and it is gated and not started.",
      aside: Pill("safe by default", "safe"),
      body: CapabilityTable(),
    })}

    ${Section({
      title: "Jump in",
      body: html`<div class="sm-jumpgrid">
        ${JumpCard("research.html", "Research lab", "Scenarios, backtests, suites, sensitivity.")}
        ${JumpCard("research-reports.html", "Report viewer", "Inspect local backtest report artifacts.")}
        ${JumpCard("commands.html", "Command reference", "The real CLI workflows behind the artifacts.")}
        ${JumpCard("safety.html", "Safety & modes", "The wallet-safety model and hard guarantees.")}
      </div>`,
    })}
  `;
}
