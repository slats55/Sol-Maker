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
 * Sniper + Phase 6 simulation artifacts (S25–S87 backend schemas).
 *
 * Shared honesty rules for every renderer below:
 *   - These artifacts are PAPER/SIMULATION-only safety records. Views never
 *     phrase anything as an order, an execution, or live-trading readiness.
 *   - UNRESOLVED / UNAVAILABLE / BLOCKED states are the honest record of a
 *     capability boundary (no route resolver, no dry-run engine exists) and
 *     are rendered as such — never as success, never as failure.
 *   - Literal safety locks are echoed from the artifact's own data; a lock
 *     that reads unsafe gets a LOUD caution (the backend validator would
 *     refuse such an artifact — treat it as tampered).
 * ------------------------------------------------------------------ */

/** Render a capped string list as comma-joined `<code>` items (or a dash). */
function codeListDetail(list: StringListRead): HtmlValue {
  if (list.items.length === 0) return DASH;
  const joined = list.items.join(", ");
  const suffix = list.hidden > 0 ? ` (+${list.hidden} more)` : "";
  return html`<code>${joined}</code>${suffix}`;
}

/** A Section listing the artifact's reason-code trails (only those present). */
function reasonCodesSection(
  rec: Record<string, unknown>,
  fields: readonly { readonly key: string; readonly label: string }[],
): RawHtml | null {
  const items = fields
    .map(({ key, label }) => ({ label, list: readStringArray(rec, key) }))
    .filter(({ list }) => list.total > 0)
    .map(({ label, list }) => ({ term: `${label} (${list.total})`, detail: codeListDetail(list) }));
  if (items.length === 0) return null;
  return kvSection("Reason codes", "Stable machine-readable codes carried by the artifact itself.", items);
}

/**
 * Echo the artifact's literal safety locks. The locks are read from the data
 * (never assumed); a lock that reads UNSAFE is surfaced loudly — the backend
 * validators refuse such artifacts, so an unsafe claim means tampering.
 */
function safetyLocksSection(rec: Record<string, unknown>): RawHtml {
  const locks: readonly (readonly [string, string])[] = [
    ["neverAuthorizesLiveTrading", "must be true"],
    ["neverSigns", "must be true"],
    ["neverSends", "must be true"],
    ["dryRunOnly", "must be true"],
  ];
  const items: { term: string; detail: HtmlValue }[] = [];
  const violations: string[] = [];
  for (const [key] of locks) {
    const value = readBoolean(rec, key);
    if (value === false) violations.push(key);
    items.push({ term: key, detail: boolText(value) });
  }
  const phase7 = readBoolean(rec, "phase7LiveTradingReady");
  if (rec["phase7LiveTradingReady"] !== undefined) {
    if (phase7 !== false) violations.push("phase7LiveTradingReady");
    items.push({
      term: "phase7LiveTradingReady",
      detail: phase7 === false ? "no (a literal false — this artifact can never claim live-trading readiness)" : boolText(phase7),
    });
  }
  return html`
    ${kvSection("Safety locks (self-declared by the artifact)", "Echoed from the artifact's own data. The backend validators refuse any artifact whose locks read unsafe.", items)}
    ${
      violations.length > 0
        ? RiskNotice({
            tone: "caution",
            title: "Unsafe lock claim — treat this artifact as tampered",
            body: html`This artifact claims an unsafe state for: <code>${violations.join(", ")}</code>. The
              backend validators refuse such artifacts outright; do not trust any other field in it.`,
          })
        : null
    }
  `;
}

/** A one-line "next safe action" Section when the artifact carries one. */
function nextSafeActionSection(rec: Record<string, unknown>): RawHtml | null {
  const action = readString(rec, "nextSafeAction", 400);
  if (action === null) return null;
  return Section({
    title: "Next safe action (from the artifact)",
    body: html`<p class="sm-muted-line">${action}</p>`,
  });
}

/** Render the plan/source ref `{ planLabel, operatorLabel, blocked, entryCount }` shape. */
function planRefItems(ref: Record<string, unknown> | null): { term: string; detail: HtmlValue }[] {
  if (ref === null) return [{ term: "source plan", detail: "not present" }];
  return [
    { term: "plan label", detail: text(readString(ref, "planLabel")) },
    { term: "plan operator", detail: text(readString(ref, "operatorLabel")) },
    { term: "plan blocked", detail: boolText(readBoolean(ref, "blocked")) },
    { term: "plan entryCount", detail: num(readNumber(ref, "entryCount")) },
  ];
}

function renderSimulationIntentPlanView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const blocked = need(missing, "blocked", readBoolean(rec, "blocked"));
  const entryCount = need(missing, "entryCount", readNumber(rec, "entryCount"));
  const entries = readArray(rec, "entries") ?? [];
  const refs = readArray(rec, "sourceArtifactRefs") ?? [];

  const cap = capRows(entries);
  const entryRows = cap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "candidateId")),
      digestCode(readString(e, "mint")),
      text(readString(e, "previewStatus")),
      text(readStringArray(e, "unresolvedFields").items.join(", ") || null),
    ];
  });
  const refCap = capRows(refs);
  const refRows = refCap.shown.map((entry) => {
    const r = asRecord(entry) ?? {};
    return [
      text(readString(r, "role")),
      code(readString(r, "expectedSchemaVersion")),
      boolText(readBoolean(r, "present")),
      boolText(readBoolean(r, "valid")),
      text(readString(r, "label")),
    ];
  });

  return html`
    ${kvSection("Simulation intent plan (preview only — nothing executes)", "A fail-closed PREVIEW over the validated v2 chain. Unsupplied values stay UNRESOLVED, never invented.", [
      { term: "planLabel", detail: text(readString(rec, "planLabel")) },
      { term: "operatorLabel", detail: text(readString(rec, "operatorLabel")) },
      { term: "status", detail: blocked === true ? "BLOCKED (honest fail-closed state — zero previews built)" : blocked === false ? "unblocked preview" : DASH },
      { term: "entryCount", detail: num(entryCount) },
      { term: "unresolvedEntryCount", detail: num(readNumber(rec, "unresolvedEntryCount")) },
      { term: "paper-enter review acknowledged", detail: boolText(readBoolean(rec, "paperEnterReviewAcknowledgmentApplied")) },
    ])}
    ${safetyLocksSection(rec)}
    ${reasonCodesSection(rec, [
      { key: "blockingReasonCodes", label: "Blocking" },
      { key: "warningReasonCodes", label: "Warnings" },
      { key: "outcomeReasonCodes", label: "Outcomes" },
    ]) ?? ""}
    ${tableSection({
      title: "Preview entries (SIMULATED — never orders)",
      description: "Destination/amount/fee previews stay UNRESOLVED until a validated source exists; nothing is invented.",
      columns: [{ header: "Candidate" }, { header: "Mint" }, { header: "Preview status" }, { header: "Unresolved fields" }],
      rows: entryRows,
      empty: blocked === true ? "A blocked plan carries zero preview entries (honest)." : "No entries present.",
      caption: capCaption(cap, "entries"),
    })}
    ${tableSection({
      title: "Source artifact refs",
      columns: [{ header: "Role" }, { header: "Expected schema" }, { header: "Present" }, { header: "Valid" }, { header: "Label" }],
      rows: refRows,
      empty: "No source refs present.",
      caption: capCaption(refCap, "refs"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderSimulationResultView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const resultStatus = need(missing, "resultStatus", readString(rec, "resultStatus"));
  const dryRunAttempted = need(missing, "dryRunAttempted", readBoolean(rec, "dryRunAttempted"));
  const planRef = readRecord(rec, "sourcePlanRef");
  const adapter = readRecord(rec, "adapterSummary");
  const entries = readArray(rec, "entries") ?? [];

  const cap = capRows(entries);
  const entryRows = cap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "candidateId")),
      digestCode(readString(e, "mint")),
      text(readString(e, "entryStatus")),
      text(readString(e, "detail")),
    ];
  });

  return html`
    ${kvSection("Simulation result (dry-run-only — not an execution, not a trade)", "The honest record of one simulation pass. No real dry-run engine exists; skipped/unavailable is the truthful boundary, not a failure.", [
      { term: "resultStatus", detail: text(resultStatus) },
      { term: "dryRunAttempted", detail: dryRunAttempted === false ? "no (no dry-run capability exists inside the boundary — honestly reported, never faked)" : boolText(dryRunAttempted) },
      { term: "adapter", detail: code(adapter ? readString(adapter, "adapterId") : null) },
      ...planRefItems(planRef),
    ])}
    ${safetyLocksSection(rec)}
    ${tableSection({
      title: "Outcome tallies",
      columns: [{ header: "Measure" }, { header: "Count", align: "right" }],
      rows: [
        ["entries", num(readNumber(rec, "entryCount"))],
        ["skipped (unresolved preview)", num(readNumber(rec, "skippedCount"))],
        ["dry-run unavailable", num(readNumber(rec, "unavailableCount"))],
        ["failed safely", num(readNumber(rec, "failedCount"))],
        ["completed safely (still simulation only)", num(readNumber(rec, "completedCount"))],
      ],
      empty: "No tallies present.",
    })}
    ${reasonCodesSection(rec, [
      { key: "blockedReasonCodes", label: "Blocking" },
      { key: "warningReasonCodes", label: "Warnings" },
      { key: "outcomeReasonCodes", label: "Outcomes" },
    ]) ?? ""}
    ${tableSection({
      title: "Per-entry outcomes",
      columns: [{ header: "Candidate" }, { header: "Mint" }, { header: "Status" }, { header: "Detail" }],
      rows: entryRows,
      empty: "No entries present (a blocked result carries zero entries — honest).",
      caption: capCaption(cap, "entries"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderRouteResolutionView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const status = need(missing, "resolutionStatus", readString(rec, "resolutionStatus"));
  const resolverId = need(missing, "routeResolverId", readString(rec, "routeResolverId"));
  const attempted = readBoolean(rec, "routeResolverAttempted");
  const caveat = readBoolean(rec, "liveStateCaveat");
  const planRef = readRecord(rec, "sourcePlanRef");
  const entries = readArray(rec, "entries") ?? [];

  const cap = capRows(entries);
  const previewStatus = (e: Record<string, unknown>, key: string): string => {
    const p = readRecord(e, key);
    const s = p ? readString(p, "status") : null;
    if (s === "unresolved") return "UNRESOLVED (never invented)";
    if (s === "resolved-as-label") return `label: ${text(p ? readString(p, "label") : null)}`;
    return DASH;
  };
  const entryRows = cap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "candidateId")),
      digestCode(readString(e, "mint")),
      text(readString(e, "routeResolutionStatus")),
      previewStatus(e, "routePreview"),
      previewStatus(e, "destinationPreview"),
      previewStatus(e, "feePreview"),
    ];
  });

  return html`
    ${
      status === "unavailable"
        ? RiskNotice({
            tone: "info",
            title: "Route resolution UNAVAILABLE — the truthful capability boundary, not a failure",
            body: html`No route resolver exists inside the simulation boundary, so every entry is honestly
              UNAVAILABLE: route, destination, and fee stay unresolved — never invented, never fetched. A
              read-only quote observation (paper:routequote:prepare) or a future, separately-authorized
              resolution layer is the only path to resolved facts.`,
          })
        : status === "blocked"
          ? RiskNotice({
              tone: "caution",
              title: "Route resolution BLOCKED (fail-closed)",
              body: html`The source plan was missing, invalid, or blocked — or a stop switch was declared
                tripped. A blocked artifact carries zero entries; nothing is resolved over a blocked chain.`,
            })
          : attempted === true
            ? RiskNotice({
                tone: "info",
                title: "Read-only quote facts recorded — observation provenance only, never executable",
                body: html`Label facts entered this artifact from a READ-ONLY quote observation layer.
                  A quote proves a route was visible at some point — it may have expired, slippage is not
                  guaranteed, the route was never simulated, and nothing here can sign, send, or execute.
                  The live-state caveat applies to every label-resolved fact.`,
              })
            : null
    }
    ${kvSection("Route resolution (provenance only — never signs, never sends, never executes)", "The per-entry record of which route/destination/fee facts exist for a validated plan.", [
      { term: "resolutionStatus", detail: text(status === null ? null : status.toUpperCase()) },
      { term: "resolutionLabel", detail: text(readString(rec, "resolutionLabel")) },
      { term: "operatorLabel", detail: text(readString(rec, "operatorLabel")) },
      { term: "routeResolverId", detail: code(resolverId) },
      { term: "resolver attempted", detail: attempted === true ? "yes — read-only label facts with provenance (never execution)" : attempted === false ? "no — nothing was attempted; every fact stays honestly unresolved" : boolText(attempted) },
      { term: "live-state caveat", detail: caveat === true ? "YES — label-resolved facts come from live chain state; never a deterministic fixture" : boolText(caveat) },
      ...planRefItems(planRef),
    ])}
    ${safetyLocksSection(rec)}
    ${tableSection({
      title: "Resolution tallies",
      columns: [{ header: "Measure" }, { header: "Count", align: "right" }],
      rows: [
        ["entries", num(readNumber(rec, "entryCount"))],
        ["resolved", num(readNumber(rec, "resolvedEntryCount"))],
        ["unresolved", num(readNumber(rec, "unresolvedEntryCount"))],
        ["unavailable", num(readNumber(rec, "unavailableEntryCount"))],
      ],
      empty: "No tallies present.",
    })}
    ${reasonCodesSection(rec, [
      { key: "blockingReasonCodes", label: "Blocking" },
      { key: "warningReasonCodes", label: "Warnings" },
      { key: "outcomeReasonCodes", label: "Outcomes" },
    ]) ?? ""}
    ${tableSection({
      title: "Per-entry route facts",
      description: "A fact either exists as a validated label with provenance, or is honestly unresolved.",
      columns: [
        { header: "Candidate" },
        { header: "Mint" },
        { header: "Status" },
        { header: "Route" },
        { header: "Destination" },
        { header: "Fee" },
      ],
      rows: entryRows,
      empty: "No entries (a blocked route-resolution carries zero entries — honest).",
      caption: capCaption(cap, "entries"),
    })}
    ${nextSafeActionSection(rec) ?? ""}
    ${partialNotice(missing)}
  `;
}

