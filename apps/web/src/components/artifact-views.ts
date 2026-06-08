/**
 * Schema-aware artifact views + the renderer dispatch layer.
 *
 * Given a {@link NormalizedArtifact} (for the recognized schemaVersion) and the
 * RAW parsed JSON value, {@link renderTypedArtifactView} selects a typed renderer
 * for the declared schema and produces a safe, bounded HTML summary. When no
 * typed renderer applies — unknown schema, or the value is not the object shape a
 * schema expects — it returns `null`, and the caller falls back to the generic
 * normalized view (see ./artifact.ts).
 *
 * Safety contract (mirrors the rest of apps/web):
 *   - Every untrusted value is read defensively (see ../lib/json-access.ts) and
 *     interpolated as a PLAIN string, so the `html` tagged template escapes it.
 *     Nothing here is ever wrapped in `raw()`.
 *   - Renderers NEVER throw: missing / type-mismatched fields render as “—”, and
 *     the dispatcher wraps every build in a try/catch that falls back to generic.
 *   - Tables and lists are row-capped; long strings and digests are elided.
 *   - These are typed PRESENTATION views only. No backend import, no file/network/
 *     chain/wallet activity, no execution of artifact content.
 */

import { html, type HtmlValue, type RawHtml } from "../lib/html.js";
import type { NormalizedArtifact } from "../lib/local-artifact.js";
import {
  TYPED_VIEW_LIMITS,
  asArray,
  asRecord,
  capRows,
  formatBytes,
  formatNumber,
  formatSigned,
  readArray,
  readBoolean,
  readDelta,
  readNumber,
  readRecord,
  readString,
  readStringArray,
  shortDigest,
  type CapInfo,
  type NumberDelta,
  type StringListRead,
} from "../lib/json-access.js";
import { DataTable, type TableColumn } from "./tables.js";
import { DefinitionList, RiskNotice, Section } from "./ui.js";

const DASH = "—";

/* ------------------------------------------------------------------ *
 * Small display helpers (all return PLAIN strings or pre-escaped RawHtml).
 * ------------------------------------------------------------------ */

const text = (value: string | null): string => value ?? DASH;
const num = (value: number | null): string => (value === null ? DASH : formatNumber(value));
const signed = (value: number | null): string => (value === null ? DASH : formatSigned(value));
const bytes = (value: number | null): string => (value === null ? DASH : formatBytes(value));
const boolText = (value: boolean | null): string => (value === null ? DASH : value ? "yes" : "no");

const code = (value: string | null): HtmlValue => (value === null ? DASH : html`<code>${value}</code>`);

/** A `<code>` cell that elides long digests but keeps the full value in a title. */
const digestCode = (value: string | null): HtmlValue =>
  value === null ? DASH : html`<code class="sm-digest" title="${value}">${shortDigest(value)}</code>`;

/** Render a `{ base, next, delta }` delta as "base → next (Δ)". */
const deltaCell = (delta: NumberDelta | null): HtmlValue =>
  delta === null ? DASH : `${num(delta.base)} → ${num(delta.next)} (${signed(delta.delta)})`;

/**
 * Render a FLAT `{ base, next, delta }` row (the count-change shape used by the
 * research diff schemas, where base/next/delta are direct fields of the entry)
 * as "base → next (Δ)". Reads each member defensively.
 */
const flatDeltaCell = (rec: Record<string, unknown>): HtmlValue =>
  `${num(readNumber(rec, "base"))} → ${num(readNumber(rec, "next"))} (${signed(readNumber(rec, "delta"))})`;

/** Record a field as missing when it could not be read; pass the value through. */
function need<T>(missing: string[], label: string, value: T | null): T | null {
  if (value === null) missing.push(label);
  return value;
}

/** A caption noting how many rows were hidden by the row cap, if any. */
function capCaption(cap: CapInfo<unknown>, noun: string): string | undefined {
  return cap.hidden > 0
    ? `Showing ${cap.shown.length} of ${cap.total} ${noun} — ${cap.hidden} more not shown.`
    : undefined;
}

/** A definition-list Section. */
function kvSection(
  title: string,
  description: string | undefined,
  items: readonly { readonly term: string; readonly detail: HtmlValue }[],
): RawHtml {
  return Section({ title, description, body: DefinitionList(items) });
}

/** A data-table Section with an optional row-cap caption. */
function tableSection(opts: {
  readonly title: string;
  readonly description?: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly (readonly HtmlValue[])[];
  readonly empty: string;
  readonly caption?: string;
}): RawHtml {
  return Section({
    title: opts.title,
    description: opts.description,
    body: DataTable({
      columns: opts.columns,
      rows: opts.rows,
      caption: opts.caption,
      emptyMessage: opts.empty,
    }),
  });
}

/** A visible notice listing expected fields the inspector could not read. */
function partialNotice(missing: readonly string[]): RawHtml | null {
  if (missing.length === 0) return null;
  const shown = missing.slice(0, TYPED_VIEW_LIMITS.maxMissingListed);
  const extra = missing.length - shown.length;
  const list = extra > 0 ? `${shown.join(", ")}, +${extra} more` : shown.join(", ");
  return RiskNotice({
    tone: "caution",
    title: "Partial view — some expected fields were not present",
    body: html`This artifact declared a recognized schema, but the inspector could not read:
      <code>${list}</code>. Such fields render as “${DASH}”. The generic field view and the raw
      preview below always show exactly what the file contains.`,
  });
}

/** A regression / change status notice driven by a boolean flag + reasons. */
function flagNotice(opts: {
  readonly flag: boolean | null;
  readonly trueTitle: string;
  readonly falseTitle: string;
  readonly absentTitle: string;
  readonly trueTone: "caution" | "info";
  readonly reasons: StringListRead;
  readonly falseBody: HtmlValue;
}): RawHtml {
  if (opts.flag === true) {
    return RiskNotice({
      tone: opts.trueTone,
      title: opts.trueTitle,
      body:
        opts.reasons.items.length > 0
          ? html`<ul class="sm-bullets sm-bullets--deny">
              ${opts.reasons.items.map((reason) => html`<li>${reason}</li>`)}
            </ul>`
          : html`No specific reasons were listed by the artifact.`,
    });
  }
  if (opts.flag === false) {
    return RiskNotice({ tone: "info", title: opts.falseTitle, body: opts.falseBody });
  }
  return RiskNotice({
    tone: "caution",
    title: opts.absentTitle,
    body: html`The flag was absent or not a boolean; treat this comparison as unknown.`,
  });
}

/** Echo the artifact's own self-declared paper-only posture (from its data). */
function selfDeclaredNote(record: Record<string, unknown>): RawHtml | null {
  const banner = readString(record, "banner");
  const paperOnly = readBoolean(record, "paperOnly");
  const simulated = readBoolean(record, "simulated");
  if (banner === null && paperOnly === null && simulated === null) return null;
  return html`<p class="sm-typedview__self sm-muted-line">
    ${banner !== null ? html`<span class="sm-typedview__banner">${banner}</span> ` : null}
    ${
      paperOnly !== null || simulated !== null
        ? html`<span>self-declared — paperOnly: ${boolText(paperOnly)} · simulated: ${boolText(simulated)}</span>`
        : null
    }
  </p>`;
}

/* ------------------------------------------------------------------ *
 * Priority 1 — report, suite, sensitivity, sensitivity diff.
 * ------------------------------------------------------------------ */

