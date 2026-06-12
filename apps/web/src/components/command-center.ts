/**
 * Sniper Command Center render components (Sprint 90).
 *
 * Pure {@link RawHtml} builders over the pure models in ../lib/command-center.ts:
 * the capability strip, the safe pipeline flow, the candidate intelligence
 * table, and the observability panel. Used by both the static Sniper Command
 * Center page (committed sample fixture) and the loaded folder index
 * (`pnpm web:inspect --dir` over a real run). All untrusted artifact content
 * goes through the escaping `html` template — displayed, never executed.
 */

import { html, type HtmlValue, type RawHtml } from "../lib/html.js";
import { truncateText } from "../lib/json-access.js";
import type {
  CandidateRow,
  CandidateRowsResult,
  ObservabilityFact,
  PipelineStage,
  SniperCapability,
  StageState,
} from "../lib/command-center.js";
import { Pill, Section } from "./ui.js";
import { DataTable } from "./tables.js";

const DASH = "—";

/* ------------------------------------------------------------------ *
 * Capability strip.
 * ------------------------------------------------------------------ */

function capabilityPill(state: SniperCapability["state"]): RawHtml {
  switch (state) {
    case "available":
      return Pill("available", "safe");
    case "boundary-only":
      return Pill("boundary only", "caution");
    case "disabled":
      return Pill("disabled / unauthorized", "muted");
  }
}

/** The honest capability strip. `sample` is irrelevant here — this is the static truth. */
export function CapabilityStrip(capabilities: readonly SniperCapability[]): RawHtml {
  return html`<div class="sm-capstrip">
    ${capabilities.map(
      (cap) => html`<div class="sm-capstrip__item sm-capstrip__item--${cap.state}" title="${cap.note}">
        <span class="sm-capstrip__label">${cap.label}</span>
        ${capabilityPill(cap.state)}
      </div>`,
    )}
  </div>`;
}

/* ------------------------------------------------------------------ *
 * Pipeline flow.
 * ------------------------------------------------------------------ */

function stageTone(state: StageState): "safe" | "caution" | "danger" | "muted" {
  switch (state) {
    case "complete":
      return "safe";
    case "blocked":
      return "danger";
    case "review":
      return "caution";
    case "unavailable":
    case "not-run":
      return "muted";
  }
}

/** Human label for a stage state ("review" reads as "review required"). */
function stageStateLabel(state: StageState): string {
  switch (state) {
    case "review":
      return "review required";
    case "not-run":
      return "not run";
    default:
      return state;
  }
}

function stageChip(stage: PipelineStage): RawHtml {
  const body = html`<span class="sm-stage__name">${stage.label}</span>
    ${Pill(stageStateLabel(stage.state), stageTone(stage.state))}`;
  return stage.anchor !== null
    ? html`<a class="sm-stage sm-stage--${stage.state}" href="#${stage.anchor}" title="${stage.detail}">${body}</a>`
    : html`<span class="sm-stage sm-stage--${stage.state}" title="${stage.detail}">${body}</span>`;
}

/** The safe pipeline visualization: stage chips joined by arrows, plus the detail list. */
export function PipelineFlow(stages: readonly PipelineStage[]): RawHtml {
  return html`<div class="sm-pipeline">
      ${stages.map((stage, i) =>
        i === 0
          ? stageChip(stage)
          : html`<span class="sm-pipeline__arrow" aria-hidden="true">→</span>${stageChip(stage)}`,
      )}
    </div>
    <ul class="sm-bullets sm-bullets--plain sm-pipeline__details">
      ${stages.map((stage) => html`<li><strong>${stage.label}</strong> — ${stage.detail}</li>`)}
    </ul>`;
}

/* ------------------------------------------------------------------ *
 * Candidate intelligence table.
 * ------------------------------------------------------------------ */

/** Max characters of a mint shown in a cell (full value stays in the title attribute). */
const MINT_DISPLAY_MAX = 12;

function mintCell(mint: string | null): HtmlValue {
  if (mint === null) return DASH;
  return html`<code class="sm-digest" title="${mint}">${truncateText(mint, MINT_DISPLAY_MAX)}</code>`;
}

function preflightCell(status: string | null): HtmlValue {
  switch (status) {
    case "pass":
      return Pill("pass", "safe");
    case "warn":
      return Pill("warn", "caution");
    case "fail":
      return Pill("fail", "danger");
    case "unknown":
      return Pill("unknown", "muted");
    default:
      return DASH;
  }
}