/** The observation-only framing notice shared by both routequote views (S91). */
function routeQuoteObservationNotice(): RawHtml {
  return RiskNotice({
    tone: "info",
    title: "Read-only quote observation — never executable, never an order",
    body: html`A quote observation proves a route/quote was VISIBLE at some point — nothing more. It
      may have expired, slippage is not guaranteed, the route was never simulated, and nothing in
      this artifact can sign, send, build a transaction, or execute a route.`,
  });
}

function renderRouteQuoteObservationView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const quoteStatus = need(missing, "quoteStatus", readString(rec, "quoteStatus"));
  return html`
    ${routeQuoteObservationNotice()}
    ${kvSection("Quote observation (label-only facts)", "One operator-supplied READ-ONLY observation for one candidate mint. The outcome set is CLOSED — nothing can mean executable.", [
      { term: "quoteStatus", detail: text(quoteStatus) },
      { term: "source", detail: code(readString(rec, "source")) },
      { term: "candidateMint", detail: digestCode(readString(rec, "candidateMint")) },
      { term: "inputMint", detail: digestCode(readString(rec, "inputMint")) },
      { term: "outputMint", detail: digestCode(readString(rec, "outputMint")) },
      { term: "amountIn (label)", detail: text(readString(rec, "amountInLabel")) },
      { term: "amountOut (label)", detail: text(readString(rec, "amountOutLabel")) },
      { term: "venue (label)", detail: text(readString(rec, "venueLabel")) },
      { term: "fee (label)", detail: text(readString(rec, "feeLabel")) },
      { term: "observed at (operator label — never system time)", detail: text(readString(rec, "observedAtLabel")) },
      { term: "status reason", detail: text(readString(rec, "statusReason")) },
    ])}
    ${partialNotice(missing)}
  `;
}

function renderRouteQuotePreparedView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const observed = need(missing, "observedCount", readNumber(rec, "observedCount"));
  const entries = readArray(rec, "entries") ?? [];
  const caveats = readStringArray(rec, "caveats");

  const cap = capRows(entries);
  const entryRows = cap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    return [
      text(readString(e, "candidateId")),
      digestCode(readString(e, "mint")),
      text(readString(e, "quoteStatus")),
      text(readString(e, "routeLabel", 300)),
      text(readString(e, "feeLabel")),
      text(readString(e, "statusReason")),
    ];
  });

  return html`
    ${routeQuoteObservationNotice()}
    ${kvSection("Prepared route quote input (the S91 bridge)", "Quote observations paired to candidates BY MINT; observed entries carry deterministic label-only route facts the route-resolution stage may consume.", [
      { term: "resolver (provenance id)", detail: code(readString(rec, "resolverId")) },
      { term: "source", detail: text(readString(rec, "sourceLabel")) },
      { term: "candidate list", detail: text(readString(rec, "candidateListRef")) },
      { term: "entries", detail: num(readNumber(rec, "entryCount")) },
      { term: "validation", detail: text(readString(rec, "validationStatus")) },
      { term: "phase7LiveTradingReady", detail: boolText(readBoolean(rec, "phase7LiveTradingReady")) },
    ])}
    ${tableSection({
      title: "Quote outcomes (closed set)",
      description: "quote-observed | unavailable | blocked | error | unsupported — nothing here can ever mean executable.",
      columns: [{ header: "Outcome" }, { header: "Count", align: "right" }],
      rows: [
        ["quote-observed", num(observed)],
        ["unavailable", num(readNumber(rec, "unavailableCount"))],
        ["blocked", num(readNumber(rec, "blockedCount"))],
        ["error", num(readNumber(rec, "errorCount"))],
        ["unsupported", num(readNumber(rec, "unsupportedCount"))],
      ],
      empty: "No tallies present.",
    })}
    ${tableSection({
      title: "Per-candidate quote state",
      description: "A candidate without an observation stays honestly unavailable — never invented, never upgraded.",
      columns: [
        { header: "Candidate" },
        { header: "Mint" },
        { header: "Quote" },
        { header: "Route fact (label only)" },
        { header: "Fee (label)" },
        { header: "Reason" },
      ],
      rows: entryRows,
      empty: "No entries.",
      caption: capCaption(cap, "entries"),
    })}
    ${
      caveats.total > 0
        ? Section({
            title: `Mandatory caveats (${String(caveats.total)})`,
            description: "Carried verbatim by every observed quote — the validator refuses an artifact that drops one.",
            body: html`<ul class="sm-bullets sm-bullets--plain">
              ${caveats.items.map((c) => html`<li>${c}</li>`)}
            </ul>`,
          })
        : ""
    }
    ${partialNotice(missing)}
  `;
}