function renderReportView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const scenarioName = need(missing, "scenarioName", readString(rec, "scenarioName"));
  const scenarioDigest = need(missing, "scenarioDigest", readString(rec, "scenarioDigest"));
  const stepCount = need(missing, "stepCount", readNumber(rec, "stepCount"));
  const totalCandidateCount = need(missing, "totalCandidateCount", readNumber(rec, "totalCandidateCount"));
  const simulatedNotionalUsd = readNumber(rec, "simulatedNotionalUsd");

  const plan = readRecord(rec, "planCounts");
  const fills = readRecord(rec, "fillCounts");
  const positions = readRecord(rec, "positionCounts");
  const rejected = readRecord(rec, "rejectedCounts");
  const pnl = need(missing, "pnl", readRecord(rec, "pnl"));

  const planRows: readonly (readonly HtmlValue[])[] = plan
    ? [
        ["paper buy candidates", num(readNumber(plan, "paperBuyCandidateCount"))],
        ["paper sell candidates", num(readNumber(plan, "paperSellCandidateCount"))],
        ["watch", num(readNumber(plan, "watchCount"))],
        ["skipped", num(readNumber(plan, "skippedCount"))],
        ["rejected", num(readNumber(plan, "rejectedCount"))],
      ]
    : [];

  const flowRows: readonly (readonly HtmlValue[])[] = [
    ["buy fills", num(fills ? readNumber(fills, "buyCount") : null)],
    ["sell fills", num(fills ? readNumber(fills, "sellCount") : null)],
    ["open positions", num(positions ? readNumber(positions, "open") : null)],
    ["closed positions", num(positions ? readNumber(positions, "closed") : null)],
    ["rejected (total)", num(rejected ? readNumber(rejected, "total") : null)],
  ];

  const pnlRows: readonly (readonly HtmlValue[])[] = [
    ["realized", num(pnl ? readNumber(pnl, "realizedUsd") : null)],
    ["unrealized", num(pnl ? readNumber(pnl, "unrealizedUsd") : null)],
    ["total", num(pnl ? readNumber(pnl, "totalUsd") : null)],
  ];

  return html`
    ${kvSection("Run identity", "Scenario replayed into this deterministic simulated report.", [
      { term: "scenarioName", detail: text(scenarioName) },
      { term: "scenarioDigest", detail: digestCode(scenarioDigest) },
      { term: "stepCount", detail: num(stepCount) },
      { term: "totalCandidateCount", detail: num(totalCandidateCount) },
      { term: "simulatedNotionalUsd", detail: `${num(simulatedNotionalUsd)} (simulated · not real)` },
    ])}
    ${tableSection({
      title: "Plan breakdown",
      description: "Counts of paper-only decisions (no orders are ever placed).",
      columns: [{ header: "Decision" }, { header: "Count", align: "right" }],
      rows: planRows,
      empty: "planCounts not present.",
    })}
    ${tableSection({
      title: "Fills, positions & rejections",
      columns: [{ header: "Measure" }, { header: "Count", align: "right" }],
      rows: flowRows,
      empty: "No fill/position counts present.",
    })}
    ${tableSection({
      title: "Simulated PnL (not real, not advice)",
      columns: [{ header: "PnL (USD)" }, { header: "Value", align: "right" }],
      rows: pnlRows,
      empty: "pnl not present.",
    })}
    ${partialNotice(missing)}
  `;
}

function renderSuiteView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const name = readString(rec, "name");
  const summary = need(missing, "summary", readRecord(rec, "summary"));
  const entries = readArray(rec, "entries") ?? [];

  const s = summary ?? {};
  const totalsRows: readonly (readonly HtmlValue[])[] = [
    ["total fills", num(readNumber(s, "totalFills"))],
    ["total rejects", num(readNumber(s, "totalRejects"))],
    ["open positions", num(readNumber(s, "totalOpenPositions"))],
    ["closed trades", num(readNumber(s, "totalClosedTrades"))],
    ["simulated PnL (not real)", num(readNumber(s, "totalSimulatedPnlUsd"))],
    ["simulated notional", num(readNumber(s, "totalSimulatedNotionalUsd"))],
  ];

  const cap = capRows(entries);
  const entryRows: readonly (readonly HtmlValue[])[] = cap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      num(readNumber(e, "index")),
      text(readString(e, "scenarioName") ?? readString(e, "id")),
      text(readString(e, "status")),
      text(readString(e, "runStatus")),
      text(readString(e, "lintStatus")),
    ];
  });

  return html`
    ${kvSection("Suite", "Aggregated index over a directory of injected scenarios.", [
      { term: "name", detail: text(name) },
      { term: "scenarioCount", detail: num(summary ? readNumber(summary, "scenarioCount") : null) },
      { term: "passedCount", detail: num(summary ? readNumber(summary, "passedCount") : null) },
      { term: "failedCount", detail: num(summary ? readNumber(summary, "failedCount") : null) },
      { term: "warningCount", detail: num(summary ? readNumber(summary, "warningCount") : null) },
    ])}
    ${tableSection({
      title: "Simulated totals (not real, not advice)",
      columns: [{ header: "Measure" }, { header: "Value", align: "right" }],
      rows: totalsRows,
      empty: "summary not present.",
    })}
    ${tableSection({
      title: "Scenarios",
      columns: [
        { header: "#", align: "right" },
        { header: "Scenario" },
        { header: "Status" },
        { header: "Run" },
        { header: "Lint" },
      ],
      rows: entryRows,
      empty: "No entries present.",
      caption: capCaption(cap, "scenarios"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderSensitivityView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const planName = readString(rec, "planName") ?? readString(rec, "label");
  const baseScenarioName = need(missing, "baseScenarioName", readString(rec, "baseScenarioName"));
  const baseScenarioDigest = readString(rec, "baseScenarioDigest");
  const variantCount = need(missing, "variantCount", readNumber(rec, "variantCount"));

  const rankings = readRecord(rec, "rankings");
  const topMovers = rankings ? (asArray(rankings["byTotalSimulatedPnlDelta"]) ?? []) : [];
  const moverCap = capRows(topMovers);
  const moverRows: readonly (readonly HtmlValue[])[] = moverCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [text(readString(e, "suffix")), signed(readNumber(e, "value")), num(readNumber(e, "magnitude"))];
  });

  const variants = readArray(rec, "variants") ?? [];
  const variantCap = capRows(variants);
  const variantRows: readonly (readonly HtmlValue[])[] = variantCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    const deltas = asRecord(e["deltas"]);
    const totalPnl = deltas ? asRecord(deltas["totalPnlUsd"]) : null;
    return [
      text(readString(e, "suffix")),
      text(readString(e, "scenarioName")),
      text(readString(e, "status")),
      num(readNumber(e, "changeCount")),
      signed(totalPnl ? readNumber(totalPnl, "delta") : null),
    ];
  });

  return html`
    ${kvSection("Baseline", "Per-variant deltas vs a single base scenario.", [
      { term: "planName", detail: text(planName) },
      { term: "baseScenarioName", detail: text(baseScenarioName) },
      { term: "baseScenarioDigest", detail: digestCode(baseScenarioDigest) },
      { term: "variantCount", detail: num(variantCount) },
      { term: "passedVariantCount", detail: num(readNumber(rec, "passedVariantCount")) },
      { term: "failedVariantCount", detail: num(readNumber(rec, "failedVariantCount")) },
    ])}
    ${tableSection({
      title: "Top movers — total simulated PnL Δ",
      description: "Ranked by movement magnitude vs the baseline (simulated, not real).",
      columns: [
        { header: "Variant" },
        { header: "Δ value", align: "right" },
        { header: "Magnitude", align: "right" },
      ],
      rows: moverRows,
      empty: "rankings.byTotalSimulatedPnlDelta not present.",
      caption: capCaption(moverCap, "rows"),
    })}
    ${tableSection({
      title: "Variants",
      columns: [
        { header: "Suffix" },
        { header: "Scenario" },
        { header: "Status" },
        { header: "Changes", align: "right" },
        { header: "Total PnL Δ", align: "right" },
      ],
      rows: variantRows,
      empty: "No variants present.",
      caption: capCaption(variantCap, "variants"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderSensitivityDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const basePlanName = readString(rec, "basePlanName");
  const nextPlanName = readString(rec, "nextPlanName");
  const hasRegression = need(missing, "hasRegression", readBoolean(rec, "hasRegression"));
  const reasons = readStringArray(rec, "regressionReasons");

  const added = readArray(rec, "added") ?? [];
  const removed = readArray(rec, "removed") ?? [];
  const changed = readArray(rec, "changed") ?? [];

  const changedCap = capRows(changed);
  const changedRows: readonly (readonly HtmlValue[])[] = changedCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "suffix")),
      text(readString(e, "scenarioName")),
      `${text(readString(e, "baseStatus"))} → ${text(readString(e, "nextStatus"))}`,
      boolText(readBoolean(e, "isRegression")),
    ];
  });

  return html`
    ${flagNotice({
      flag: hasRegression,
      trueTone: "caution",
      trueTitle: "Regression flagged by this sensitivity diff",
      falseTitle: "No regression flagged",
      absentTitle: "Regression status not present",
      reasons,
      falseBody: html`The artifact reports <code>hasRegression: false</code> for this comparison.`,
    })}
    ${kvSection("Compared plans", "Conservative delta between two sensitivity reports.", [
      { term: "basePlanName", detail: text(basePlanName) },
      { term: "nextPlanName", detail: text(nextPlanName) },
      { term: "baseVariantCount", detail: num(readNumber(rec, "baseVariantCount")) },
      { term: "nextVariantCount", detail: num(readNumber(rec, "nextVariantCount")) },
      { term: "added", detail: String(added.length) },
      { term: "removed", detail: String(removed.length) },
      { term: "changed", detail: String(changed.length) },
    ])}
    ${tableSection({
      title: "Changed variants",
      columns: [
        { header: "Suffix" },
        { header: "Scenario" },
        { header: "Status base → next" },
        { header: "Regression" },
      ],
      rows: changedRows,
      empty: "No changed variants.",
      caption: capCaption(changedCap, "changes"),
    })}
    ${partialNotice(missing)}
  `;
}