function riskCell(row: CandidateRow): HtmlValue {
  if (row.riskDecision === null && row.riskScore === null) return DASH;
  const score = row.riskScore === null ? "?" : String(row.riskScore);
  const critical =
    row.criticalFlagCount !== null && row.criticalFlagCount > 0
      ? html` <span class="sm-pill sm-pill--danger">${String(row.criticalFlagCount)} critical</span>`
      : null;
  return html`<span title="advisory risk projection — never a buy signal">${row.riskDecision ?? "?"} (score ${score})</span>${critical}`;
}

function decisionCell(decision: string | null): HtmlValue {
  switch (decision) {
    case "paper-enter":
      return Pill("paper-enter (simulated)", "caution");
    case "paper-reject":
      return Pill("paper-reject", "danger");
    case "watch":
      return Pill("watch", "info");
    case "skip":
      return Pill("skip", "muted");
    case "unknown":
      return Pill("unknown", "muted");
    default:
      return DASH;
  }
}

/** The screener-style candidate table. No prices, no PnL — artifact facts only. */
export function CandidateIntelTable(result: CandidateRowsResult): RawHtml {
  const rows: readonly (readonly HtmlValue[])[] = result.rows.map((row) => [
    html`<span title="${row.candidateId}">${row.label}</span>`,
    mintCell(row.mint),
    preflightCell(row.preflightStatus),
    riskCell(row),
    decisionCell(row.decision),
    row.blockingCodes.length === 0
      ? DASH
      : html`${row.blockingCodes.map((code, i) => (i > 0 ? html` <code>${code}</code>` : html`<code>${code}</code>`))}`,
    row.nextAction,
  ]);
  return html`${DataTable({
    columns: [
      { header: "Candidate" },
      { header: "Mint" },
      { header: "Preflight" },
      { header: "Risk (advisory)" },
      { header: "Decision" },
      { header: "Blocking codes" },
      { header: "Next action" },
    ],
    rows,
    emptyMessage: "No candidate rows could be read from this folder's artifacts.",
    caption:
      "Joined from the run's own candidate list, preflight report, and decision report. A paper-enter is a SIMULATED classification — never an order.",
  })}
  ${result.hidden > 0 ? html`<p class="sm-muted-line">${String(result.hidden)} more candidate(s) not shown.</p>` : null}`;
}

/* ------------------------------------------------------------------ *
 * Observability panel.
 * ------------------------------------------------------------------ */

/** Artifact-derived observability facts as a compact table. */
export function ObservabilityPanel(facts: readonly ObservabilityFact[]): RawHtml {
  const rows: readonly (readonly HtmlValue[])[] = facts.map((fact) => [
    fact.label,
    html`<strong>${fact.value}</strong>`,
    fact.note ?? DASH,
  ]);
  return DataTable({
    columns: [{ header: "Fact" }, { header: "Value" }, { header: "Note" }],
    rows,
    caption: "Every value is read from this run's own artifacts — absent facts say so instead of being invented.",
  });
}

/* ------------------------------------------------------------------ *
 * Section wrappers (shared titles/descriptions between page + folder view).
 * ------------------------------------------------------------------ */

export function CapabilitySection(capabilities: readonly SniperCapability[]): RawHtml {
  return Section({
    title: "Capabilities",
    description:
      "The honest capability strip: what exists, what is a boundary, and what is deliberately disabled.",
    body: CapabilityStrip(capabilities),
  });
}

export function PipelineSection(stages: readonly PipelineStage[]): RawHtml {
  return Section({
    title: "Pipeline",
    description:
      "Candidate → Inspect → Risk → Paper decision → Plan → Route boundary → Audit → Handoff → Bundle. Each stage's state is derived from this run's own artifacts.",
    body: PipelineFlow(stages),
  });
}

export function CandidateIntelSection(result: CandidateRowsResult): RawHtml {
  return Section({
    title: "Candidate intelligence",
    description:
      "Per-candidate state from intake through decision. No prices, no PnL, no fake liquidity — only what the artifacts carry.",
    body: CandidateIntelTable(result),
  });
}

export function ObservabilitySection(facts: readonly ObservabilityFact[]): RawHtml {
  return Section({
    title: "Observability",
    description: "Run identity, integrity, and boundary signals — artifact-derived facts only.",
    body: ObservabilityPanel(facts),
  });
}