function renderPhase6AuditView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const auditPassed = need(missing, "auditPassed", readBoolean(rec, "auditPassed"));
  const chainComplete = need(missing, "chainComplete", readBoolean(rec, "chainComplete"));
  const artifacts = readArray(rec, "artifacts") ?? [];
  const findings = readArray(rec, "findings") ?? [];

  const artifactCap = capRows(artifacts);
  const artifactRows = artifactCap.shown.map((entry) => {
    const a = asRecord(entry) ?? {};
    const present = readBoolean(a, "present");
    const valid = readBoolean(a, "valid");
    return [
      text(readString(a, "role")),
      code(readString(a, "expectedSchemaVersion")),
      present === false ? "ABSENT" : valid === true ? "present, valid" : valid === false ? "present, INVALID" : DASH,
      text(readString(a, "label")),
    ];
  });
  const findingCap = capRows(findings);
  const findingRows = findingCap.shown.map((entry) => {
    const f = asRecord(entry) ?? {};
    return [
      code(readString(f, "code")),
      text(readStringArray(f, "roles").items.join(", ") || null),
      text(readString(f, "detail")),
    ];
  });

  return html`
    ${kvSection("Phase 6 chain audit (reports the chain — never authorizes anything)", "Each chain artifact strictly validated in place; structured cross-references checked; the chain's own conditions surfaced verbatim.", [
      { term: "audit verdict", detail: auditPassed === true ? "PASSED (no blocking finding)" : auditPassed === false ? "FAILED" : DASH },
      { term: "chain", detail: chainComplete === true ? "COMPLETE" : chainComplete === false ? "incomplete (missing artifacts are reported, never assumed)" : DASH },
      { term: "operatorLabel", detail: text(readString(rec, "operatorLabel")) },
      { term: "present / valid", detail: `${num(readNumber(rec, "presentCount"))} / ${num(readNumber(rec, "validCount"))}` },
      { term: "missing / invalid", detail: `${num(readNumber(rec, "missingCount"))} / ${num(readNumber(rec, "invalidCount"))}` },
      { term: "blocking findings", detail: num(readNumber(rec, "blockingFindingCount")) },
    ])}
    ${safetyLocksSection(rec)}
    ${tableSection({
      title: "Audited roles",
      description: "The ten audited chain roles — including the route-resolution role added by Sprint 87.",
      columns: [{ header: "Role" }, { header: "Expected schema" }, { header: "State" }, { header: "Label" }],
      rows: artifactRows,
      empty: "No artifact states present.",
      caption: capCaption(artifactCap, "roles"),
    })}
    ${tableSection({
      title: "Findings",
      columns: [{ header: "Code" }, { header: "Roles" }, { header: "Detail" }],
      rows: findingRows,
      empty: "No findings.",
      caption: capCaption(findingCap, "findings"),
    })}
    ${reasonCodesSection(rec, [{ key: "chainConditionCodes", label: "Chain conditions (verbatim — never waived)" }]) ?? ""}
    ${partialNotice(missing)}
  `;
}

function renderPhase6ReadinessView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const ready = need(missing, "phase6SimulationReady", readBoolean(rec, "phase6SimulationReady"));
  const checks = readArray(rec, "artifactChecks") ?? [];
  const evidence = readArray(rec, "evidence") ?? [];

  const checkCap = capRows(checks);
  const checkRows = checkCap.shown.map((entry) => {
    const c = asRecord(entry) ?? {};
    return [
      code(readString(c, "id")),
      boolText(readBoolean(c, "passed")),
      text(readString(c, "detail")),
    ];
  });
  const evidenceCap = capRows(evidence);
  const evidenceRows = evidenceCap.shown.map((entry) => {
    const e = asRecord(entry) ?? {};
    const declared = readBoolean(e, "declared");
    return [
      code(readString(e, "area")),
      declared === true ? "declared" : declared === false ? "NOT DECLARED (blocks readiness)" : DASH,
      text(readString(e, "ref")),
    ];
  });

  return html`
    ${kvSection("Phase 6 simulation readiness (simulation stack only — never live-trading readiness)", "Artifact checks are machine-verified; evidence references are DECLARATIONS recorded verbatim — the artifact cannot run tests and never claims it did.", [
      { term: "phase 6 simulation ready", detail: ready === true ? "YES (simulation stack only)" : ready === false ? "NO (fail-closed)" : DASH },
      { term: "phase 7 live trading ready", detail: "NO — a literal false, permanently; Phase 7 remains not started and unauthorized" },
      { term: "operatorLabel", detail: text(readString(rec, "operatorLabel")) },
    ])}
    ${safetyLocksSection(rec)}
    ${tableSection({
      title: "Artifact checks (machine-verified)",
      columns: [{ header: "Check" }, { header: "Passed" }, { header: "Detail" }],
      rows: checkRows,
      empty: "No artifact checks present.",
      caption: capCaption(checkCap, "checks"),
    })}
    ${tableSection({
      title: "Declared evidence (verbatim; never verified here)",
      description: "The eleven-area evidence bar — including route-resolution-tests (added by Sprint 86).",
      columns: [{ header: "Area" }, { header: "State" }, { header: "Reference" }],
      rows: evidenceRows,
      empty: "No evidence entries present.",
      caption: capCaption(evidenceCap, "areas"),
    })}
    ${reasonCodesSection(rec, [
      { key: "blockingReasonCodes", label: "Blocking" },
      { key: "warningReasonCodes", label: "Warnings" },
      { key: "outcomeReasonCodes", label: "Outcomes" },
    ]) ?? ""}
    ${partialNotice(missing)}
  `;
}

function renderPhase6HandoffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const complete = need(missing, "complete", readBoolean(rec, "complete"));
  const readiness = readBoolean(rec, "simulationReadyPerReadiness");
  const artifacts = readArray(rec, "artifacts") ?? [];

  const cap = capRows(artifacts);
  const artifactRows = cap.shown.map((entry) => {
    const a = asRecord(entry) ?? {};
    const present = readBoolean(a, "present");
    const valid = readBoolean(a, "valid");
    const summary = readRecord(a, "summary");
    const summaryText =
      summary === null
        ? DASH
        : Object.entries(summary)
            .slice(0, 8)
            .map(([k, v]) => `${k}=${v === null ? "null" : typeof v === "object" ? "…" : String(v)}`)
            .join("  ");
    return [
      text(readString(a, "role")),
      present === false ? "MISSING (classified, not invented)" : valid === true ? "present, valid" : valid === false ? "present, INVALID" : DASH,
      text(readString(a, "label")),
      summaryText,
    ];
  });
  const operatorReasons = readStringArray(rec, "operatorBlockingReasons");

  return html`
    ${kvSection("Phase 6 handoff pack (session handoff only — never signs, never sends, never authorizes)", "Each chain artifact strictly validated and summarized from verbatim structured fields.", [
      { term: "packLabel", detail: text(readString(rec, "packLabel")) },
      { term: "operatorLabel", detail: text(readString(rec, "operatorLabel")) },
      { term: "complete", detail: complete === true ? "yes — every handoff artifact present and strictly valid" : complete === false ? "no (missing/invalid artifacts classified honestly)" : DASH },
      { term: "valid / missing / invalid", detail: `${num(readNumber(rec, "validCount"))} / ${num(readNumber(rec, "missingCount"))} / ${num(readNumber(rec, "invalidCount"))}` },
      {
        term: "readiness verdict (verbatim)",
        detail:
          readiness === true
            ? "phase 6 SIMULATION ready (never live readiness)"
            : readiness === false
              ? "NOT ready"
              : "unknown — no valid readiness report supplied (never guessed)",
      },
    ])}
    ${safetyLocksSection(rec)}
    ${tableSection({
      title: "Handoff roles",
      description: "The twelve handed-off chain roles — including the route-resolution role added by Sprint 87.",
      columns: [{ header: "Role" }, { header: "State" }, { header: "Label" }, { header: "Summary (verbatim fields)" }],
      rows: artifactRows,
      empty: "No artifact states present.",
      caption: capCaption(cap, "roles"),
    })}
    ${reasonCodesSection(rec, [{ key: "chainBlockingCodes", label: "Chain blocking conditions (verbatim — never waived)" }]) ?? ""}
    ${
      operatorReasons.total > 0
        ? Section({
            title: `Operator-blocking reasons (${operatorReasons.total}; verbatim from the run report)`,
            body: html`<ul class="sm-bullets">
              ${operatorReasons.items.map((reason) => html`<li>${reason}</li>`)}
            </ul>`,
          })
        : null
    }
    ${nextSafeActionSection(rec) ?? ""}
    ${partialNotice(missing)}
  `;
}