/* ------------------------------------------------------------------ *
 * Stable extras — suite diff, coverage, variant-plan explain.
 * ------------------------------------------------------------------ */

function renderSuiteDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const hasRegression = need(missing, "hasRegression", readBoolean(rec, "hasRegression"));
  const reasons = readStringArray(rec, "regressionReasons");
  const added = readArray(rec, "added") ?? [];
  const removed = readArray(rec, "removed") ?? [];
  const changed = readArray(rec, "changed") ?? [];

  const changedCap = capRows(changed);
  const changedRows: readonly (readonly HtmlValue[])[] = changedCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "scenarioName") ?? readString(e, "id")),
      `${text(readString(e, "baseStatus"))} → ${text(readString(e, "nextStatus"))}`,
      boolText(readBoolean(e, "digestMatch")),
      boolText(readBoolean(e, "isRegression")),
    ];
  });

  return html`
    ${flagNotice({
      flag: hasRegression,
      trueTone: "caution",
      trueTitle: "Regression flagged by this suite diff",
      falseTitle: "No regression flagged",
      absentTitle: "Regression status not present",
      reasons,
      falseBody: html`The artifact reports <code>hasRegression: false</code> for this comparison.`,
    })}
    ${kvSection("Compared suites", "Conservative delta between two suite indexes.", [
      { term: "baseSuiteName", detail: text(readString(rec, "baseSuiteName")) },
      { term: "nextSuiteName", detail: text(readString(rec, "nextSuiteName")) },
      { term: "baseScenarioCount", detail: num(readNumber(rec, "baseScenarioCount")) },
      { term: "nextScenarioCount", detail: num(readNumber(rec, "nextScenarioCount")) },
      { term: "added", detail: String(added.length) },
      { term: "removed", detail: String(removed.length) },
      { term: "changed", detail: String(changed.length) },
    ])}
    ${tableSection({
      title: "Changed scenarios",
      columns: [
        { header: "Scenario" },
        { header: "Status base → next" },
        { header: "Digest match" },
        { header: "Regression" },
      ],
      rows: changedRows,
      empty: "No changed scenarios.",
      caption: capCaption(changedCap, "changes"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderCoverageView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const counts = need(missing, "counts", readRecord(rec, "counts"));
  const pathBehaviours = need(missing, "pathBehaviours", readRecord(rec, "pathBehaviours"));

  const c = counts ?? {};
  const coveredArr = pathBehaviours
    ? (asArray(pathBehaviours["covered"]) ?? []).filter((x): x is string => typeof x === "string")
    : [];
  const coveredSet = new Set(coveredArr);
  const tracked = pathBehaviours
    ? readStringArray(pathBehaviours, "tracked", TYPED_VIEW_LIMITS.maxRows)
    : { items: [] as readonly string[], total: 0, hidden: 0 };
  const behaviourRows: readonly (readonly HtmlValue[])[] = tracked.items.map((b) => [
    b,
    coveredSet.has(b) ? "yes" : "no",
  ]);

  return html`
    ${kvSection("Suite coverage", "Which simulated paper behaviours a suite exercised (not market coverage).", [
      { term: "suiteName", detail: text(readString(rec, "suiteName")) },
      { term: "scenarioCount", detail: num(readNumber(c, "scenarioCount")) },
      { term: "passed", detail: num(readNumber(c, "passed")) },
      { term: "failed", detail: num(readNumber(c, "failed")) },
      { term: "skipped", detail: num(readNumber(c, "skipped")) },
      {
        term: "behaviours covered",
        detail: pathBehaviours
          ? `${num(readNumber(pathBehaviours, "coveredCount"))} / ${num(readNumber(pathBehaviours, "trackedCount"))}`
          : DASH,
      },
    ])}
    ${tableSection({
      title: "Tracked behaviours",
      description: "Each tracked simulated path and whether the suite exercised it.",
      columns: [{ header: "Behaviour" }, { header: "Covered" }],
      rows: behaviourRows,
      empty: "pathBehaviours.tracked not present.",
      caption:
        tracked.hidden > 0
          ? `Showing ${tracked.items.length} of ${tracked.total} behaviours — ${tracked.hidden} more not shown.`
          : undefined,
    })}
    ${partialNotice(missing)}
  `;
}

function renderVariantPlanExplainView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const valid = need(missing, "valid", readBoolean(rec, "valid"));
  const refusals = readStringArray(rec, "refusals");
  const variants = readArray(rec, "variants") ?? [];

  const cap = capRows(variants);
  const variantRows: readonly (readonly HtmlValue[])[] = cap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    const perturbations = asArray(e["perturbations"]) ?? [];
    return [
      text(readString(e, "suffix")),
      text(readString(e, "variantName")),
      String(perturbations.length),
      num(readNumber(e, "totalMatchedValueCount")),
      boolText(readBoolean(e, "valid")),
    ];
  });

  return html`
    ${flagNotice({
      flag: valid,
      trueTone: "info",
      trueTitle: "Variant plan is valid (dry-run)",
      falseTitle: "Variant plan reported refusals",
      absentTitle: "Validity not present",
      reasons: refusals,
      falseBody: html`The plan is valid and would generate files; this is a dry-run explanation only.`,
    })}
    ${kvSection("Variant plan", "Dry-run explanation of what a variant plan would change (no files written).", [
      { term: "planName", detail: text(readString(rec, "planName")) },
      { term: "baseScenarioName", detail: text(readString(rec, "baseScenarioName")) },
      { term: "baseScenarioDigest", detail: digestCode(readString(rec, "baseScenarioDigest")) },
      { term: "variantCount", detail: num(readNumber(rec, "variantCount")) },
      { term: "totalPerturbationCount", detail: num(readNumber(rec, "totalPerturbationCount")) },
      { term: "totalMatchedValueCount", detail: num(readNumber(rec, "totalMatchedValueCount")) },
    ])}
    ${tableSection({
      title: "Variants",
      columns: [
        { header: "Suffix" },
        { header: "Name" },
        { header: "Perturbations", align: "right" },
        { header: "Matched values", align: "right" },
        { header: "Valid" },
      ],
      rows: variantRows,
      empty: "No variants present.",
      caption: capCaption(cap, "variants"),
    })}
    ${partialNotice(missing)}
  `;
}

/* ------------------------------------------------------------------ *
 * Priority 2 — sensitivity matrix + matrix diff.
 * ------------------------------------------------------------------ */

/**
 * A base×variant grid: rows are base scenarios, columns are variant suffixes,
 * each cell shows that variant's total simulated PnL Δ vs the base's baseline.
 * Defensive and bounded: rows/columns are capped, unknown cells show "·", and a
 * non-diffable cell falls back to its status word. Never throws.
 */
function matrixGridSection(bases: readonly unknown[]): RawHtml {
  const rowCap = capRows(bases, TYPED_VIEW_LIMITS.maxGridRows);

  // Ordered union of variant suffixes (first-seen) across the shown bases.
  const suffixes: string[] = [];
  const seen = new Set<string>();
  for (const base of rowCap.shown) {
    const b = asRecord(base) ?? {};
    for (const cell of asArray(b["cells"]) ?? []) {
      const suffix = readString(asRecord(cell) ?? {}, "suffix");
      if (suffix !== null && !seen.has(suffix)) {
        seen.add(suffix);
        suffixes.push(suffix);
      }
    }
  }
  const shownCols = suffixes.slice(0, TYPED_VIEW_LIMITS.maxGridCols);
  const hiddenCols = suffixes.length - shownCols.length;

  const columns: readonly TableColumn[] = [
    { header: "Base scenario" },
    ...shownCols.map((suffix) => ({ header: suffix, align: "right" as const })),
  ];

  const rows: readonly (readonly HtmlValue[])[] = rowCap.shown.map((base) => {
    const b = asRecord(base) ?? {};
    const bySuffix = new Map<string, Record<string, unknown>>();
    for (const cell of asArray(b["cells"]) ?? []) {
      const c = asRecord(cell);
      if (c === null) continue;
      const suffix = readString(c, "suffix");
      if (suffix !== null && !bySuffix.has(suffix)) bySuffix.set(suffix, c);
    }
    const label = text(readString(b, "baseScenarioName") ?? readString(b, "id"));
    const cells: HtmlValue[] = shownCols.map((suffix) => {
      const c = bySuffix.get(suffix);
      if (c === undefined) return "·";
      const deltas = asRecord(c["deltas"]);
      const totalPnl = deltas ? asRecord(deltas["totalPnlUsd"]) : null;
      const delta = totalPnl ? readNumber(totalPnl, "delta") : null;
      return delta !== null ? signed(delta) : text(readString(c, "status"));
    });
    return [label, ...cells];
  });

  const hidden: string[] = [];
  if (rowCap.hidden > 0) hidden.push(`${rowCap.hidden} more base${rowCap.hidden === 1 ? "" : "s"}`);
  if (hiddenCols > 0) hidden.push(`${hiddenCols} more variant${hiddenCols === 1 ? "" : "s"}`);
  const caption =
    "Cells: each variant's total simulated PnL Δ vs the base baseline (signed; not real). " +
    "“·” = no cell for that base; a status word = run not diffable." +
    (hidden.length > 0 ? ` ${hidden.join(" and ")} not shown.` : "");

  return Section({
    title: "Base × variant grid",
    description: "Per-cell total simulated PnL delta across the matrix (row/column capped).",
    body: html`<div class="sm-matrixgrid">
      ${DataTable({ columns, rows, caption, emptyMessage: "No matrix cells present." })}
    </div>`,
  });
}

function renderMatrixView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const baseCount = need(missing, "baseCount", readNumber(rec, "baseCount"));
  const variantCount = need(missing, "variantCount", readNumber(rec, "variantCount"));
  const bases = readArray(rec, "bases") ?? [];
  const aggregates = readArray(rec, "variantAggregates") ?? [];

  const baseCap = capRows(bases);
  const baseRows: readonly (readonly HtmlValue[])[] = baseCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      num(readNumber(e, "index")),
      text(readString(e, "baseScenarioName") ?? readString(e, "id")),
      text(readString(e, "baselineStatus")),
      num(readNumber(e, "variantCount")),
      num(readNumber(e, "passedVariantCount")),
      num(readNumber(e, "failedVariantCount")),
    ];
  });

  const aggCap = capRows(aggregates);
  const aggRows: readonly (readonly HtmlValue[])[] = aggCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    const totalPnl = asRecord(e["totalPnlDelta"]);
    return [
      text(readString(e, "suffix")),
      num(readNumber(e, "baseCount")),
      num(readNumber(e, "diffableCount")),
      signed(totalPnl ? readNumber(totalPnl, "sum") : null),
      num(totalPnl ? readNumber(totalPnl, "maxMagnitude") : null),
    ];
  });

  return html`
    ${kvSection("Matrix", "Cross-scenario sensitivity matrix (base scenarios × variants).", [
      { term: "matrixName", detail: text(readString(rec, "matrixName")) },
      { term: "planName", detail: text(readString(rec, "planName")) },
      { term: "baseCount", detail: num(baseCount) },
      { term: "variantCount", detail: num(variantCount) },
      { term: "passedBaseCount", detail: num(readNumber(rec, "passedBaseCount")) },
      { term: "failedBaseCount", detail: num(readNumber(rec, "failedBaseCount")) },
    ])}
    ${matrixGridSection(bases)}
    ${tableSection({
      title: "Per-base",
      columns: [
        { header: "#", align: "right" },
        { header: "Base scenario" },
        { header: "Baseline" },
        { header: "Variants", align: "right" },
        { header: "Passed", align: "right" },
        { header: "Failed", align: "right" },
      ],
      rows: baseRows,
      empty: "No bases present.",
      caption: capCaption(baseCap, "bases"),
    })}
    ${tableSection({
      title: "Per-variant aggregates",
      description: "Aggregated movement of each variant across all base scenarios (simulated).",
      columns: [
        { header: "Suffix" },
        { header: "Bases", align: "right" },
        { header: "Diffable", align: "right" },
        { header: "Total PnL Δ sum", align: "right" },
        { header: "Max magnitude", align: "right" },
      ],
      rows: aggRows,
      empty: "No variant aggregates present.",
      caption: capCaption(aggCap, "aggregates"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderMatrixDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const hasRegression = need(missing, "hasRegression", readBoolean(rec, "hasRegression"));
  const reasons = readStringArray(rec, "regressionReasons");
  const compatibility = readRecord(rec, "compatibility");
  const addedBases = readArray(rec, "addedBases") ?? [];
  const removedBases = readArray(rec, "removedBases") ?? [];
  const changedBases = readArray(rec, "changedBases") ?? [];

  const changedCap = capRows(changedBases);
  const changedRows: readonly (readonly HtmlValue[])[] = changedCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "baseScenarioName") ?? readString(e, "id")),
      boolText(readBoolean(e, "baselineStatusChanged")),
      boolText(readBoolean(e, "digestMatch")),
      boolText(readBoolean(e, "isRegression")),
    ];
  });

  const compatStatus = compatibility ? readString(compatibility, "status") : null;
  const compatible = compatibility ? readBoolean(compatibility, "compatible") : null;

  // Flatten per-base cell changes into one capped table (a full base×variant grid
  // is sparse for a diff, so list only the cells that actually changed).
  const cellChanges: { readonly base: string; readonly cell: Record<string, unknown> }[] = [];
  for (const entry of changedBases) {
    const e = asRecord(entry);
    if (e === null) continue;
    const baseLabel = text(readString(e, "baseScenarioName") ?? readString(e, "id"));
    for (const cell of asArray(e["cellsChanged"]) ?? []) {
      const c = asRecord(cell);
      if (c !== null) cellChanges.push({ base: baseLabel, cell: c });
    }
  }
  const cellCap = capRows(cellChanges);
  const cellRows: readonly (readonly HtmlValue[])[] = cellCap.shown.map(({ base, cell }) => [
    base,
    text(readString(cell, "suffix")),
    `${text(readString(cell, "baseStatus"))} → ${text(readString(cell, "nextStatus"))}`,
    boolText(readBoolean(cell, "isRegression")),
  ]);

  return html`
    ${flagNotice({
      flag: hasRegression,
      trueTone: "caution",
      trueTitle: "Regression flagged by this matrix diff",
      falseTitle: "No regression flagged",
      absentTitle: "Regression status not present",
      reasons,
      falseBody: html`The artifact reports <code>hasRegression: false</code> for this comparison.`,
    })}
    ${kvSection("Compared matrices", "Conservative delta between two sensitivity matrices.", [
      { term: "baseMatrixName", detail: text(readString(rec, "baseMatrixName")) },
      { term: "nextMatrixName", detail: text(readString(rec, "nextMatrixName")) },
      { term: "schema compatibility", detail: `${text(compatStatus)} (compatible: ${boolText(compatible)})` },
      { term: "added bases", detail: String(addedBases.length) },
      { term: "removed bases", detail: String(removedBases.length) },
      { term: "changed bases", detail: String(changedBases.length) },
    ])}
    ${tableSection({
      title: "Changed bases",
      columns: [
        { header: "Base scenario" },
        { header: "Baseline changed" },
        { header: "Digest match" },
        { header: "Regression" },
      ],
      rows: changedRows,
      empty: "No changed bases.",
      caption: capCaption(changedCap, "bases"),
    })}
    ${tableSection({
      title: "Changed cells",
      description: "Individual base×variant cells that changed between the two matrices.",
      columns: [
        { header: "Base scenario" },
        { header: "Variant" },
        { header: "Status base → next" },
        { header: "Regression" },
      ],
      rows: cellRows,
      empty: "No changed cells.",
      caption: capCaption(cellCap, "cells"),
    })}
    ${partialNotice(missing)}
  `;
}

