/** Research lab page — explains the PAPER-only research pipeline. */

import { html, type RawHtml } from "../lib/html.js";
import { navItem } from "../lib/nav.js";
import { PageHeader } from "../components/layout.js";
import { RiskNotice, Section } from "../components/ui.js";

interface PipelineStep {
  readonly step: string;
  readonly command: string;
  readonly text: string;
}

const PIPELINE: readonly PipelineStep[] = [
  { step: "1", command: "strategy:plan", text: "Turn injected candidates into a PaperCandidate[] plan (manual hand-off)." },
  { step: "2", command: "paper:run", text: "Simulate buys/sells against injected prices into an append-only journal." },
  { step: "3", command: "paper:backtest", text: "Replay one injected scenario into a deterministic, byte-stable report." },
  { step: "4", command: "paper:backtest:suite", text: "Run a directory of scenarios into a suite index." },
  { step: "5", command: "paper:backtest:sensitivity", text: "Perturb a base scenario and report per-variant deltas vs the baseline." },
  { step: "6", command: "paper:backtest:suite:coverage", text: "Report which simulated paper behaviours a suite exercised." },
];

function StepRow(step: PipelineStep): RawHtml {
  return html`<li class="sm-step">
    <span class="sm-step__num" aria-hidden="true">${step.step}</span>
    <div class="sm-step__body">
      <code class="sm-step__cmd">${step.command}</code>
      <p class="sm-step__text">${step.text}</p>
    </div>
  </li>`;
}

export function renderResearch(): RawHtml {
  const nav = navItem("research");
  return html`
    ${PageHeader({ eyebrow: nav.group, title: "Research lab", description: nav.description })}

    ${RiskNotice({
      tone: "info",
      title: "Simulated paper research only.",
      body: html`Every step below runs on <strong>injected local data</strong> through the same deterministic
        code paths. There is no chain access, no wallet, no network, and no transaction. Outputs are
        bookkeeping over simulations — not live results, not advice, not profitability claims.`,
    })}

    ${Section({
      title: "The pipeline",
      description: "From a candidate plan to coverage — all offline and reproducible.",
      body: html`<ol class="sm-steps">${PIPELINE.map((step) => StepRow(step))}</ol>`,
    })}

    ${Section({
      title: "Viewable artifacts",
      description: "The viewer foundation surfaces these locally-generated report families.",
      body: html`<div class="sm-jumpgrid">
        <a class="sm-jump" href="research-reports.html">
          <span class="sm-jump__title">Report viewer</span>
          <span class="sm-jump__desc">backtest.report.v1, suite.v1, sensitivity.v1 …</span>
          <span class="sm-jump__arrow" aria-hidden="true">→</span>
        </a>
        <a class="sm-jump" href="research-matrix.html">
          <span class="sm-jump__title">Sensitivity matrix</span>
          <span class="sm-jump__desc">Cross-scenario matrix (emerging).</span>
          <span class="sm-jump__arrow" aria-hidden="true">→</span>
        </a>
        <a class="sm-jump" href="research-coverage.html">
          <span class="sm-jump__title">Suite coverage</span>
          <span class="sm-jump__desc">Which simulated behaviours ran.</span>
          <span class="sm-jump__arrow" aria-hidden="true">→</span>
        </a>
      </div>`,
    })}
  `;
}