function renderPhase6OperatorBundleView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const verdict = need(missing, "operatorVerdict", readString(rec, "operatorVerdict"));
  const complete = need(missing, "complete", readBoolean(rec, "complete"));
  const whatHappened = need(missing, "whatHappened", readString(rec, "whatHappened", 600));
  const trailConsistent = readBoolean(rec, "blockingTrailConsistent");
  const routeStatus = readString(rec, "routeResolutionStatus");
  const routeAttempted = readBoolean(rec, "routeResolverAttempted");
  const routeCaveat = readBoolean(rec, "routeLiveStateCaveat");
  const readiness = readBoolean(rec, "simulationReadyPerReadiness");
  const artifacts = readArray(rec, "artifacts") ?? [];
  const files = readArray(rec, "files") ?? [];
  const whyBlocked = readStringArray(rec, "whyBlocked");
  const inspectNext = readStringArray(rec, "whatToInspectNext");
  const operatorReasons = readStringArray(rec, "operatorBlockingReasons");

  // The closed-set operator verdict, rendered prominently and honestly. The BEST
  // possible verdict is reviewable-paper-only — there is deliberately no "ready"
  // and no live wording anywhere in this view.
  const verdictNotice =
    verdict === "blocked"
      ? RiskNotice({
          tone: "caution",
          title: "Operator verdict: BLOCKED — the bundled chain carries blocking state",
          body: html`Invalid artifacts, recomputed chain blocking conditions, or an inconsistent
            handoff trail block this bundle. The why-blocked lines below are deterministic and
            carried from the artifact itself.`,
        })
      : verdict === "incomplete"
        ? RiskNotice({
            tone: "caution",
            title: "Operator verdict: INCOMPLETE — missing artifacts are classified, never invented",
            body: html`At least one of the thirteen bundle roles was not supplied. An incomplete
              chain is reported honestly; nothing is assumed for the missing roles.`,
          })
        : verdict === "attention"
          ? RiskNotice({
              tone: "caution",
              title: "Operator verdict: ATTENTION — review before trusting this bundle",
              body: html`The chain is complete and carries no blocking condition, but the readiness
                verdict is not green or a route fact carries the live-state caveat.`,
            })
          : verdict === "reviewable-paper-only"
            ? RiskNotice({
                tone: "info",
                title: "Operator verdict: reviewable-paper-only — the BEST verdict this artifact can carry",
                body: html`The bundled chain is complete, strictly valid, and condition-free — and still
                  SIMULATION ONLY. An operator bundle is structurally incapable of claiming live-trading
                  readiness; nothing here is, or can become, a live action.`,
              })
            : RiskNotice({
                tone: "caution",
                title: "Operator verdict missing or unrecognized",
                body: html`The closed-set <code>operatorVerdict</code> field was absent or not one of the
                  known verdicts — treat this bundle's standing as unknown, never as reviewable.`,
              });

  // The trail-consistency verdict. A false here is the loudest state this view has:
  // the handoff pack's verbatim codes disagree with the codes recomputed from the
  // bundled artifacts — a stale or tampered pack, never papered over.
  const trailNotice =
    trailConsistent === false
      ? RiskNotice({
          tone: "caution",
          title: "Blocking trail INCONSISTENT — possible stale or TAMPERED handoff pack",
          body: html`The handoff pack's verbatim <code>chainBlockingCodes</code> disagree with the codes
            recomputed from the bundled artifacts, so the pack was not built from THIS artifact set.
            Do not trust the pack; rebuild it over these artifacts and rebuild this bundle.`,
        })
      : null;

  // Pair the per-role file refs (fileName + truncated sha256-128 digest) by role.
  const fileByRole = new Map<string, Record<string, unknown>>();
  for (const entry of files) {
    const f = asRecord(entry);
    if (f === null) continue;
    const role = readString(f, "role");
    if (role !== null && !fileByRole.has(role)) fileByRole.set(role, f);
  }

  const artifactCap = capRows(artifacts, TYPED_VIEW_LIMITS.maxRows);
  const artifactRows = artifactCap.shown.map((entry) => {
    const a = asRecord(entry) ?? {};
    const present = readBoolean(a, "present");
    const valid = readBoolean(a, "valid");
    const role = readString(a, "role");
    const file = role !== null ? (fileByRole.get(role) ?? null) : null;
    return [
      text(role),
      present === false ? "MISSING (classified, not invented)" : valid === true ? "present, valid" : valid === false ? "present, INVALID" : DASH,
      text(readString(a, "label")),
      code(file ? readString(file, "fileName") : null),
      digestCode(file ? readString(file, "digest") : null),
    ];
  });

  const bulletList = (list: StringListRead, deny: boolean): RawHtml => html`<ul
    class="sm-bullets${deny ? " sm-bullets--deny" : ""}">
    ${list.items.map((line) => html`<li>${line}</li>`)}
    ${list.hidden > 0 ? html`<li>+${list.hidden} more not shown.</li>` : null}
  </ul>`;

  return html`
    ${verdictNotice}
    ${trailNotice}
    ${kvSection("Phase 6 operator bundle (archive/review only — never signs, never sends, never authorizes live trading)", "The thirteen-role PAPER dry-run chain collected into one artifact: per-role state, file integrity refs, and a recomputed blocking trail.", [
      { term: "bundleLabel", detail: text(readString(rec, "bundleLabel")) },
      { term: "operatorLabel", detail: text(readString(rec, "operatorLabel")) },
      { term: "operator verdict", detail: text(verdict) },
      { term: "complete", detail: complete === true ? "yes — every bundled artifact present and strictly valid" : complete === false ? "no (missing/invalid artifacts classified honestly)" : DASH },
      { term: "present / valid", detail: `${num(readNumber(rec, "presentCount"))} / ${num(readNumber(rec, "validCount"))}` },
      { term: "missing / invalid", detail: `${num(readNumber(rec, "missingCount"))} / ${num(readNumber(rec, "invalidCount"))}` },
      {
        term: "blocking trail vs handoff pack",
        detail:
          trailConsistent === true
            ? "CONSISTENT — the pack's verbatim codes equal the recomputed trail"
            : trailConsistent === false
              ? "INCONSISTENT — stale or tampered pack (see warning above)"
              : "not fully recomputable (handoff pack or a trail source missing/invalid — reported honestly, never guessed)",
      },
      {
        term: "route resolution (verbatim)",
        detail:
          routeStatus === "unavailable"
            ? "UNAVAILABLE — the honest capability boundary (no route resolver exists); the expected Phase 6 state, not an error"
            : routeStatus === null
              ? "unknown — no valid route artifact bundled (never guessed)"
              : text(routeStatus.toUpperCase()),
      },
      { term: "route resolver attempted", detail: routeAttempted === false ? "no — no resolver capability exists inside the boundary" : boolText(routeAttempted) },
      { term: "route live-state caveat", detail: routeCaveat === true ? "YES — label-resolved facts come from live chain state; review before trusting comparisons" : boolText(routeCaveat) },
      {
        term: "readiness verdict (verbatim)",
        detail:
          readiness === true
            ? "phase 6 SIMULATION ready (never live readiness)"
            : readiness === false
              ? "NOT ready"
              : "unknown — no valid readiness report supplied (never guessed)",
      },
    ])}
    ${
      whatHappened !== null
        ? Section({
            title: "What happened (deterministic, from the artifact)",
            body: html`<p class="sm-muted-line">${whatHappened}</p>`,
          })
        : null
    }
    ${safetyLocksSection(rec)}
    ${tableSection({
      title: "Bundled roles",
      description:
        "The thirteen bundle roles — the twelve handoff roles plus the handoff pack itself (Sprint 88). File name + truncated sha256-128 digest are caller-supplied integrity refs carried verbatim.",
      columns: [{ header: "Role" }, { header: "State" }, { header: "Label" }, { header: "File" }, { header: "Digest" }],
      rows: artifactRows,
      empty: "No artifact states present.",
      caption: capCaption(artifactCap, "roles"),
    })}
    ${reasonCodesSection(rec, [
      { key: "chainBlockingCodes", label: "Chain blocking conditions (recomputed — never waived)" },
      { key: "handoffChainBlockingCodes", label: "Handoff pack's verbatim trail" },
    ]) ?? ""}
    ${
      whyBlocked.total > 0
        ? Section({
            title: `Why blocked (${whyBlocked.total}; deterministic operator lines — codes verbatim, never re-judged)`,
            body: bulletList(whyBlocked, true),
          })
        : null
    }
    ${
      operatorReasons.total > 0
        ? Section({
            title: `Operator-blocking reasons (${operatorReasons.total}; verbatim from the run report)`,
            body: bulletList(operatorReasons, false),
          })
        : null
    }
    ${
      inspectNext.total > 0
        ? Section({
            title: "What to inspect next (from the artifact)",
            body: bulletList(inspectNext, false),
          })
        : null
    }
    ${partialNotice(missing)}
  `;
}

function renderSimulationPlanDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const hasChange = need(missing, "hasChange", readBoolean(rec, "hasChange"));
  const hasNewBlocking = need(missing, "hasNewBlocking", readBoolean(rec, "hasNewBlocking"));
  const base = readRecord(rec, "base");
  const next = readRecord(rec, "next");

  const sideRow = (label: string, side: Record<string, unknown> | null): readonly HtmlValue[] => [
    label,
    text(side ? readString(side, "planLabel") : null),
    boolText(side ? readBoolean(side, "blocked") : null),
    num(side ? readNumber(side, "entryCount") : null),
    num(side ? readNumber(side, "unresolvedEntryCount") : null),
    num(side ? readNumber(side, "blockingCodeCount") : null),
  ];

  return html`
    ${flagNotice({
      flag: hasNewBlocking,
      trueTitle: "Newly blocking — the next plan carries blocking state the base did not",
      falseTitle: "No new blocking state",
      absentTitle: "hasNewBlocking flag missing",
      trueTone: "caution",
      reasons: readStringArray(rec, "blockingCodesAdded"),
      falseBody: html`Neither side introduced a new blocking condition.`,
    })}
    ${flagNotice({
      flag: hasChange,
      trueTitle: "Structured changes detected between the two plans",
      falseTitle: "Identical — no structured-field change",
      absentTitle: "hasChange flag missing",
      trueTone: "info",
      reasons: readStringArray(rec, "diffReasonCodes"),
      falseBody: html`The two plans agree on every compared structured field.`,
    })}
    ${tableSection({
      title: "Base vs next",
      columns: [
        { header: "Side" },
        { header: "Plan label" },
        { header: "Blocked" },
        { header: "Entries", align: "right" },
        { header: "Unresolved", align: "right" },
        { header: "Blocking codes", align: "right" },
      ],
      rows: [sideRow("base", base), sideRow("next", next)],
      empty: "Side summaries not present.",
    })}
    ${kvSection("Movements", undefined, [
      { term: "blocking codes added", detail: codeListDetail(readStringArray(rec, "blockingCodesAdded")) },
      { term: "blocking codes removed", detail: codeListDetail(readStringArray(rec, "blockingCodesRemoved")) },
      { term: "warning codes added", detail: codeListDetail(readStringArray(rec, "warningCodesAdded")) },
      { term: "warning codes removed", detail: codeListDetail(readStringArray(rec, "warningCodesRemoved")) },
      { term: "entries added", detail: codeListDetail(readStringArray(rec, "entriesAdded")) },
      { term: "entries removed", detail: codeListDetail(readStringArray(rec, "entriesRemoved")) },
    ])}
    ${partialNotice(missing)}
  `;
}

function renderSimulationResultDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const hasChange = need(missing, "hasChange", readBoolean(rec, "hasChange"));
  const hasNewBlocking = need(missing, "hasNewBlocking", readBoolean(rec, "hasNewBlocking"));
  const base = readRecord(rec, "base");
  const next = readRecord(rec, "next");

  const sideRow = (label: string, side: Record<string, unknown> | null): readonly HtmlValue[] => [
    label,
    text(side ? readString(side, "resultStatus") : null),
    code(side ? readString(side, "adapterId") : null),
    boolText(side ? readBoolean(side, "dryRunAttempted") : null),
    num(side ? readNumber(side, "entryCount") : null),
    num(side ? readNumber(side, "blockedCodeCount") : null),
  ];

  return html`
    ${flagNotice({
      flag: hasNewBlocking,
      trueTitle: "Newly blocking — the next result carries blocking state the base did not",
      falseTitle: "No new blocking state",
      absentTitle: "hasNewBlocking flag missing",
      trueTone: "caution",
      reasons: readStringArray(rec, "blockedCodesAdded"),
      falseBody: html`Neither side introduced a new blocking condition.`,
    })}
    ${flagNotice({
      flag: hasChange,
      trueTitle: "Structured changes detected between the two results",
      falseTitle: "Identical — no structured-field change",
      absentTitle: "hasChange flag missing",
      trueTone: "info",
      reasons: readStringArray(rec, "diffReasonCodes"),
      falseBody: html`The two results agree on every compared structured field.`,
    })}
    ${tableSection({
      title: "Base vs next",
      columns: [
        { header: "Side" },
        { header: "Result status" },
        { header: "Adapter" },
        { header: "Dry-run attempted" },
        { header: "Entries", align: "right" },
        { header: "Blocked codes", align: "right" },
      ],
      rows: [sideRow("base", base), sideRow("next", next)],
      empty: "Side summaries not present.",
    })}
    ${kvSection("Movements", undefined, [
      { term: "blocked codes added", detail: codeListDetail(readStringArray(rec, "blockedCodesAdded")) },
      { term: "blocked codes removed", detail: codeListDetail(readStringArray(rec, "blockedCodesRemoved")) },
      { term: "warning codes added", detail: codeListDetail(readStringArray(rec, "warningCodesAdded")) },
      { term: "warning codes removed", detail: codeListDetail(readStringArray(rec, "warningCodesRemoved")) },
      { term: "entries added", detail: codeListDetail(readStringArray(rec, "entriesAdded")) },
      { term: "entries removed", detail: codeListDetail(readStringArray(rec, "entriesRemoved")) },
    ])}
    ${partialNotice(missing)}
  `;
}