/* ------------------------------------------------------------------ *
 * Priority 2/3 — research manifest, verify, manifest diff, bundle, status.
 * ------------------------------------------------------------------ */

function renderResearchManifestView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const artifactCount = need(missing, "artifactCount", readNumber(rec, "artifactCount"));
  const artifacts = readArray(rec, "artifacts") ?? [];
  const kindCounts = readArray(rec, "kindCounts") ?? [];
  const schemaCounts = readArray(rec, "schemaCounts") ?? [];

  const kindCap = capRows(kindCounts);
  const kindRows: readonly (readonly HtmlValue[])[] = kindCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [text(readString(e, "kind")), num(readNumber(e, "count"))];
  });

  const schemaCap = capRows(schemaCounts);
  const schemaRows: readonly (readonly HtmlValue[])[] = schemaCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [code(readString(e, "schemaVersion")), num(readNumber(e, "count"))];
  });

  const artifactCap = capRows(artifacts);
  const artifactRows: readonly (readonly HtmlValue[])[] = artifactCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      code(readString(e, "path")),
      text(readString(e, "kind")),
      code(readString(e, "schemaVersion")),
      bytes(readNumber(e, "sizeBytes")),
      digestCode(readString(e, "digest")),
    ];
  });

  return html`
    ${kvSection("Run manifest", "Generated artifacts of a paper research run, with digests.", [
      { term: "runName", detail: text(readString(rec, "runName")) },
      { term: "artifactCount", detail: num(artifactCount) },
      { term: "totalSizeBytes", detail: bytes(readNumber(rec, "totalSizeBytes")) },
      { term: "digestAlgorithm", detail: code(readString(rec, "digestAlgorithm")) },
    ])}
    ${tableSection({
      title: "Kinds",
      columns: [{ header: "Kind" }, { header: "Count", align: "right" }],
      rows: kindRows,
      empty: "kindCounts not present.",
      caption: capCaption(kindCap, "kinds"),
    })}
    ${tableSection({
      title: "Schemas",
      columns: [{ header: "Schema" }, { header: "Count", align: "right" }],
      rows: schemaRows,
      empty: "schemaCounts not present.",
      caption: capCaption(schemaCap, "schemas"),
    })}
    ${tableSection({
      title: "Artifacts",
      columns: [
        { header: "Path" },
        { header: "Kind" },
        { header: "Schema" },
        { header: "Size", align: "right" },
        { header: "Digest" },
      ],
      rows: artifactRows,
      empty: "No artifacts present.",
      caption: capCaption(artifactCap, "artifacts"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderResearchVerifyView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const valid = need(missing, "valid", readBoolean(rec, "valid"));
  const artifacts = readArray(rec, "artifacts") ?? [];

  const cap = capRows(artifacts);
  const rows: readonly (readonly HtmlValue[])[] = cap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    const issues = (asArray(e["issues"]) ?? []).filter((x): x is string => typeof x === "string");
    const issueText = issues.length > 0 ? issues.join("; ") : DASH;
    return [code(readString(e, "path")), text(readString(e, "status")), issueText];
  });

  return html`
    ${flagNotice({
      flag: valid,
      trueTone: "info",
      trueTitle: "Manifest verified — artifacts in sync",
      falseTitle: "Verification failed — manifest is out of sync",
      absentTitle: "Validity not present",
      reasons: readStringArray(rec, "notes"),
      falseBody: html`Every artifact matched its manifest entry (<code>valid: true</code>).`,
    })}
    ${kvSection("Verification", "Re-verification of a research manifest against artifacts on disk.", [
      { term: "runName", detail: text(readString(rec, "runName")) },
      { term: "manifestArtifactCount", detail: num(readNumber(rec, "manifestArtifactCount")) },
      { term: "currentArtifactCount", detail: num(readNumber(rec, "currentArtifactCount")) },
      { term: "okCount", detail: num(readNumber(rec, "okCount")) },
      { term: "changedCount", detail: num(readNumber(rec, "changedCount")) },
      { term: "missingCount", detail: num(readNumber(rec, "missingCount")) },
      { term: "extraCount", detail: num(readNumber(rec, "extraCount")) },
    ])}
    ${tableSection({
      title: "Per-artifact verification",
      columns: [{ header: "Path" }, { header: "Status" }, { header: "Issues" }],
      rows,
      empty: "No verification rows present.",
      caption: capCaption(cap, "rows"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderResearchManifestDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const hasChange = need(missing, "hasChange", readBoolean(rec, "hasChange"));
  const reasons = readStringArray(rec, "changeReasons");
  const added = readArray(rec, "added") ?? [];
  const removed = readArray(rec, "removed") ?? [];
  const changed = readArray(rec, "changed") ?? [];

  const cap = capRows(changed);
  const changedRows: readonly (readonly HtmlValue[])[] = cap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      code(readString(e, "path")),
      boolText(readBoolean(e, "kindChanged")),
      boolText(readBoolean(e, "schemaChanged")),
      boolText(readBoolean(e, "digestMatch")),
    ];
  });

  return html`
    ${flagNotice({
      flag: hasChange,
      trueTone: "caution",
      trueTitle: "Manifest changed between runs",
      falseTitle: "No change between manifests",
      absentTitle: "Change status not present",
      reasons,
      falseBody: html`The two manifests are identical (<code>hasChange: false</code>).`,
    })}
    ${kvSection("Compared manifests", "Conservative delta between two research run manifests.", [
      { term: "baseRunName", detail: text(readString(rec, "baseRunName")) },
      { term: "nextRunName", detail: text(readString(rec, "nextRunName")) },
      { term: "artifactCount", detail: deltaCell(readDelta(rec, "artifactCount")) },
      { term: "totalSizeBytes", detail: deltaCell(readDelta(rec, "totalSizeBytes")) },
      { term: "manifestSchemaMatch", detail: boolText(readBoolean(rec, "manifestSchemaMatch")) },
      { term: "added", detail: String(added.length) },
      { term: "removed", detail: String(removed.length) },
      { term: "changed", detail: String(changed.length) },
    ])}
    ${tableSection({
      title: "Changed artifacts",
      columns: [
        { header: "Path" },
        { header: "Kind changed" },
        { header: "Schema changed" },
        { header: "Digest match" },
      ],
      rows: changedRows,
      empty: "No changed artifacts.",
      caption: capCaption(cap, "artifacts"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderResearchBundleView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const runDigest = need(missing, "runDigest", readString(rec, "runDigest"));
  const artifactCount = need(missing, "artifactCount", readNumber(rec, "artifactCount"));
  const kindCounts = readArray(rec, "kindCounts") ?? [];
  const schemaCounts = readArray(rec, "schemaCounts") ?? [];
  const recognized = readStringArray(rec, "recognizedSchemaVersions");
  const manifest = readRecord(rec, "manifest");

  const kindCap = capRows(kindCounts);
  const kindRows: readonly (readonly HtmlValue[])[] = kindCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [text(readString(e, "kind")), num(readNumber(e, "count"))];
  });
  const schemaCap = capRows(schemaCounts);
  const schemaRows: readonly (readonly HtmlValue[])[] = schemaCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [code(readString(e, "schemaVersion")), num(readNumber(e, "count"))];
  });

  return html`
    ${kvSection("Run bundle", "Integrity bundle of a paper research run.", [
      { term: "runName", detail: text(readString(rec, "runName")) },
      { term: "runDigest", detail: digestCode(runDigest) },
      { term: "artifactCount", detail: num(artifactCount) },
      { term: "totalSizeBytes", detail: bytes(readNumber(rec, "totalSizeBytes")) },
      { term: "unknownArtifactCount", detail: num(readNumber(rec, "unknownArtifactCount")) },
      { term: "malformedArtifactCount", detail: num(readNumber(rec, "malformedArtifactCount")) },
      {
        term: "recognizedSchemaVersions",
        detail:
          recognized.items.length > 0
            ? `${recognized.items.join(", ")}${recognized.hidden > 0 ? `, +${recognized.hidden} more` : ""}`
            : DASH,
      },
    ])}
    ${tableSection({
      title: "Kinds",
      columns: [{ header: "Kind" }, { header: "Count", align: "right" }],
      rows: kindRows,
      empty: "kindCounts not present.",
      caption: capCaption(kindCap, "kinds"),
    })}
    ${tableSection({
      title: "Schemas",
      columns: [{ header: "Schema" }, { header: "Count", align: "right" }],
      rows: schemaRows,
      empty: "schemaCounts not present.",
      caption: capCaption(schemaCap, "schemas"),
    })}
    ${kvSection("Manifest summary", undefined, [
      { term: "schemaVersion", detail: code(manifest ? readString(manifest, "schemaVersion") : null) },
      { term: "runName", detail: text(manifest ? readString(manifest, "runName") : null) },
      { term: "artifactCount", detail: num(manifest ? readNumber(manifest, "artifactCount") : null) },
      { term: "totalSizeBytes", detail: bytes(manifest ? readNumber(manifest, "totalSizeBytes") : null) },
      { term: "manifestDigest", detail: digestCode(manifest ? readString(manifest, "manifestDigest") : null) },
    ])}
    ${partialNotice(missing)}
  `;
}

function renderResearchStatusView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const complete = need(missing, "complete", readBoolean(rec, "complete"));
  const manifest = readRecord(rec, "manifest");
  const schemasPresent = readStringArray(rec, "schemasPresent");
  const recommendedAction = readString(rec, "recommendedAction");
  const bundleError = readString(rec, "bundleCandidateError");

  return html`
    ${RiskNotice({
      tone: complete === true ? "info" : "caution",
      title: `Run status — complete: ${boolText(complete)}`,
      body: html`recognized: ${boolText(readBoolean(rec, "recognized"))} · stable:
        ${boolText(readBoolean(rec, "stable"))} · bundle candidate valid:
        ${boolText(readBoolean(rec, "bundleCandidateValid"))}.
        ${recommendedAction !== null ? html`<br />Recommended action: ${recommendedAction}` : null}
        ${bundleError !== null ? html`<br />Bundle error: ${bundleError}` : null}`,
    })}
    ${kvSection("Run", "Integrity / status check of a paper research run.", [
      { term: "runName", detail: text(readString(rec, "runName")) },
      { term: "runDigest", detail: digestCode(readString(rec, "runDigest")) },
      { term: "artifactCount", detail: num(readNumber(rec, "artifactCount")) },
      { term: "totalSizeBytes", detail: bytes(readNumber(rec, "totalSizeBytes")) },
      { term: "unknownArtifactCount", detail: num(readNumber(rec, "unknownArtifactCount")) },
      { term: "malformedArtifactCount", detail: num(readNumber(rec, "malformedArtifactCount")) },
      {
        term: "schemasPresent",
        detail:
          schemasPresent.items.length > 0
            ? `${schemasPresent.items.join(", ")}${schemasPresent.hidden > 0 ? `, +${schemasPresent.hidden} more` : ""}`
            : DASH,
      },
    ])}
    ${kvSection("Manifest check", undefined, [
      { term: "present", detail: boolText(manifest ? readBoolean(manifest, "present") : null) },
      { term: "inSync", detail: boolText(manifest ? readBoolean(manifest, "inSync") : null) },
      { term: "okCount", detail: num(manifest ? readNumber(manifest, "okCount") : null) },
      { term: "missingCount", detail: num(manifest ? readNumber(manifest, "missingCount") : null) },
      { term: "extraCount", detail: num(manifest ? readNumber(manifest, "extraCount") : null) },
      { term: "digestChangedCount", detail: num(manifest ? readNumber(manifest, "digestChangedCount") : null) },
      { term: "schemaChangedCount", detail: num(manifest ? readNumber(manifest, "schemaChangedCount") : null) },
      { term: "sizeChangedCount", detail: num(manifest ? readNumber(manifest, "sizeChangedCount") : null) },
    ])}
    ${partialNotice(missing)}
  `;
}

function renderResearchCampaignIndexView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const campaignDigest = need(missing, "campaignDigest", readString(rec, "campaignDigest"));
  const runCount = need(missing, "runCount", readNumber(rec, "runCount"));
  const runs = readArray(rec, "runs") ?? [];
  const kindCounts = readArray(rec, "aggregateKindCounts") ?? [];
  const aggregateSchemas = readStringArray(rec, "aggregateSchemaVersions");
  const needingAttention = readStringArray(rec, "runsNeedingAttention");

  const kindCap = capRows(kindCounts);
  const kindRows: readonly (readonly HtmlValue[])[] = kindCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [text(readString(e, "kind")), num(readNumber(e, "count"))];
  });

  const runCap = capRows(runs);
  const runRows: readonly (readonly HtmlValue[])[] = runCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "runId")),
      boolText(readBoolean(e, "valid")),
      digestCode(readString(e, "runDigest")),
      boolText(readBoolean(e, "driftDetected")),
      text(readString(e, "recommendedAction")),
    ];
  });

  return html`
    ${kvSection("Campaign", "Campaign-level summary across many paper research runs.", [
      { term: "campaignName", detail: text(readString(rec, "campaignName")) },
      { term: "campaignDigest", detail: digestCode(campaignDigest) },
      { term: "runCount", detail: num(runCount) },
      { term: "validRunCount", detail: num(readNumber(rec, "validRunCount")) },
      { term: "invalidRunCount", detail: num(readNumber(rec, "invalidRunCount")) },
      { term: "totalArtifactCount", detail: num(readNumber(rec, "totalArtifactCount")) },
      { term: "totalUnknownArtifactCount", detail: num(readNumber(rec, "totalUnknownArtifactCount")) },
      { term: "totalMalformedArtifactCount", detail: num(readNumber(rec, "totalMalformedArtifactCount")) },
      {
        term: "runsNeedingAttention",
        detail:
          needingAttention.items.length > 0
            ? `${needingAttention.items.join(", ")}${needingAttention.hidden > 0 ? `, +${needingAttention.hidden} more` : ""}`
            : DASH,
      },
      {
        term: "aggregateSchemaVersions",
        detail:
          aggregateSchemas.items.length > 0
            ? `${aggregateSchemas.items.join(", ")}${aggregateSchemas.hidden > 0 ? `, +${aggregateSchemas.hidden} more` : ""}`
            : DASH,
      },
    ])}
    ${tableSection({
      title: "Aggregate kinds",
      columns: [{ header: "Kind" }, { header: "Count", align: "right" }],
      rows: kindRows,
      empty: "aggregateKindCounts not present.",
      caption: capCaption(kindCap, "kinds"),
    })}
    ${tableSection({
      title: "Runs",
      columns: [
        { header: "Run" },
        { header: "Valid" },
        { header: "Run digest" },
        { header: "Drift" },
        { header: "Recommended action" },
      ],
      rows: runRows,
      empty: "No runs present.",
      caption: capCaption(runCap, "runs"),
    })}
    ${partialNotice(missing)}
  `;
}

/* ------------------------------------------------------------------ *
 * Sprint 19 — research bundle diff + campaign diff.
 * ------------------------------------------------------------------ */

function renderResearchBundleDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const hasChange = need(missing, "hasChange", readBoolean(rec, "hasChange"));
  const hasRegression = need(missing, "hasRegression", readBoolean(rec, "hasRegression"));
  const changeReasons = readStringArray(rec, "changeReasons");
  const regressionReasons = readStringArray(rec, "regressionReasons");

  const added = readArray(rec, "added") ?? [];
  const removed = readArray(rec, "removed") ?? [];
  const changed = readArray(rec, "changed") ?? [];
  const kindCountChanges = readArray(rec, "kindCountChanges") ?? [];
  const schemaCountChanges = readArray(rec, "schemaCountChanges") ?? [];
  const recognizedAdded = readStringArray(rec, "recognizedSchemasAdded");
  const recognizedRemoved = readStringArray(rec, "recognizedSchemasRemoved");

  // One combined, capped artifact table (added / removed / digest-changed by path).
  interface ArtifactChangeRow {
    readonly path: string | null;
    readonly change: string;
    readonly base: string | null;
    readonly next: string | null;
  }
  const artifactRows: readonly ArtifactChangeRow[] = [
    ...added.map((entry): ArtifactChangeRow => {
      const e = asRecord(entry) ?? {};
      return { path: readString(e, "path"), change: "added", base: null, next: readString(e, "digest") };
    }),
    ...removed.map((entry): ArtifactChangeRow => {
      const e = asRecord(entry) ?? {};
      return { path: readString(e, "path"), change: "removed", base: readString(e, "digest"), next: null };
    }),
    ...changed.map((entry): ArtifactChangeRow => {
      const e = asRecord(entry) ?? {};
      return {
        path: readString(e, "path"),
        change: "changed",
        base: readString(e, "baseDigest"),
        next: readString(e, "nextDigest"),
      };
    }),
  ];
  const artifactCap = capRows(artifactRows);
  const artifactTableRows: readonly (readonly HtmlValue[])[] = artifactCap.shown.map((r) => [
    code(r.path),
    r.change,
    digestCode(r.base),
    digestCode(r.next),
  ]);

  // Combined count-change table (kind + schema scopes), each entry is a flat {key,base,next,delta}.
  interface CountChangeRow {
    readonly scope: string;
    readonly entry: Record<string, unknown>;
  }
  const countRows: readonly CountChangeRow[] = [
    ...kindCountChanges.map((entry): CountChangeRow => ({ scope: "kind", entry: asRecord(entry) ?? {} })),
    ...schemaCountChanges.map((entry): CountChangeRow => ({ scope: "schema", entry: asRecord(entry) ?? {} })),
  ];
  const countCap = capRows(countRows);
  const countTableRows: readonly (readonly HtmlValue[])[] = countCap.shown.map((r) => [
    r.scope,
    code(readString(r.entry, "key")),
    flatDeltaCell(r.entry),
  ]);

  const schemaSet = (read: StringListRead): HtmlValue =>
    read.items.length > 0
      ? `${read.items.join(", ")}${read.hidden > 0 ? `, +${read.hidden} more` : ""}`
      : DASH;

  return html`
    ${flagNotice({
      flag: hasRegression,
      trueTone: "caution",
      trueTitle: "Integrity regression flagged by this bundle diff",
      falseTitle: "No integrity regression flagged",
      absentTitle: "Regression status not present",
      reasons: regressionReasons,
      falseBody: html`The artifact reports <code>hasRegression: false</code> — a conservative
        integrity check (removed/changed artifacts, schema mismatch, more unknown/malformed).`,
    })}
    ${flagNotice({
      flag: hasChange,
      trueTone: "info",
      trueTitle: "The two bundles differ",
      falseTitle: "No change between bundles",
      absentTitle: "Change status not present",
      reasons: changeReasons,
      falseBody: html`The two bundles are identical (<code>hasChange: false</code>).`,
    })}
    ${kvSection("Compared bundles", "Conservative delta between two research run bundles.", [
      { term: "baseRunName", detail: text(readString(rec, "baseRunName")) },
      { term: "nextRunName", detail: text(readString(rec, "nextRunName")) },
      { term: "bundleSchemaMatch", detail: boolText(readBoolean(rec, "bundleSchemaMatch")) },
      { term: "runDigestChanged", detail: boolText(readBoolean(rec, "runDigestChanged")) },
      { term: "baseRunDigest", detail: digestCode(readString(rec, "baseRunDigest")) },
      { term: "nextRunDigest", detail: digestCode(readString(rec, "nextRunDigest")) },
      { term: "manifestDigestChanged", detail: boolText(readBoolean(rec, "manifestDigestChanged")) },
      { term: "artifactCount", detail: deltaCell(readDelta(rec, "artifactCount")) },
      { term: "totalSizeBytes", detail: deltaCell(readDelta(rec, "totalSizeBytes")) },
      { term: "unknownArtifactCount", detail: deltaCell(readDelta(rec, "unknownArtifactCount")) },
      { term: "malformedArtifactCount", detail: deltaCell(readDelta(rec, "malformedArtifactCount")) },
      { term: "warningCount", detail: deltaCell(readDelta(rec, "warningCount")) },
      { term: "added / removed / changed", detail: `${added.length} / ${removed.length} / ${changed.length}` },
      { term: "recognizedSchemasAdded", detail: schemaSet(recognizedAdded) },
      { term: "recognizedSchemasRemoved", detail: schemaSet(recognizedRemoved) },
    ])}
    ${tableSection({
      title: "Artifact changes",
      columns: [
        { header: "Path" },
        { header: "Change" },
        { header: "Base digest" },
        { header: "Next digest" },
      ],
      rows: artifactTableRows,
      empty: "No artifacts added, removed, or changed.",
      caption: capCaption(artifactCap, "artifacts"),
    })}
    ${tableSection({
      title: "Count changes",
      columns: [{ header: "Scope" }, { header: "Key" }, { header: "base → next (Δ)" }],
      rows: countTableRows,
      empty: "No kind or schema count changes.",
      caption: capCaption(countCap, "count changes"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderResearchCampaignDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const hasChange = need(missing, "hasChange", readBoolean(rec, "hasChange"));
  const hasRegression = need(missing, "hasRegression", readBoolean(rec, "hasRegression"));
  const changeReasons = readStringArray(rec, "changeReasons");
  const regressionReasons = readStringArray(rec, "regressionReasons");

  const addedRuns = readArray(rec, "addedRuns") ?? [];
  const removedRuns = readArray(rec, "removedRuns") ?? [];
  const changedRuns = readArray(rec, "changedRuns") ?? [];
  const kindCountChanges = readArray(rec, "aggregateKindCountChanges") ?? [];
  const newlyNeedsAttention = readStringArray(rec, "newlyNeedsAttention");
  const noLongerNeedsAttention = readStringArray(rec, "noLongerNeedsAttention");
  const schemasAdded = readStringArray(rec, "aggregateSchemasAdded");
  const schemasRemoved = readStringArray(rec, "aggregateSchemasRemoved");

  const runCap = capRows(changedRuns);
  const runRows: readonly (readonly HtmlValue[])[] = runCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "runId")),
      boolText(readBoolean(e, "runDigestChanged")),
      `${boolText(readBoolean(e, "baseValid"))} → ${boolText(readBoolean(e, "nextValid"))}`,
      boolText(readBoolean(e, "becameInvalid")),
      deltaCell(readDelta(e, "artifactCount")),
    ];
  });

  const kindCap = capRows(kindCountChanges);
  const kindRows: readonly (readonly HtmlValue[])[] = kindCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [code(readString(e, "key")), flatDeltaCell(e)];
  });

  const attentionList = (read: StringListRead): HtmlValue =>
    read.items.length > 0
      ? `${read.items.join(", ")}${read.hidden > 0 ? `, +${read.hidden} more` : ""}`
      : DASH;

  return html`
    ${flagNotice({
      flag: hasRegression,
      trueTone: "caution",
      trueTitle: "Integrity regression flagged by this campaign diff",
      falseTitle: "No integrity regression flagged",
      absentTitle: "Regression status not present",
      reasons: regressionReasons,
      falseBody: html`The artifact reports <code>hasRegression: false</code> — a conservative
        integrity check (removed runs, runs that became invalid, more unknown/malformed).`,
    })}
    ${flagNotice({
      flag: hasChange,
      trueTone: "info",
      trueTitle: "The two campaigns differ",
      falseTitle: "No change between campaigns",
      absentTitle: "Change status not present",
      reasons: changeReasons,
      falseBody: html`The two campaign indexes are identical (<code>hasChange: false</code>).`,
    })}
    ${kvSection("Compared campaigns", "Conservative delta between two research campaign indexes.", [
      { term: "baseCampaignName", detail: text(readString(rec, "baseCampaignName")) },
      { term: "nextCampaignName", detail: text(readString(rec, "nextCampaignName")) },
      { term: "campaignSchemaMatch", detail: boolText(readBoolean(rec, "campaignSchemaMatch")) },
      { term: "campaignDigestChanged", detail: boolText(readBoolean(rec, "campaignDigestChanged")) },
      { term: "baseCampaignDigest", detail: digestCode(readString(rec, "baseCampaignDigest")) },
      { term: "nextCampaignDigest", detail: digestCode(readString(rec, "nextCampaignDigest")) },
      { term: "runCount", detail: deltaCell(readDelta(rec, "runCount")) },
      { term: "validRunCount", detail: deltaCell(readDelta(rec, "validRunCount")) },
      { term: "invalidRunCount", detail: deltaCell(readDelta(rec, "invalidRunCount")) },
      { term: "totalArtifactCount", detail: deltaCell(readDelta(rec, "totalArtifactCount")) },
      { term: "totalUnknownArtifactCount", detail: deltaCell(readDelta(rec, "totalUnknownArtifactCount")) },
      { term: "totalMalformedArtifactCount", detail: deltaCell(readDelta(rec, "totalMalformedArtifactCount")) },
      { term: "added / removed / changed runs", detail: `${addedRuns.length} / ${removedRuns.length} / ${changedRuns.length}` },
      { term: "newlyNeedsAttention", detail: attentionList(newlyNeedsAttention) },
      { term: "noLongerNeedsAttention", detail: attentionList(noLongerNeedsAttention) },
      { term: "aggregateSchemasAdded", detail: attentionList(schemasAdded) },
      { term: "aggregateSchemasRemoved", detail: attentionList(schemasRemoved) },
    ])}
    ${tableSection({
      title: "Changed runs",
      columns: [
        { header: "Run" },
        { header: "Digest changed" },
        { header: "Valid base → next" },
        { header: "Became invalid" },
        { header: "Artifacts Δ" },
      ],
      rows: runRows,
      empty: "No changed runs.",
      caption: capCaption(runCap, "runs"),
    })}
    ${tableSection({
      title: "Aggregate kind count changes",
      columns: [{ header: "Kind" }, { header: "base → next (Δ)" }],
      rows: kindRows,
      empty: "No aggregate kind count changes.",
      caption: capCaption(kindCap, "count changes"),
    })}
    ${partialNotice(missing)}
  `;
}