function renderSniperDecisionV2View(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const candidateCount = need(missing, "candidateCount", readNumber(rec, "candidateCount"));
  const paperEnterCount = need(missing, "paperEnterCount", readNumber(rec, "paperEnterCount"));
  const codeCounts = readRecord(rec, "reasonCodeCounts");
  const codeRows = codeCounts
    ? capRows(Object.entries(codeCounts)).shown.map(([codeKey, count]) => [
        code(codeKey),
        typeof count === "number" && Number.isFinite(count) ? num(count) : DASH,
      ])
    : [];

  return html`
    ${kvSection("Sniper paper decision report v2 (decisions are SIMULATED classifications — never orders)", undefined, [
      { term: "sourceLabel", detail: text(readString(rec, "sourceLabel")) },
      { term: "candidateCount", detail: num(candidateCount) },
      { term: "policy applied", detail: `${boolText(readBoolean(rec, "policyApplied"))}${readString(rec, "policyLabel") ? ` (${text(readString(rec, "policyLabel"))})` : ""}` },
      { term: "upgradedFromV1", detail: boolText(readBoolean(rec, "upgradedFromV1")) },
    ])}
    ${tableSection({
      title: "Decision tallies (paper-only)",
      columns: [{ header: "Decision" }, { header: "Count", align: "right" }],
      rows: [
        ["skip", num(readNumber(rec, "skipCount"))],
        ["watch", num(readNumber(rec, "watchCount"))],
        ["paper-enter (SIMULATED — demands operator review)", num(paperEnterCount)],
        ["paper-reject", num(readNumber(rec, "paperRejectCount"))],
        ["unknown (fail-closed, never guessed)", num(readNumber(rec, "unknownCount"))],
      ],
      empty: "No tallies present.",
    })}
    ${tableSection({
      title: "Reason-code occurrences",
      columns: [{ header: "Code" }, { header: "Count", align: "right" }],
      rows: codeRows,
      empty: "No per-candidate reason codes recorded.",
    })}
    ${reasonCodesSection(rec, [
      { key: "reportReasonCodes", label: "Report-level codes" },
      { key: "ciFailReasons", label: "CI fail reasons" },
      { key: "warnings", label: "Warnings" },
    ]) ?? ""}
    ${partialNotice(missing)}
  `;
}