/* ------------------------------------------------------------------ *
 * Dispatch.
 * ------------------------------------------------------------------ */

/** Map a recognized schemaVersion to its typed renderer, or `null`. */
function buildTypedView(schema: string, rec: Record<string, unknown>): RawHtml | null {
  switch (schema) {
    case "backtest.report.v1":
      return renderReportView(rec);
    case "backtest.suite.v1":
      return renderSuiteView(rec);
    case "backtest.suite.diff.v1":
      return renderSuiteDiffView(rec);
    case "backtest.sensitivity.v1":
      return renderSensitivityView(rec);
    case "backtest.sensitivity.diff.v1":
      return renderSensitivityDiffView(rec);
    case "backtest.coverage.v1":
      return renderCoverageView(rec);
    case "backtest.variant-plan.explain.v1":
      return renderVariantPlanExplainView(rec);
    case "backtest.sensitivity.matrix.v1":
      return renderMatrixView(rec);
    case "backtest.sensitivity.matrix.diff.v1":
      return renderMatrixDiffView(rec);
    case "backtest.research.manifest.v1":
      return renderResearchManifestView(rec);
    case "backtest.research.verify.v1":
      return renderResearchVerifyView(rec);
    case "backtest.research.manifest.diff.v1":
      return renderResearchManifestDiffView(rec);
    case "backtest.research.bundle.v1":
      return renderResearchBundleView(rec);
    case "backtest.research.status.v1":
      return renderResearchStatusView(rec);
    case "backtest.research.campaign.index.v1":
      return renderResearchCampaignIndexView(rec);
    case "backtest.research.bundle.diff.v1":
      return renderResearchBundleDiffView(rec);
    case "backtest.research.campaign.diff.v1":
      return renderResearchCampaignDiffView(rec);
    default:
      return null;
  }
}

/** True when the inspector ships a typed view for this schema id. */
export function hasTypedView(schema: string | null): boolean {
  if (schema === null) return false;
  // A tiny probe object is enough: buildTypedView returns null only for unknown ids.
  return buildTypedView(schema, {}) !== null;
}

/**
 * Select and render a typed, schema-aware view for a recognized artifact, or
 * return `null` so the caller falls back to the generic normalized view.
 *
 * Total and defensive: returns `null` for an unknown schema, for a non-object
 * value, and for ANY error thrown while building a view.
 */
export function renderTypedArtifactView(view: NormalizedArtifact, raw: unknown): RawHtml | null {
  const schema = view.schemaVersion;
  if (schema === null) return null;
  const rec = asRecord(raw);
  if (rec === null) return null;

  let body: RawHtml | null;
  try {
    body = buildTypedView(schema, rec);
  } catch {
    return null;
  }
  if (body === null) return null;

  const title = view.schemaInfo?.title ?? schema;
  return html`<div class="sm-typedview">
    ${RiskNotice({
      tone: "info",
      title: `Schema-aware view — ${title}`,
      body: html`A typed summary recognized from <code>${schema}</code>. This is a local, read-only
        rendering of fields the inspector understands; the generic field view and raw preview below
        always follow. No upload, no network, no execution.`,
    })}
    ${selfDeclaredNote(rec)}
    ${body}
  </div>`;
}