function renderSniperRunReportV2View(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const candidateCount = need(missing, "candidateCount", readNumber(rec, "candidateCount"));
  const decisionSummary = readRecord(rec, "decisionSummary");
  const preflightSummary = readRecord(rec, "preflightSummary");
  const policy = readRecord(rec, "policySummary");
  const operatorReasons = readStringArray(rec, "operatorBlockingReasons");
  const candidates = readArray(rec, "candidates") ?? [];

  const cap = capRows(candidates);
  const candidateRows = cap.shown.map((entry) => {
    const c = asRecord(entry) ?? {};
    return [
      text(readString(c, "candidateId")),
      text(readString(c, "preflightStatus")),
      text(readString(c, "decision")),
      boolText(readBoolean(c, "riskBlocked")),
    ];
  });

  return html`
    ${kvSection("Sniper run report v2 (verbatim bundle — re-derives nothing; never a trade signal)", undefined, [
      { term: "operatorLabel", detail: text(readString(rec, "operatorLabel")) },
      { term: "sourceLabel", detail: text(readString(rec, "sourceLabel")) },
      { term: "candidateCount", detail: num(candidateCount) },
      { term: "decision artifact schema", detail: code(readString(rec, "decisionSchemaVersion")) },
      { term: "policy", detail: text(policy ? readString(policy, "policyLabel") : null) },
      { term: "missing required preflight input", detail: boolText(readBoolean(rec, "missingRequiredPreflightInput")) },
      { term: "unresolved unknowns", detail: codeListDetail(readStringArray(rec, "unresolvedUnknownIds")) },
      { term: "upgradedFromV1", detail: boolText(readBoolean(rec, "upgradedFromV1")) },
    ])}
    ${tableSection({
      title: "Decision tallies (paper-only, carried verbatim)",
      columns: [{ header: "Decision" }, { header: "Count", align: "right" }],
      rows: decisionSummary
        ? [
            ["skip", num(readNumber(decisionSummary, "skipCount"))],
            ["watch", num(readNumber(decisionSummary, "watchCount"))],
            ["paper-enter (SIMULATED)", num(readNumber(decisionSummary, "paperEnterCount"))],
            ["paper-reject", num(readNumber(decisionSummary, "paperRejectCount"))],
            ["unknown", num(readNumber(decisionSummary, "unknownCount"))],
          ]
        : [],
      empty: "decisionSummary not present.",
    })}
    ${tableSection({
      title: "Preflight tallies",
      columns: [{ header: "Status" }, { header: "Count", align: "right" }],
      rows: preflightSummary
        ? [
            ["pass", num(readNumber(preflightSummary, "passCount"))],
            ["warn", num(readNumber(preflightSummary, "warnCount"))],
            ["fail", num(readNumber(preflightSummary, "failCount"))],
            ["unknown", num(readNumber(preflightSummary, "unknownCount"))],
          ]
        : [],
      empty: "preflightSummary not present.",
    })}
    ${
      operatorReasons.total > 0
        ? RiskNotice({
            tone: "caution",
            title: `Operator-blocking reasons (${operatorReasons.total}) — must be resolved by a human`,
            body: html`<ul class="sm-bullets sm-bullets--deny">
              ${operatorReasons.items.map((reason) => html`<li>${reason}</li>`)}
            </ul>`,
          })
        : RiskNotice({
            tone: "info",
            title: "No operator-blocking reasons recorded",
            body: html`The run report lists nothing an operator must resolve — still a paper-only record,
              never a go-live signal.`,
          })
    }
    ${tableSection({
      title: "Candidates (verbatim)",
      columns: [{ header: "Candidate" }, { header: "Preflight" }, { header: "Decision" }, { header: "Risk blocked" }],
      rows: candidateRows,
      empty: "No candidates present.",
      caption: capCaption(cap, "candidates"),
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperRunReportDiffV2View(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const hasAnyChange = need(missing, "hasAnyChange", readBoolean(rec, "hasAnyChange"));
  const newOperatorBlocking = need(missing, "hasNewOperatorBlocking", readBoolean(rec, "hasNewOperatorBlocking"));
  const decisionChanges = readArray(rec, "decisionChanges") ?? [];
  const codeDeltas = readRecord(rec, "reasonCodeCountDeltas");

  const changeCap = capRows(decisionChanges);
  const changeRows = changeCap.shown.map((entry) => {
    const c = asRecord(entry) ?? {};
    return [
      text(readString(c, "candidateId")),
      `${text(readString(c, "from"))} → ${text(readString(c, "to"))}`,
    ];
  });
  const deltaRows = codeDeltas
    ? capRows(Object.entries(codeDeltas)).shown.map(([codeKey, delta]) => [
        code(codeKey),
        typeof delta === "number" && Number.isFinite(delta) ? signed(delta) : DASH,
      ])
    : [];

  return html`
    ${flagNotice({
      flag: newOperatorBlocking,
      trueTitle: "Newly operator-blocking — the next run needs human review the base did not",
      falseTitle: "No new operator-blocking reasons",
      absentTitle: "hasNewOperatorBlocking flag missing",
      trueTone: "caution",
      reasons: readStringArray(rec, "operatorBlockingReasonsAdded"),
      falseBody: html`No operator-blocking reason was added between the two runs.`,
    })}
    ${flagNotice({
      flag: hasAnyChange,
      trueTitle: "Changes detected between the two run reports (v1 core or v2 layer)",
      falseTitle: "Identical — no change in either layer",
      absentTitle: "hasAnyChange flag missing",
      trueTone: "info",
      reasons: { items: [], total: 0, hidden: 0 },
      falseBody: html`The two run reports agree on every compared structured field.`,
    })}
    ${kvSection("Transitions (paper-only classifications — never orders)", undefined, [
      { term: "newly paper-enter (SIMULATED)", detail: codeListDetail(readStringArray(rec, "newlyPaperEnterIds")) },
      { term: "no longer paper-enter", detail: codeListDetail(readStringArray(rec, "noLongerPaperEnterIds")) },
      { term: "newly unknown", detail: codeListDetail(readStringArray(rec, "newlyUnknownIds")) },
      { term: "candidates added", detail: codeListDetail(readStringArray(rec, "candidatesAdded")) },
      { term: "candidates removed", detail: codeListDetail(readStringArray(rec, "candidatesRemoved")) },
    ])}
    ${tableSection({
      title: "Decision changes",
      columns: [{ header: "Candidate" }, { header: "Transition" }],
      rows: changeRows,
      empty: "No decision changes.",
      caption: capCaption(changeCap, "changes"),
    })}
    ${tableSection({
      title: "Reason-code count deltas",
      columns: [{ header: "Code" }, { header: "Δ", align: "right" }],
      rows: deltaRows,
      empty: "No code-count deltas.",
    })}
    ${partialNotice(missing)}
  `;
}

/* ------------------------------------------------------------------ *
 * S93 — execution-lane views (rehearsal, readiness, tx simulation).
 * ------------------------------------------------------------------ */

/** Map a rehearsal/readiness stage or step status to a chip tone word (text only). */
function statusWord(status: string | null): string {
  return status ?? "unknown";
}

function renderSniperRehearsalView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const mode = need(missing, "mode", readString(rec, "mode"));
  const outcome = need(missing, "outcome", readString(rec, "outcome"));
  const stages = asArray(rec["stages"]) ?? [];
  const stageRows: (readonly HtmlValue[])[] = [];
  for (const row of stages.slice(0, 12)) {
    const stage = asRecord(row);
    if (stage === null) continue;
    stageRows.push([
      code(readString(stage, "stage")),
      text(statusWord(readString(stage, "status"))),
      text(readString(stage, "detail")),
      text(readString(stage, "nextCommand")),
    ]);
  }
  return html`
    ${RiskNotice({
      tone: "info",
      title: "Unified rehearsal stage record — no mode of this workflow can send on mainnet",
      body: html`Every stage is the existing production command, recorded honestly: a skipped stage
        names its exact standalone command, and a blocked stage is the system working. Closed mode
        set <code>paper | devnet | mainnet-dry-run</code>; the only send-capable stage is
        structurally limited to devnet mode behind its own double opt-in.`,
    })}
    ${kvSection("Rehearsal run", undefined, [
      { term: "mode", detail: code(mode) },
      { term: "outcome", detail: text(outcome) },
      {
        term: "risk evidence source",
        detail: text(
          readString(rec, "riskSource") === "automatic"
            ? "automatic (deep token:risk per candidate — S94)"
            : readString(rec, "riskSource") === "operator"
              ? "operator-supplied"
              : (readString(rec, "riskSource") ?? DASH),
        ),
      },
      { term: "generated at", detail: text(readString(rec, "generatedAt")) },
      { term: "executed / skipped / blocked", detail: text(`${num(readNumber(rec, "executedCount"))} / ${num(readNumber(rec, "skippedCount"))} / ${num(readNumber(rec, "blockedCount"))}`) },
      { term: "never sends on mainnet", detail: text(boolText(readBoolean(rec, "neverSendsOnMainnet"))) },
    ])}
    ${tableSection({
      title: "Stages",
      description: "Statuses verbatim from the run; next commands are the standalone production commands.",
      columns: [{ header: "Stage" }, { header: "Status" }, { header: "Detail" }, { header: "Next command" }],
      rows: stageRows,
      empty: "No stages recorded.",
    })}
    ${partialNotice(missing)}
  `;
}

function renderExecutionReadinessView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const verdict = need(missing, "verdict", readString(rec, "verdict"));
  const conditions = asArray(rec["conditions"]) ?? [];
  const conditionRows: (readonly HtmlValue[])[] = [];
  for (const row of conditions.slice(0, 20)) {
    const condition = asRecord(row);
    if (condition === null) continue;
    const satisfied = readBoolean(condition, "satisfied");
    conditionRows.push([
      text(satisfied === true ? "[x]" : "[ ]"),
      code(readString(condition, "gate")),
      text(readString(condition, "detail")),
      text(satisfied === true ? DASH : (readString(condition, "nextAction") ?? DASH)),
    ]);
  }
  const evidence = asRecord(rec["evidence"]);
  const freshness = evidence === null ? null : asRecord(evidence["quoteFreshness"]);
  return html`
    ${RiskNotice({
      tone: "caution",
      title: "Mainnet readiness checklist — structurally incapable of reporting armed",
      body: html`The CLI acknowledgment, the signer boundary, and the redaction findings evaluate
        only at execution time, so at least three conditions always remain unsatisfied here. The
        verdict literal is always <code>blocked</code>; nothing on this page is an authorization,
        and mainnet sending has no CLI surface at all.`,
    })}
    ${kvSection("Verdict", undefined, [
      { term: "verdict", detail: text(verdict) },
      { term: "network / evaluated for", detail: text(`${readString(rec, "network") ?? DASH} / ${readString(rec, "requestedMode") ?? DASH}`) },
      { term: "conditions satisfied", detail: text(`${num(readNumber(rec, "satisfiedCount"))} / ${num(readNumber(rec, "totalChecks"))}`) },
      { term: "blocked reason", detail: text(readString(rec, "blockedReason")) },
      { term: "next safe action", detail: text(readString(rec, "nextSafeAction")) },
    ])}
    ${(() => {
      const caps = asRecord(rec["caps"]);
      if (caps === null) return "";
      return kvSection("Operator caps in effect", "Null/UNSET means the operator never supplied the cap — no default exists by design.", [
        { term: "max spend per trade (SOL)", detail: num(readNumber(caps, "maxSpendPerTradeSol")) },
        { term: "session loss cap (SOL)", detail: num(readNumber(caps, "sessionLossCapSol")) },
        { term: "slippage cap (bps)", detail: num(readNumber(caps, "slippageCapBps")) },
        { term: "risk score cap", detail: num(readNumber(caps, "riskScoreCap")) },
        { term: "quote age cap (ms)", detail: num(readNumber(caps, "quoteAgeCapMs")) },
      ]);
    })()}
    ${(() => {
      const evidence = asRecord(rec["evidence"]);
      const risk = evidence === null ? null : asRecord(evidence["risk"]);
      if (risk === null) return "";
      const t22 = asArray(risk["token2022Flags"]) ?? [];
      const t22Rows: (readonly HtmlValue[])[] = [];
      for (const row of t22.slice(0, 16)) {
        const flag = asRecord(row);
        if (flag === null) continue;
        t22Rows.push([code(readString(flag, "id")), text(readString(flag, "severity"))]);
      }
      return html`
        ${kvSection("Risk evidence (condition 11)", "From the operator-named token:risk report — advisory, never a buy signal.", [
          { term: "score / cap", detail: text(`${num(readNumber(risk, "score"))} / ${num(readNumber(risk, "cap"))}`) },
          { term: "decision", detail: text(readString(risk, "decision")) },
          { term: "mint", detail: digestCode(readString(risk, "mint")) },
          { term: "source", detail: text(readString(risk, "source")) },
        ])}
        ${t22Rows.length === 0
          ? ""
          : tableSection({
              title: "Token-2022 extension flags on the risk evidence",
              description: "Critical/high entries are the extension blockers (hooks, permanent delegates, frozen defaults, fees).",
              columns: [{ header: "Flag" }, { header: "Severity" }],
              rows: t22Rows,
              empty: "",
            })}
      `;
    })()}
    ${freshness === null
      ? ""
      : kvSection("Quote freshness evidence (condition 9)", "Evaluated from a LIVE fetch report against the explicit operator cap — operator-supplied quote artifacts are refused as a freshness source.", [
          { term: "verdict", detail: text(readString(freshness, "verdict")) },
          { term: "fetched at", detail: text(readString(freshness, "fetchedAt")) },
          { term: "age (ms)", detail: num(readNumber(freshness, "ageMs")) },
          { term: "cap (ms)", detail: num(readNumber(freshness, "capMs")) },
          { term: "detail", detail: text(readString(freshness, "detail")) },
        ])}
    ${(() => {
      const session = evidence === null ? null : asRecord(evidence["sessionReconciliation"]);
      if (session === null) return "";
      const allowed = readBoolean(session, "newExecutionAllowed");
      return kvSection(
        "Session reconciliation evidence (S96)",
        "The last execution session's accounting state — an unaccounted session refuses new devnet execution attempts at the execution surfaces themselves.",
        [
          { term: "status", detail: code(readString(session, "status")) },
          { term: "new execution allowed", detail: text(allowed === true ? "yes" : allowed === false ? "NO — blocked by the refusal wall" : DASH) },
          { term: "session id", detail: text(readString(session, "sessionId") ?? "none") },
          { term: "blocked reason", detail: text(readString(session, "blockedReason") ?? "none") },
          { term: "next safe action", detail: text(readString(session, "nextSafeAction")) },
          { term: "ledger", detail: text(readString(session, "ledgerPath")) },
        ],
      );
    })()}
    ${tableSection({
      title: "The fourteen live-gate conditions",
      description: "Each gap names its exact next safe action — evidence collection, never authorization.",
      columns: [{ header: "" }, { header: "Condition" }, { header: "Detail" }, { header: "Next safe action" }],
      rows: conditionRows,
      empty: "No conditions present (not a valid readiness artifact).",
    })}
    ${partialNotice(missing)}
  `;
}

function renderDevnetRehearsalView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const outcome = need(missing, "outcome", readString(rec, "outcome"));
  const steps = asArray(rec["steps"]) ?? [];
  const stepRows: (readonly HtmlValue[])[] = [];
  for (const row of steps.slice(0, 10)) {
    const step = asRecord(row);
    if (step === null) continue;
    stepRows.push([code(readString(step, "step")), text(statusWord(readString(step, "status"))), text(readString(step, "detail"))]);
  }
  const airdrop = asRecord(rec["airdrop"]);
  const confirmation = asRecord(rec["confirmation"]);
  return html`
    ${RiskNotice({
      tone: "info",
      title: "Devnet end-to-end rehearsal — execution-discipline evidence, never mainnet readiness",
      body: html`A throwaway-funded self-transfer probe driven through the full execution chain on
        DEVNET ONLY (devnet SOL is valueless; sender == recipient, so no value moved). An airdrop
        rate limit becomes an honest <code>devnet-funding-blocked</code> artifact, never a faked
        success. Nothing here arms or substitutes for the fourteen-condition mainnet live gate.`,
    })}
    ${kvSection("Rehearsal", undefined, [
      { term: "outcome", detail: text(outcome) },
      { term: "network", detail: code(readString(rec, "network")) },
      { term: "endpoint", detail: code(readString(rec, "endpointHost")) },
      { term: "signer (public key)", detail: digestCode(readString(rec, "signerPublicKey")) },
      { term: "signer source", detail: text(readString(rec, "signerSource")) },
      { term: "signature", detail: digestCode(readString(rec, "signature")) },
      {
        term: "confirmed",
        detail: text(
          confirmation === null
            ? DASH
            : `${boolText(readBoolean(confirmation, "confirmed"))} (slot ${num(readNumber(confirmation, "slot"))}, ${num(readNumber(confirmation, "polls"))} poll(s))`,
        ),
      },
      {
        term: "airdrop",
        detail: text(
          airdrop === null
            ? DASH
            : `${readString(airdrop, "status") ?? "unknown"} (${num(readNumber(airdrop, "lamports"))} lamports requested${
                readNumber(airdrop, "attempts") !== null ? `; ${num(readNumber(airdrop, "attempts"))} bounded attempt(s)` : ""
              })`,
        ),
      },
      { term: "never mainnet", detail: text(boolText(readBoolean(rec, "neverMainnet"))) },
    ])}
    ${(() => {
      const guidance = asArray(rec["fundingGuidance"]);
      if (guidance === null || guidance.length === 0) return "";
      return kvSection(
        "Funding guidance (devnet-funding-blocked)",
        "Devnet faucet only — the throwaway keypair is reused on rerun, so external funding sticks to the same key. Never mainnet funding.",
        guidance.slice(0, 5).map((g, i) => ({ term: `step ${i + 1}`, detail: text(typeof g === "string" ? g : null) })),
      );
    })()}
    ${tableSection({
      title: "Steps",
      columns: [{ header: "Step" }, { header: "Status" }, { header: "Detail" }],
      rows: stepRows,
      empty: "No steps recorded.",
    })}
    ${partialNotice(missing)}
  `;
}

function renderTxSimulationReportView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const outcome = need(missing, "outcome", readString(rec, "outcome"));
  return html`
    ${RiskNotice({
      tone: "info",
      title: "Unsigned transaction simulation — evidence for review, never readiness",
      body: html`The real <code>simulateTransaction</code> with signature verification DISABLED over
        a strictly-validated UNSIGNED envelope — no signer or key exists at this boundary, and
        chain state moves every slot: a simulation that succeeded now can fail at execution time.`,
    })}
    ${kvSection("Simulation", undefined, [
      { term: "outcome", detail: text(outcome) },
      { term: "network", detail: code(readString(rec, "network")) },
      { term: "endpoint", detail: code(readString(rec, "endpointHost")) },
      { term: "builder", detail: code(readString(rec, "builderId")) },
      { term: "fee payer (public key)", detail: digestCode(readString(rec, "feePayerPublicKey")) },
      { term: "simulated at", detail: text(readString(rec, "simulatedAt")) },
      { term: "slot", detail: num(readNumber(rec, "slot")) },
      { term: "compute units", detail: num(readNumber(rec, "unitsConsumed")) },
      { term: "error", detail: text(readString(rec, "errLabel")) },
      { term: "never signs / never sends", detail: text(`${boolText(readBoolean(rec, "neverSigns"))} / ${boolText(readBoolean(rec, "neverSends"))}`) },
    ])}
    ${(() => {
      // S95: the deterministic failure classification + operator guidance (absent on pre-S95
      // reports — the view stays valid without it).
      const classification = readString(rec, "classification");
      if (classification === null || classification === "none") return "";
      return kvSection(
        "Failure classification (S95)",
        "Derived deterministically from the program error and bounded logs — a closed set, never a guess.",
        [
          { term: "classification", detail: code(classification) },
          { term: "what it means", detail: text(readString(rec, "classificationMessage")) },
          { term: "next safe action", detail: text(readString(rec, "classificationNextAction")) },
        ],
      );
    })()}
    ${partialNotice(missing)}
  `;
}

/** `txbuild.report.v1` — the S95 auditable record of one unsigned-build attempt. */
function renderTxBuildReportView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const outcome = need(missing, "outcome", readString(rec, "outcome"));
  const request = asRecord(rec["requestSummary"]);
  const quoteFacts = asRecord(rec["quoteFacts"]);
  const txFacts = asRecord(rec["txFacts"]);
  const refusals = asArray(rec["refusals"]) ?? [];
  const refusalRows: (readonly HtmlValue[])[] = [];
  for (const row of refusals.slice(0, 16)) {
    const refusal = asRecord(row);
    if (refusal === null) continue;
    refusalRows.push([
      code(readString(refusal, "code")),
      text(readString(refusal, "message")),
      text(readString(refusal, "nextAction")),
    ]);
  }
  return html`
    ${RiskNotice({
      tone: outcome === "built" ? "info" : "caution",
      title:
        outcome === "built"
          ? "Swap build attempt — BUILT (an unsigned envelope is simulation material, never an order)"
          : "Swap build attempt — REFUSED (a refused build is the system working, not a bug)",
      body: html`One auditable record of one build attempt. Nothing here was signed, nothing was
        sent, and mainnet live trading remains blocked by policy regardless of this outcome.`,
    })}
    ${kvSection("Attempt", undefined, [
      { term: "outcome", detail: text(outcome) },
      { term: "builder / endpoint", detail: text(`${readString(rec, "builderId") ?? DASH} @ ${readString(rec, "endpointHost") ?? DASH}`) },
      { term: "attempted at", detail: text(readString(rec, "attemptedAt")) },
      { term: "envelope written to", detail: text(readString(rec, "envelopeRef")) },
      { term: "never signs / never sends", detail: text(`${boolText(readBoolean(rec, "neverSigns"))} / ${boolText(readBoolean(rec, "neverSends"))}`) },
    ])}
    ${request === null
      ? ""
      : kvSection("Request summary (public facts)", undefined, [
          { term: "candidate mint", detail: digestCode(readString(request, "candidateMint")) },
          { term: "input mint", detail: digestCode(readString(request, "inputMint")) },
          { term: "amount (raw)", detail: text(readString(request, "amountRaw")) },
          { term: "slippage (bps)", detail: num(readNumber(request, "slippageBps")) },
          { term: "wallet (public key)", detail: digestCode(readString(request, "walletPublicKey")) },
          { term: "network / mode", detail: text(`${readString(request, "network") ?? DASH} / ${readString(request, "executionMode") ?? DASH}`) },
          { term: "program allowlist", detail: text(readBoolean(request, "programAllowlistActive") === true ? "ACTIVE" : "not supplied (no program check)") },
        ])}
    ${tableSection({
      title: "Refusals",
      description: "Every refusal names its closed-set code, what it means, and the exact next safe action. Deterministic: the same request facts produce the same codes.",
      columns: [{ header: "Code" }, { header: "What it means" }, { header: "Next safe action" }],
      rows: refusalRows,
      empty: outcome === "built" ? "None — every check passed." : "No refusal rows present.",
    })}
    ${quoteFacts === null
      ? ""
      : kvSection("Fresh-quote facts", "Fetched in-process at build time; quotes expire within seconds.", [
          { term: "in / out (raw)", detail: text(`${readString(quoteFacts, "inAmountRaw") ?? DASH} → ${readString(quoteFacts, "outAmountRaw") ?? DASH}`) },
          { term: "price impact (%)", detail: text(readString(quoteFacts, "priceImpactPct")) },
          { term: "context slot", detail: num(readNumber(quoteFacts, "contextSlot")) },
          { term: "quoted at", detail: text(readString(quoteFacts, "quotedAt")) },
        ])}
    ${txFacts === null
      ? ""
      : kvSection("Transaction shape facts (S95)", "Decoded from the strictly-validated UNSIGNED envelope — public structure only, never the transaction body.", [
          { term: "version / supported", detail: text(`${readString(txFacts, "version") ?? num(readNumber(txFacts, "version"))} / ${boolText(readBoolean(txFacts, "versionSupported"))}`) },
          { term: "recent blockhash present", detail: text(boolText(readBoolean(txFacts, "blockhashPresent"))) },
          { term: "instructions", detail: num(readNumber(txFacts, "instructionCount")) },
          { term: "static programs", detail: num((asArray(txFacts["staticProgramIds"]) ?? []).length) },
          { term: "address-table lookups", detail: num(readNumber(txFacts, "addressTableLookupCount")) },
          { term: "unresolvable program ids", detail: num(readNumber(txFacts, "unresolvableProgramIdCount")) },
        ])}
    ${partialNotice(missing)}
  `;
}

function renderReconciliationReportView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const verdict = need(missing, "verdict", readString(rec, "verdict"));
  const cleared = verdict === "reconciled" || verdict === "not-sent" || verdict === "funding-blocked";
  const confirmation = asRecord(rec["confirmation"]);
  const pre = asRecord(rec["pre"]);
  const post = asRecord(rec["post"]);
  const delta = asRecord(rec["delta"]);
  const tokenDelta = delta === null ? null : asRecord(delta["token"]);
  const fee = asRecord(rec["fee"]);
  const expected = asRecord(rec["expected"]);
  const solOf = (snapshot: Record<string, unknown> | null): string => {
    const sol = snapshot === null ? null : asRecord(snapshot["sol"]);
    if (sol === null) return DASH;
    const status = readString(sol, "status");
    return status === "observed" ? `${readNumber(sol, "lamports") ?? DASH} lamports` : `${status ?? DASH} (not observed)`;
  };
  return html`
    ${RiskNotice({
      tone: cleared ? "info" : "caution",
      title: cleared
        ? `Reconciliation — ${(verdict ?? "").toUpperCase()} (this session is accounted for)`
        : `Reconciliation — ${(verdict ?? "unknown").toUpperCase()} (new execution attempts stay BLOCKED until this session is accounted for)`,
      body: html`Post-trade accounting over one execution session. Every balance fact is an actual
        RPC observation or an honest unavailable — nothing is estimated, no P/L is invented, and an
        unconfirmed submission is never upgraded. Mainnet live trading remains disabled regardless
        of this verdict.`,
    })}
    ${kvSection("Session", undefined, [
      { term: "verdict", detail: code(verdict) },
      { term: "session id", detail: text(readString(rec, "sessionId")) },
      { term: "mode / network", detail: text(`${readString(rec, "mode") ?? DASH} / ${readString(rec, "network") ?? DASH}`) },
      { term: "recorded by", detail: text(readString(rec, "command")) },
      { term: "signature", detail: digestCode(readString(rec, "signature") ?? "none (nothing was submitted)") },
      { term: "created at", detail: text(readString(rec, "createdAt")) },
      { term: "redaction applied", detail: text(boolText(readBoolean(rec, "redactionApplied"))) },
    ])}
    ${confirmation === null
      ? ""
      : kvSection("Confirmation classification", "Closed set: confirmed | finalized | timeout | dropped | rpc-unavailable | signature-error | unknown. None of the guidance ever says resend.", [
          { term: "outcome", detail: code(readString(confirmation, "outcome")) },
          { term: "slot", detail: num(readNumber(confirmation, "slot")) },
          { term: "polls (bounded)", detail: num(readNumber(confirmation, "polls")) },
          { term: "error label", detail: text(readString(confirmation, "errLabel") ?? "none") },
          { term: "guidance", detail: text(readString(confirmation, "guidance")) },
        ])}
    ${kvSection("Balance facts (actual observations only)", undefined, [
      { term: "pre", detail: text(solOf(pre)) },
      { term: "post", detail: text(solOf(post)) },
      {
        term: "SOL delta",
        detail:
          delta !== null && readString(delta, "solStatus") === "computed"
            ? text(`${readNumber(delta, "solLamports") ?? DASH} lamports`)
            : text("unavailable (pre/post not both observed)"),
      },
      {
        term: "token delta",
        detail:
          tokenDelta === null
            ? text("not applicable (no token mint in the reads)")
            : readString(tokenDelta, "status") === "computed"
              ? text(`${readString(tokenDelta, "amountRawDelta") ?? DASH} raw (${readString(tokenDelta, "mint") ?? DASH})`)
              : text("unavailable"),
      },
      {
        term: "fee",
        detail:
          fee === null
            ? text(DASH)
            : text(
                `${readNumber(fee, "actualLamports") ?? readNumber(fee, "estimatedLamports") ?? "unavailable"} lamports (${readString(fee, "source") ?? DASH})`,
              ),
      },
    ])}
    ${kvSection("Expected vs actual", undefined, [
      { term: "expected", detail: text(expected === null ? DASH : readString(expected, "summary")) },
      { term: "actual", detail: text(readString(rec, "actualSummary")) },
      { term: "blocked reason", detail: text(readString(rec, "blockedReason") ?? "none") },
      { term: "next safe action", detail: text(readString(rec, "nextSafeAction")) },
    ])}
    ${partialNotice(missing)}
  `;
}

function renderSessionStatusView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const decision = asRecord(rec["decision"]);
  const allowed = decision === null ? null : readBoolean(decision, "allowed");
  const latestSession = asRecord(rec["latestSession"]);
  const entryRows: (readonly HtmlValue[])[] = [];
  for (const row of (latestSession === null ? [] : (asArray(latestSession["entries"]) ?? [])).slice(0, 16)) {
    const entry = asRecord(row);
    if (entry === null) continue;
    const kind = readString(entry, "kind");
    entryRows.push([
      text(readString(entry, "recordedAt")),
      code(kind),
      text(readString(entry, "command")),
      text(
        kind === "reconciliation"
          ? `verdict ${readString(entry, "reconciliationVerdict") ?? DASH}`
          : kind === "manual-acknowledgment"
            ? `reason: ${readString(entry, "reason") ?? DASH}`
            : `outcome ${readString(entry, "executionOutcome") ?? DASH}`,
      ),
    ]);
  }
  need(missing, "decision", decision === null ? null : "present");
  return html`
    ${RiskNotice({
      tone: allowed === true ? "info" : "caution",
      title:
        allowed === true
          ? "Session accounting — a new devnet execution attempt is ALLOWED"
          : "Session accounting — new devnet execution attempts are BLOCKED (the refusal wall is working)",
      body: html`The read-only accounting state of the latest execution session. A new attempt
        proceeds only after the previous one is reconciled, was never sent, was funding-blocked, or
        was explicitly acknowledged with an audited reason. There is no bypass flag. Mainnet live
        trading remains disabled regardless.`,
    })}
    ${kvSection("Continuation decision", undefined, [
      { term: "status", detail: code(decision === null ? null : readString(decision, "status")) },
      { term: "new attempt allowed", detail: text(boolText(allowed)) },
      { term: "session id", detail: text(decision === null ? DASH : readString(decision, "sessionId") ?? "none") },
      { term: "blocked reason", detail: text(decision === null ? DASH : readString(decision, "blockedReason") ?? "none") },
      { term: "next safe action", detail: text(decision === null ? DASH : readString(decision, "nextSafeAction")) },
    ])}
    ${kvSection("Ledger", undefined, [
      { term: "path", detail: text(readString(rec, "ledgerPath")) },
      { term: "present", detail: text(boolText(readBoolean(rec, "ledgerPresent"))) },
      { term: "entries / network", detail: text(`${num(readNumber(rec, "entryCount"))} / ${readString(rec, "network") ?? DASH}`) },
      { term: "malformed lines", detail: num(readNumber(rec, "malformedLines")) },
      { term: "created at", detail: text(readString(rec, "createdAt")) },
    ])}
    ${tableSection({
      title: "Latest session entries",
      description: "The append-only trail for the latest session: attempts, reconciliations, acknowledgments.",
      columns: [{ header: "Recorded at" }, { header: "Kind" }, { header: "Command" }, { header: "Detail" }],
      rows: entryRows,
      empty: "No session entries — no execution attempt has been recorded on this network.",
    })}
    ${partialNotice(missing)}
  `;
}

function renderEngineStatusView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const signer = need(missing, "signerSupport", readString(rec, "signerSupport"));
  const send = need(missing, "sendSupport", readString(rec, "sendSupport"));
  const mainnetSend = need(missing, "mainnetSendSupport", readString(rec, "mainnetSendSupport"));
  const allDisabled = signer === "disabled" && send === "disabled" && mainnetSend === "disabled";
  const supported = readStringArray(rec, "supportedCapabilities");
  const disabled = readStringArray(rec, "disabledCapabilities");
  const caveats = readStringArray(rec, "caveats");
  return html`
    ${RiskNotice({
      tone: allDisabled ? "info" : "caution",
      title: allDisabled
        ? "Rust engine sidecar — foundation only, every execution capability disabled"
        : "Rust engine artifact claims a capability the foundation forbids — do NOT trust this artifact",
      body: html`The S97 Rust sidecar's self-description. TypeScript is the validation authority:
        the CLI refuses this artifact unless signer, send, and mainnet-send support are all
        literally <code>disabled</code>. The engine has no signing, sending, wallet, key, or
        network code path by construction.`,
    })}
    ${kvSection("Engine", undefined, [
      { term: "engine", detail: text(`${readString(rec, "engineName") ?? DASH} ${readString(rec, "engineVersion") ?? ""}`) },
      { term: "build profile", detail: code(readString(rec, "buildProfile")) },
      { term: "rustc", detail: text(readString(rec, "rustcVersion") ?? "unavailable") },
      { term: "ipc version", detail: code(readString(rec, "ipcVersion")) },
      { term: "safety mode", detail: code(readString(rec, "safetyMode")) },
      { term: "created at", detail: text(readString(rec, "createdAt") ?? "none (orchestrator supplied none)") },
    ])}
    ${kvSection("Safety markers (must all be disabled)", undefined, [
      { term: "signer support", detail: code(signer) },
      { term: "send support", detail: code(send) },
      { term: "mainnet send support", detail: code(mainnetSend) },
      { term: "never sends", detail: boolText(readBoolean(rec, "neverSends")) },
      { term: "phase7LiveTradingReady", detail: boolText(readBoolean(rec, "phase7LiveTradingReady")) },
    ])}
    ${tableSection({
      title: "Capabilities",
      description: "Supported is a CLOSED allowlist (status, JSON IPC, schema parity); disabled names what the engine structurally cannot do.",
      columns: [{ header: "Kind" }, { header: "Capabilities" }],
      rows: [
        ["supported", text(supported.items.join(", "))],
        ["disabled", text(disabled.items.join(", "))],
      ],
      empty: "No capability lists present.",
    })}
    ${
      caveats.total > 0
        ? Section({
            title: `Caveats (${String(caveats.total)})`,
            description: "Carried by every engine status artifact.",
            body: html`<ul class="sm-bullets sm-bullets--plain">
              ${caveats.items.map((c) => html`<li>${c}</li>`)}
            </ul>`,
          })
        : ""
    }
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
    case "sniper.paper.decision.report.v2":
      return renderSniperDecisionV2View(rec);
    case "sniper.run.report.v2":
      return renderSniperRunReportV2View(rec);
    case "sniper.run.report.diff.v2":
      return renderSniperRunReportDiffV2View(rec);
    case "simulation.intent.plan.v2":
      return renderSimulationIntentPlanView(rec);
    case "simulation.result.v1":
      return renderSimulationResultView(rec);
    case "simulation.route.resolution.v1":
      return renderRouteResolutionView(rec);
    case "routequote.observation.input.v1":
      return renderRouteQuoteObservationView(rec);
    case "routequote.prepared.v1":
      return renderRouteQuotePreparedView(rec);
    case "simulation.intent.plan.diff.v2":
      return renderSimulationPlanDiffView(rec);
    case "simulation.result.diff.v1":
      return renderSimulationResultDiffView(rec);
    case "phase6.audit.report.v1":
      return renderPhase6AuditView(rec);
    case "phase6.simulation.readiness.report.v1":
      return renderPhase6ReadinessView(rec);
    case "phase6.simulation.handoff.pack.v1":
      return renderPhase6HandoffView(rec);
    case "phase6.operator.bundle.v1":
      return renderPhase6OperatorBundleView(rec);
    case "sniper.rehearsal.report.v1":
      return renderSniperRehearsalView(rec);
    case "execution.readiness.report.v1":
      return renderExecutionReadinessView(rec);
    case "execution.devnet.rehearsal.report.v1":
      return renderDevnetRehearsalView(rec);
    case "txpreview.simulation.report.v1":
      return renderTxSimulationReportView(rec);
    case "txbuild.report.v1":
      return renderTxBuildReportView(rec);
    case "execution.reconciliation.report.v1":
      return renderReconciliationReportView(rec);
    case "execution.session.status.v1":
      return renderSessionStatusView(rec);
    case "engine.status.report.v1":
      return renderEngineStatusView(rec);
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
