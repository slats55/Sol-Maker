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

function renderEngineRealtimeObservationsView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const sourceKind = need(missing, "sourceKind", readString(rec, "sourceKind"));
  const status = need(missing, "status", readString(rec, "status"));
  const eventCount = need(missing, "eventCount", readNumber(rec, "eventCount"));
  const observationCount = need(missing, "observationCount", readNumber(rec, "observationCount"));
  const duplicateMintCount = readNumber(rec, "duplicateMintCount");
  const caveats = readStringArray(rec, "caveats");
  const isReplay = sourceKind === "replay";
  const observations = Array.isArray(rec.observations)
    ? rec.observations.filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null && !Array.isArray(o))
    : [];
  return html`
    ${RiskNotice({
      tone: isReplay ? "info" : "caution",
      title: isReplay
        ? "Rust engine replay observations — NOT live market data, never an order"
        : "Engine realtime artifact claims a non-replay source — do NOT trust this artifact",
      body: html`Candidate observations the S98 Rust sidecar normalized from an operator-supplied
        REPLAY file over bounded stdin. TypeScript strictly validates every observation before
        anything reads it and folds them into the existing realtime snapshot; the engine has no
        network, signing, or sending code path by construction.`,
    })}
    ${kvSection("Normalization", undefined, [
      { term: "engine", detail: text(`${readString(rec, "engineName") ?? DASH} ${readString(rec, "engineVersion") ?? ""}`) },
      { term: "ipc version", detail: code(readString(rec, "ipcVersion")) },
      { term: "provider", detail: code(readString(rec, "providerId")) },
      { term: "source kind", detail: code(sourceKind) },
      { term: "status", detail: code(status) },
      { term: "events", detail: text(`${num(eventCount)} replayed → ${num(observationCount)} observations (${num(duplicateMintCount)} duplicate mints skipped)`) },
      { term: "created at", detail: text(readString(rec, "createdAt") ?? "none (orchestrator supplied none)") },
    ])}
    ${tableSection({
      title: `Observations (${String(observations.length)})`,
      description: "Market figures are provider-reported HINTS (unverified); every observation carries the replay caveat.",
      columns: [{ header: "Candidate" }, { header: "Symbol" }, { header: "Mint" }, { header: "Launchpad" }, { header: "Liquidity hint (USD)" }],
      rows: observations.slice(0, 50).map((obs) => [
        code(readString(obs, "candidateId")),
        text(readString(obs, "symbol") ?? DASH),
        code(readString(obs, "mint")),
        text(readString(obs, "launchpadLabel") ?? DASH),
        text(readNumber(obs, "liquidityUsdHint") !== null ? num(readNumber(obs, "liquidityUsdHint")) : DASH),
      ]),
      empty: "No observations (the replay file held no usable events).",
    })}
    ${
      caveats.total > 0
        ? Section({
            title: `Caveats (${String(caveats.total)})`,
            description: "Carried by every engine realtime artifact.",
            body: html`<ul class="sm-bullets sm-bullets--plain">
              ${caveats.items.map((c) => html`<li>${c}</li>`)}
            </ul>`,
          })
        : ""
    }
    ${partialNotice(missing)}
  `;
}

function renderEngineQuoteScoreView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const scoredAt = need(missing, "scoredAt", readString(rec, "scoredAt"));
  const maxAge = need(missing, "maxQuoteAgeMs", readNumber(rec, "maxQuoteAgeMs"));
  const includedCount = need(missing, "includedCount", readNumber(rec, "includedCount"));
  const excludedCount = readNumber(rec, "excludedCount");
  const best = readString(rec, "bestCandidateId");
  const caveats = readStringArray(rec, "caveats");
  const profitClaim = rec.notProfitabilityClaim === true && rec.notExecutable === true;
  const entries = Array.isArray(rec.entries)
    ? rec.entries.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e))
    : [];
  return html`
    ${RiskNotice({
      tone: profitClaim ? "info" : "caution",
      title: profitClaim
        ? "Rust engine route quote scores — intelligence only, never a profitability claim"
        : "Engine score artifact is missing its safety literals — do NOT trust this artifact",
      body: html`Quote-quality scores the S99 Rust sidecar computed from a read-only fetch report.
        TypeScript recomputes every score and re-evaluates every freshness verdict with the real
        evaluator before accepting the artifact. A score ranks quote quality (impact, hops, age) —
        it is never readiness, never an order, never execution.`,
    })}
    ${kvSection("Scoring", undefined, [
      { term: "engine", detail: text(`${readString(rec, "engineName") ?? DASH} ${readString(rec, "engineVersion") ?? ""}`) },
      { term: "provider", detail: code(readString(rec, "providerId")) },
      { term: "report fetched", detail: text(readString(rec, "reportFetchedAt") ?? DASH) },
      { term: "scored at", detail: text(scoredAt ?? DASH) },
      { term: "explicit age cap", detail: text(maxAge !== null && maxAge !== undefined ? `${num(maxAge)} ms (operator-supplied; no default exists)` : DASH) },
      { term: "entries", detail: text(`${num(includedCount)} included / ${num(excludedCount)} excluded`) },
      { term: "best candidate", detail: best !== null && best !== undefined ? code(best) : text("none (no entry was both observed and fresh)") },
    ])}
    ${tableSection({
      title: `Scored entries (${String(entries.length)})`,
      description: "Score = 100 minus impact/hop/age penalties; excluded entries always carry a closed reason code.",
      columns: [{ header: "Candidate" }, { header: "Score" }, { header: "Freshness" }, { header: "Impact %" }, { header: "Route" }, { header: "Reasons" }],
      rows: entries.slice(0, 50).map((entry) => {
        const facts = (typeof entry.facts === "object" && entry.facts !== null ? entry.facts : {}) as Record<string, unknown>;
        const reasons = readStringArray(entry, "reasons");
        const route = readStringArray(facts, "routeLabels");
        return [
          code(readString(entry, "candidateId")),
          text(entry.included === true ? num(readNumber(entry, "score")) : "excluded"),
          code(readString(facts, "freshnessVerdict")),
          text(readString(facts, "priceImpactPct") ?? DASH),
          text(route.items.length > 0 ? route.items.join(" > ") : DASH),
          text(reasons.items.length > 0 ? reasons.items.join(", ") : DASH),
        ];
      }),
      empty: "No entries (the fetch report held none).",
    })}
    ${
      caveats.total > 0
        ? Section({
            title: `Caveats (${String(caveats.total)})`,
            description: "Carried by every engine score artifact.",
            body: html`<ul class="sm-bullets sm-bullets--plain">
              ${caveats.items.map((c) => html`<li>${c}</li>`)}
            </ul>`,
          })
        : ""
    }
    ${partialNotice(missing)}
  `;
}

function renderSniperCandidateScoreView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const candidateCount = need(missing, "candidateCount", readNumber(rec, "candidateCount"));
  const best = readString(rec, "bestCandidateId");
  const caveats = readStringArray(rec, "caveats");
  const safe =
    rec.notExecutable === true &&
    rec.notProfitabilityClaim === true &&
    rec.scoreIsNotLiveReadiness === true &&
    rec.highScoreIsNotSafeToTrade === true;
  const ranked = Array.isArray(rec.rankedCandidates)
    ? rec.rankedCandidates.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e))
    : [];
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Rust engine candidate scores — operator intelligence only, NOT live readiness"
        : "Engine score artifact is missing its safety literals — do NOT trust this artifact",
      body: html`A deterministic memecoin candidate ranking the S101 Rust sidecar computed from a
        read-only facts bundle. TypeScript re-derives every component, score, verdict, and the ranking
        and cross-checks the echoed facts before accepting the artifact. A high score is <strong>not</strong>
        a "safe to trade" judgment, and a rejected risk (or a critical flag / Token-2022 blocker) stays
        <strong>reject</strong> no matter the score — the score satisfies none of the mainnet live-gate
        conditions and gates nothing.`,
    })}
    ${kvSection("Scoring", undefined, [
      { term: "engine", detail: text(`${readString(rec, "engineName") ?? DASH} ${readString(rec, "engineVersion") ?? ""}`) },
      { term: "engine source", detail: code(readString(rec, "engineSource")) },
      { term: "mode", detail: text(`${readString(rec, "mode") ?? DASH} (${readString(rec, "network") ?? "network unspecified"})`) },
      { term: "candidates", detail: text(num(candidateCount)) },
      { term: "best candidate", detail: best !== null && best !== undefined ? code(best) : text("none (no candidates)") },
      { term: "created at", detail: text(readString(rec, "createdAt") ?? DASH) },
    ])}
    ${tableSection({
      title: `Ranked candidates (${String(ranked.length)})`,
      description: "Verdict rank (watch > caution > insufficient-evidence > reject), then score desc, then candidateId. A high score never overrides a hard risk gate.",
      columns: [{ header: "#" }, { header: "Candidate" }, { header: "Score" }, { header: "Verdict" }, { header: "Risk" }, { header: "Quote" }, { header: "Reasons" }, { header: "Next safe action" }],
      rows: ranked.slice(0, 50).map((c) => {
        const reasons = readStringArray(c, "reasonCodes");
        const risk = readString(c, "riskDecision");
        const t22 = readBoolean(c, "token2022Blocker");
        const riskCell = `${risk ?? "—"}${t22 === true ? " · token2022-blocker" : ""}`;
        const quote = readBoolean(c, "quoteObserved") === true ? (readString(c, "quoteFreshness") ?? "observed") : "—";
        return [
          text(num(readNumber(c, "rank"))),
          code(readString(c, "candidateId")),
          text(num(readNumber(c, "score"))),
          text(readString(c, "verdict") ?? DASH),
          text(riskCell),
          text(quote),
          text(reasons.items.length > 0 ? reasons.items.join(", ") : DASH),
          text(readString(c, "nextSafeAction") ?? DASH),
        ];
      }),
      empty: "No candidates (the input bundle held none).",
    })}
    ${
      caveats.total > 0
        ? Section({
            title: `Caveats (${String(caveats.total)})`,
            description: "Carried by every engine candidate-score artifact.",
            body: html`<ul class="sm-bullets sm-bullets--plain">
              ${caveats.items.map((c) => html`<li>${c}</li>`)}
            </ul>`,
          })
        : ""
    }
    ${partialNotice(missing)}
  `;
}

function renderMainnetDryRunReleaseCandidateView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const verdict = need(missing, "verdict", readString(rec, "verdict"));
  const liveSendStatus = need(missing, "liveSendStatus", readString(rec, "liveSendStatus"));
  const scoring = asRecord(rec["scoring"]);
  const risk = asRecord(rec["risk"]);
  const quote = asRecord(rec["quote"]);
  const build = asRecord(rec["build"]);
  const txInspection = asRecord(rec["txInspection"]);
  const simulation = asRecord(rec["simulation"]);
  const readiness = asRecord(rec["readiness"]);
  const source = asRecord(rec["candidateSource"]);
  const whyBlocked = readStringArray(rec, "whyLiveBlocked");
  const nextActions = readStringArray(rec, "nextSafeActions");
  const caveats = readStringArray(rec, "caveats");
  const refs = readStringArray(rec, "artifactRefs");
  // The single most important safety fact: this artifact can never report a live send.
  const safe =
    liveSendStatus === "disabled" &&
    rec.phase7LiveTradingReady === false &&
    rec.neverSends === true &&
    rec.neverSigns === true &&
    rec.network === "mainnet-beta" &&
    rec.mode === "mainnet-dry-run";
  const ranked = scoring !== null && Array.isArray(scoring["rankedCandidates"])
    ? (scoring["rankedCandidates"] as unknown[]).filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e))
    : [];
  return html`
    ${RiskNotice({
      tone: safe && verdict === "dryrun-complete-blocked-live" ? "info" : "caution",
      title: safe
        ? `Mainnet dry-run release candidate — verdict ${verdict}; LIVE SENDING DISABLED`
        : "Release candidate is missing its no-send safety literals — do NOT trust this artifact",
      body: html`A no-send rehearsal summary folded from one mainnet dry-run run. Live sending is
        <strong>${liveSendStatus}</strong> by policy; this artifact is structurally incapable of
        reporting a live send, a signature, or an armed state. The verdict is re-derived from the
        stage evidence (risk, quote, build, simulation) — a candidate score can <strong>never</strong>
        move a blocked verdict. <code>dryrun-complete-blocked-live</code> means the dry-run evidence is
        complete and live is <strong>still disabled</strong> — it is never live-trading readiness.`,
    })}
    ${kvSection("Release candidate", undefined, [
      { term: "verdict", detail: code(verdict) },
      { term: "live-send status", detail: text(liveSendStatus) },
      { term: "network / mode", detail: text(`${readString(rec, "network") ?? DASH} / ${readString(rec, "mode") ?? DASH}`) },
      { term: "candidate source", detail: source === null ? text(DASH) : text(`${readString(source, "kind") ?? DASH}: ${readString(source, "label") ?? DASH}`) },
      { term: "run id", detail: text(readString(rec, "runId") ?? DASH) },
      { term: "generated at", detail: text(readString(rec, "generatedAt") ?? DASH) },
      { term: "phase-7 live trading ready", detail: text(boolText(readBoolean(rec, "phase7LiveTradingReady"))) },
    ])}
    ${tableSection({
      title: `Ranked candidates (${String(ranked.length)})`,
      description: "From the Rust candidate scorer — intelligence only, never a buy signal. A high score never unblocks the verdict.",
      columns: [{ header: "#" }, { header: "Candidate" }, { header: "Score" }, { header: "Verdict" }, { header: "Reasons" }],
      rows: ranked.slice(0, 50).map((c) => {
        const reasons = readStringArray(c, "reasonCodes");
        return [
          text(num(readNumber(c, "rank"))),
          code(readString(c, "candidateId")),
          text(num(readNumber(c, "score"))),
          text(readString(c, "verdict") ?? DASH),
          text(reasons.items.length > 0 ? reasons.items.join(", ") : DASH),
        ];
      }),
      empty: scoring !== null && readBoolean(scoring, "available") === false ? "Candidate scoring unavailable (Rust engine not built)." : "No candidates scored.",
    })}
    ${risk === null ? "" : kvSection("Deep risk", "Advisory, read-only. A rejected risk (or critical flag / Token-2022 blocker) forces dryrun-blocked-risk no matter the score.", [
      { term: "assessed / source", detail: text(`${boolText(readBoolean(risk, "assessed"))} / ${readString(risk, "source") ?? DASH}`) },
      { term: "worst decision", detail: text(readString(risk, "worstDecision") ?? DASH) },
      { term: "rejected", detail: text(boolText(readBoolean(risk, "rejected"))) },
      { term: "critical / high flags", detail: text(`${num(readNumber(risk, "criticalFlagCount"))} / ${num(readNumber(risk, "highFlagCount"))}`) },
      { term: "Token-2022 blocker", detail: text(boolText(readBoolean(risk, "token2022Blocker"))) },
    ])}
    ${quote === null ? "" : kvSection("Quote", undefined, [
      { term: "attempted / observed", detail: text(`${boolText(readBoolean(quote, "attempted"))} / ${boolText(readBoolean(quote, "observed"))}`) },
      { term: "freshness", detail: text(readString(quote, "freshness") ?? DASH) },
      { term: "Rust quote score", detail: readBoolean(quote, "scoreAvailable") === true ? text(num(readNumber(quote, "score"))) : text("unavailable") },
    ])}
    ${build === null && txInspection === null && simulation === null ? "" : kvSection("Build · inspection · simulation", undefined, [
      { term: "build attempted / refused / built", detail: build === null ? text(DASH) : text(`${boolText(readBoolean(build, "attempted"))} / ${boolText(readBoolean(build, "refused"))} / ${boolText(readBoolean(build, "succeeded"))}`) },
      { term: "build refusal codes", detail: text(build === null ? DASH : (readStringArray(build, "refusalCodes").items.join(", ") || DASH)) },
      { term: "tx inspection", detail: txInspection === null || readBoolean(txInspection, "available") !== true ? text("unavailable") : text(`v-supported ${boolText(readBoolean(txInspection, "versionSupported"))}, ${num(readNumber(txInspection, "instructionCount"))} instr, ${num(readNumber(txInspection, "unresolvableProgramIdCount"))} unresolvable`) },
      { term: "simulation", detail: simulation === null ? text(DASH) : text(`${readString(simulation, "outcome") ?? DASH}${readString(simulation, "classification") !== null ? ` (${readString(simulation, "classification")})` : ""}`) },
    ])}
    ${readiness === null ? "" : kvSection("Readiness", "The mainnet live gate — verdict is always blocked by design.", [
      { term: "verdict", detail: text(readString(readiness, "verdict") ?? DASH) },
      { term: "conditions satisfied", detail: text(`${num(readNumber(readiness, "satisfiedCount"))} / ${num(readNumber(readiness, "totalChecks"))}`) },
    ])}
    ${whyBlocked.total === 0 ? "" : Section({
      title: "Why live is blocked",
      description: "The standing no-send policy plus this run's verdict-specific reason.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${whyBlocked.items.map((l) => html`<li>${l}</li>`)}</ul>`,
    })}
    ${nextActions.total === 0 ? "" : Section({
      title: "Next safe actions",
      body: html`<ul class="sm-bullets sm-bullets--plain">${nextActions.items.map((l) => html`<li>${l}</li>`)}</ul>`,
    })}
    ${refs.total === 0 ? "" : Section({
      title: `Artifact references (${String(refs.total)})`,
      description: "The per-stage artifacts this summary folds — read them standalone for the full detail.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${refs.items.map((l) => html`<li>${code(l)}</li>`)}</ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderPhase7AuthorizationAuditView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const verdict = need(missing, "verdict", readString(rec, "verdict"));
  const gates = Array.isArray(rec["gates"])
    ? (rec["gates"] as unknown[]).filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null && !Array.isArray(g))
    : [];
  const gatesVerified = gates.filter((g) => readString(g, "status") === "verified").length;
  const prereqs = Array.isArray(rec["microTradePrerequisites"])
    ? (rec["microTradePrerequisites"] as unknown[]).filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null && !Array.isArray(p))
    : [];
  const blockers = readStringArray(rec, "remainingBlockers");
  const caveats = readStringArray(rec, "caveats");
  const commandSurface = asRecord(rec["commandSurface"]);
  // The single most important fact: this artifact authorizes nothing and executes nothing.
  const safe =
    rec.liveExecutionAuthorized === false &&
    rec.authorizesLiveTrading === false &&
    rec.neverSends === true &&
    rec.phase7LiveTradingReady === false &&
    rec.requiresSeparateApproval === true &&
    readString(rec, "auditedMode") === "phase7-live-authorization-review";

  const invariant = (label: string, key: string): { term: string; detail: string } => {
    const inv = asRecord(rec[key]);
    const status = inv === null ? DASH : readString(inv, "status") ?? DASH;
    const detail = inv === null ? "" : readString(inv, "detail") ?? "";
    const mark = status === "verified" ? "✓" : status === "unverified" ? "?" : "✗";
    return { term: label, detail: `${mark} ${status}${detail ? ` — ${detail}` : ""}` };
  };

  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? `Phase 7 authorization audit — verdict ${verdict}. This does NOT execute trades.`
        : "Phase 7 audit is missing its no-authorization safety literals — do NOT trust this artifact",
      body: html`A read-only security review of the repository's no-send invariant, execution gates,
        and boundaries. <strong>This document authorizes no live trading and executes no trade.</strong>
        The verdict is re-derived from the evidence and defaults to <code>not-authorized</code>; the best
        possible verdict, <code>ready-for-separate-microtrade-authorization</code>, still authorizes
        nothing — a controlled micro-trade requires a separate, explicit, written user authorization.`,
    })}
    ${kvSection("Audit", undefined, [
      { term: "verdict", detail: code(verdict) },
      { term: "audit id", detail: text(readString(rec, "auditId") ?? DASH) },
      { term: "repo sha", detail: text(readString(rec, "repoSha") ?? DASH) },
      { term: "audited at / mode", detail: text(`${readString(rec, "auditedAt") ?? DASH} / ${readString(rec, "auditedMode") ?? DASH}`) },
      { term: "gates verified", detail: text(`${String(gatesVerified)} / ${num(readNumber(rec, "gateCount"))} (fourteen-condition live gate)`) },
      { term: "live execution authorized", detail: text(boolText(readBoolean(rec, "liveExecutionAuthorized"))) },
      { term: "requires separate approval", detail: text(boolText(readBoolean(rec, "requiresSeparateApproval"))) },
    ])}
    ${kvSection("Safety invariants", "Each is machine-verified by the audit command; ✓ verified, ? unverified, ✗ failed.", [
      invariant("no-send invariant", "noSendInvariant"),
      invariant("signer boundary", "signerBoundary"),
      invariant("rust boundary", "rustBoundary"),
      invariant("artifact redaction", "artifactRedaction"),
      invariant("release candidate", "releaseCandidate"),
      invariant("reconciliation wall", "reconciliationWall"),
      {
        term: "command surface",
        detail: text(
          commandSurface === null
            ? DASH
            : `${readString(commandSurface, "status") === "safe" ? "✓ safe" : "✗ unsafe"}${readString(commandSurface, "detail") ? ` — ${readString(commandSurface, "detail")}` : ""}`,
        ),
      },
    ])}
    ${tableSection({
      title: `Micro-trade prerequisites (${String(prereqs.length)})`,
      description: "Operational prerequisites for a SEPARATELY-authorized S104 micro-trade. None of these executes a trade.",
      columns: [{ header: "Met" }, { header: "Prerequisite" }, { header: "Detail" }],
      rows: prereqs.map((p) => [
        text(readBoolean(p, "met") === true ? "✓" : "✗"),
        code(readString(p, "id")),
        text(readString(p, "detail") ?? readString(p, "description") ?? DASH),
      ]),
      empty: "No prerequisites recorded.",
    })}
    ${blockers.total === 0 ? "" : Section({
      title: `Remaining blockers (${String(blockers.total)})`,
      description: "Every unverified/failed safety check and open blocker keeping Phase 7 not authorized.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${blockers.items.map((b) => html`<li>${b}</li>`)}</ul>`,
    })}
    ${Section({
      title: "Next safe action",
      body: html`<p>${readString(rec, "nextSafeAction") ?? DASH}</p>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderEngineTxInspectView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const network = need(missing, "network", readString(rec, "network"));
  const builderId = readString(rec, "builderId");
  const feePayer = need(missing, "feePayerPublicKey", readString(rec, "feePayerPublicKey"));
  const unsigned = rec.unsigned === true;
  const caveats = readStringArray(rec, "caveats");
  const shape = (typeof rec.shape === "object" && rec.shape !== null ? rec.shape : {}) as Record<string, unknown>;
  const versionRaw = shape.version;
  const versionText = typeof versionRaw === "string" || typeof versionRaw === "number" ? String(versionRaw) : DASH;
  const versionSupported = shape.versionSupported === true;
  const blockhashPresent = shape.blockhashPresent === true;
  const programIds = readStringArray(shape, "staticProgramIds");
  const trustworthy = unsigned && versionSupported;
  return html`
    ${RiskNotice({
      tone: trustworthy ? "info" : "caution",
      title: trustworthy
        ? "Rust engine tx inspect — shape facts from a strictly-unsigned envelope, read-only"
        : "Engine tx artifact is unsupported or not proven unsigned — do NOT trust this artifact",
      body: html`SHAPE facts the S100 Rust sidecar decoded from an unsigned transaction envelope.
        The transaction wire format is parsed in pure Rust, and the bridge re-derives the facts
        with the real <code>@solana/web3.js</code> decoder, refusing unless every fact matches. A
        signed transaction is refused. Nothing here signs, sends, or proves a transaction would land.`,
    })}
    ${kvSection("Envelope", undefined, [
      { term: "engine", detail: text(`${readString(rec, "engineName") ?? DASH} ${readString(rec, "engineVersion") ?? ""}`) },
      { term: "network", detail: code(network) },
      { term: "builder", detail: code(builderId) },
      { term: "fee payer", detail: code(feePayer) },
      { term: "candidate mint", detail: readString(rec, "candidateMint") !== null ? code(readString(rec, "candidateMint")) : text("none") },
      { term: "unsigned proof", detail: boolText(unsigned) },
    ])}
    ${kvSection("Shape", undefined, [
      { term: "version", detail: text(`${versionText} (${versionSupported ? "supported" : "UNSUPPORTED"})`) },
      { term: "recent blockhash", detail: text(blockhashPresent ? "present" : "MISSING (zero)") },
      { term: "instructions", detail: text(num(readNumber(shape, "instructionCount"))) },
      { term: "account keys", detail: text(num(readNumber(shape, "accountKeyCount"))) },
      { term: "address-lookup tables", detail: text(num(readNumber(shape, "addressTableLookupCount"))) },
      { term: "unresolvable program ids", detail: text(num(readNumber(shape, "unresolvableProgramIdCount"))) },
    ])}
    ${tableSection({
      title: `Static program ids (${String(programIds.total)})`,
      description: "Program ids resolvable from the STATIC account keys; ALT-loaded programs cannot be verified offline.",
      columns: [{ header: "Program id" }],
      rows: programIds.items.map((id) => [code(id)]),
      empty: "No statically-resolvable program ids.",
    })}
    ${
      caveats.total > 0
        ? Section({
            title: `Caveats (${String(caveats.total)})`,
            description: "Carried by every engine tx inspect artifact.",
            body: html`<ul class="sm-bullets sm-bullets--plain">
              ${caveats.items.map((c) => html`<li>${c}</li>`)}
            </ul>`,
          })
        : ""
    }
    ${partialNotice(missing)}
  `;
}

function renderEngineSimClassificationView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const classification = need(missing, "classification", readString(rec, "classification"));
  const message = readString(rec, "classificationMessage");
  const nextAction = readString(rec, "classificationNextAction");
  const caveats = readStringArray(rec, "caveats");
  const safe = rec.notExecutable === true && rec.neverSends === true;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Rust engine sim classification — explains a failure, never an execution signal"
        : "Engine sim artifact is missing its safety literals — do NOT trust this artifact",
      body: html`A simulation failure mapped onto the S95 CLOSED classification set by the S100 Rust
        sidecar. TypeScript re-runs the real classifier on the same input and refuses on any
        disagreement. A classification explains WHY a simulation failed; it is never readiness and
        never an execution signal.`,
    })}
    ${kvSection("Classification", undefined, [
      { term: "engine", detail: text(`${readString(rec, "engineName") ?? DASH} ${readString(rec, "engineVersion") ?? ""}`) },
      { term: "classification", detail: code(classification) },
      { term: "meaning", detail: text(message ?? DASH) },
      { term: "next safe action", detail: text(nextAction ?? DASH) },
      { term: "errLabel present", detail: boolText(readBoolean(rec, "errLabelPresent")) },
      { term: "log lines", detail: text(num(readNumber(rec, "logLineCount"))) },
    ])}
    ${
      caveats.total > 0
        ? Section({
            title: `Caveats (${String(caveats.total)})`,
            description: "Carried by every engine sim classification artifact.",
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
function recordList(rec: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const raw = rec[key];
  return (Array.isArray(raw) ? raw : []).map(asRecord).filter((x): x is Record<string, unknown> => x !== null);
}

function renderDevnetFundingStatusView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const status = need(missing, "fundingSourceStatus", readString(rec, "fundingSourceStatus"));
  const publicKey = need(missing, "publicKey", readString(rec, "publicKey"));
  const funded = readBoolean(rec, "funded");
  const lamports = readNumber(rec, "lamports");
  const sol = readNumber(rec, "solBalance");
  const faucet = asRecord(rec["faucetAttemptSummary"]);
  const caveats = readStringArray(rec, "caveats");
  const safe = rec.neverMainnet === true && rec.phase7LiveTradingReady === false && readString(rec, "network") === "devnet";
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? `Devnet funding status — ${status ?? DASH}. Read-only; never touches mainnet.`
        : "Devnet funding-status is missing its devnet / no-live safety markers — do NOT trust this artifact",
      body: html`A read-only devnet balance observation for a throwaway rehearsal key.
        <strong>This never reads a secret key, never touches mainnet, and authorizes no live trading.</strong>
        <code>funded</code> and <code>canBroadcastDevnetProbe</code> are re-derived from the observed
        lamports — an unobserved or short balance can never read as funded.`,
    })}
    ${kvSection("Funding", undefined, [
      { term: "status", detail: code(status) },
      { term: "public key", detail: code(publicKey) },
      { term: "balance", detail: text(lamports === null ? "unknown (not observed)" : `${num(lamports)} lamports (${num(sol)} SOL)`) },
      { term: "minimum required", detail: text(`${num(readNumber(rec, "minimumRequiredLamports"))} lamports`) },
      { term: "funded", detail: text(boolText(funded)) },
      { term: "can broadcast devnet probe", detail: text(boolText(readBoolean(rec, "canBroadcastDevnetProbe"))) },
    ])}
    ${
      faucet === null
        ? null
        : kvSection("Faucet attempt", undefined, [
            { term: "outcome", detail: code(readString(faucet, "outcome")) },
            { term: "attempts", detail: text(`${num(readNumber(faucet, "attempts"))} / ${num(readNumber(faucet, "maxAttempts"))}`) },
            { term: "detail", detail: text(readString(faucet, "detail")) },
          ])
    }
    ${Section({ title: "Next safe action", body: html`<p>${readString(rec, "nextSafeAction") ?? DASH}</p>` })}
    ${
      caveats.total === 0
        ? null
        : Section({ title: `Caveats (${String(caveats.total)})`, body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>` })
    }
    ${partialNotice(missing)}
  `;
}

function renderPhase7HumanSignoffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const status = need(missing, "signoffStatus", readString(rec, "signoffStatus"));
  const required = recordList(rec, "requiredAcknowledgements");
  const ackedRaw = rec["acknowledgedAcknowledgementIds"];
  const acked = new Set(Array.isArray(ackedRaw) ? ackedRaw.filter((x): x is string => typeof x === "string") : []);
  const maxSpendLamports = readNumber(rec, "maxSpendLamports");
  const safe =
    rec.authorizesLiveExecution === false &&
    rec.neverSends === true &&
    rec.phase7LiveTradingReady === false &&
    rec.requiresSeparateExecutionSprint === true;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? `Phase 7 human sign-off — status ${status ?? DASH}. This authorizes NO live trade by itself.`
        : "Phase 7 sign-off is missing its no-authorization safety literals — do NOT trust this artifact",
      body: html`The clean mechanism for a FUTURE explicit human Phase 7 authorization.
        <strong>Even a fully-signed record authorizes no live trade and creates no mainnet send</strong> —
        it is evidence only; a controlled micro-trade still needs the fourteen-condition live gate and a
        separate, reviewed execution sprint. The status and granted scope are re-derived; a signature cannot be faked.`,
    })}
    ${kvSection("Sign-off", undefined, [
      { term: "status", detail: code(status) },
      { term: "granted scope", detail: code(readString(rec, "grantedScope")) },
      { term: "target scope", detail: code(readString(rec, "targetScope")) },
      { term: "operator", detail: text(readString(rec, "operatorLabel") ?? "(unsigned)") },
      { term: "signed at", detail: text(readString(rec, "signedAtLabel") ?? "(none)") },
      { term: "max spend", detail: text(maxSpendLamports === null ? "n/a" : `${num(maxSpendLamports)} lamports (${num(readNumber(rec, "maxSpendSol"))} SOL)`) },
      { term: "repo sha", detail: code(readString(rec, "repoSha")) },
      { term: "authorizes live execution", detail: text(boolText(readBoolean(rec, "authorizesLiveExecution"))) },
    ])}
    ${tableSection({
      title: `Required acknowledgements (${String(required.length)})`,
      description: "A human must explicitly check EACH for the target scope. None of these executes a trade.",
      columns: [{ header: "Checked" }, { header: "Id" }, { header: "Acknowledgement" }],
      rows: required.map((a) => {
        const id = readString(a, "id");
        return [text(id !== null && acked.has(id) ? "✓" : "✗"), code(id), text(readString(a, "text"))];
      }),
      empty: "No acknowledgements recorded.",
    })}
    ${Section({ title: "Next safe action", body: html`<p>${readString(rec, "nextSafeAction") ?? DASH}</p>` })}
    ${partialNotice(missing)}
  `;
}

function renderSniperOperatorDemoView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const demoId = need(missing, "demoId", readString(rec, "demoId"));
  const artifacts = recordList(rec, "artifacts");
  const stages = recordList(rec, "pipelineStages");
  const allValid = readBoolean(rec, "allArtifactsValid");
  const safe = rec.liveExecutionDisabled === true && rec.neverSends === true && rec.phase7LiveTradingReady === false;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? `Operator demo workbench — ${demoId ?? DASH}. SAFE paper / dry-run showcase; live execution DISABLED.`
        : "Operator demo manifest is missing its live-disabled / no-send markers — do NOT trust this artifact",
      body: html`A SAFE, showable folder of Sol Maker's paper / dry-run pipeline.
        <strong>Nothing here sends, signs, or trades; live execution is disabled.</strong> Every artifact is
        labelled by provenance — real-readonly (observed read-only evidence), fixture (an honest stand-in),
        or fictional-example (invented mints) — never live trade evidence.`,
    })}
    ${kvSection("Demo", undefined, [
      { term: "demo id", detail: text(demoId) },
      { term: "generated at", detail: text(readString(rec, "generatedAt")) },
      {
        term: "artifacts",
        detail: text(
          `${num(readNumber(rec, "artifactCount"))} (${num(readNumber(rec, "realReadonlyCount"))} real-readonly, ${num(readNumber(rec, "fixtureCount"))} fixture, ${num(readNumber(rec, "fictionalExampleCount"))} fictional-example)`,
        ),
      },
      { term: "all artifacts valid", detail: text(boolText(allValid)) },
      { term: "live execution disabled", detail: text(boolText(readBoolean(rec, "liveExecutionDisabled"))) },
    ])}
    ${tableSection({
      title: `Artifacts (${String(artifacts.length)})`,
      description: "Each artifact in the demo folder, with its provenance and integrity.",
      columns: [{ header: "Role" }, { header: "File" }, { header: "Provenance" }, { header: "Schema" }, { header: "Valid" }],
      rows: artifacts.map((a) => {
        const present = readBoolean(a, "present") === true;
        const valid = readBoolean(a, "valid") === true;
        return [
          code(readString(a, "role")),
          text(readString(a, "fileName")),
          code(readString(a, "evidenceClass")),
          code(readString(a, "schemaVersion")),
          text(present ? (valid ? "valid" : "INVALID") : "missing"),
        ];
      }),
      empty: "No artifacts recorded.",
    })}
    ${tableSection({
      title: `Pipeline stages (${String(stages.length)})`,
      description: "The stages this demo showcases — each evidenced by one of the artifacts above.",
      columns: [{ header: "Stage" }, { header: "What it shows" }, { header: "Evidenced by" }],
      rows: stages.map((s) => [code(readString(s, "stage")), text(readString(s, "description")), code(readString(s, "evidencedBy"))]),
      empty: "No stages recorded.",
    })}
    ${Section({ title: "Why live trading is disabled", body: html`<p>${readString(rec, "whyLiveDisabled") ?? DASH}</p>` })}
    ${Section({ title: "Next safe action", body: html`<p>${readString(rec, "nextSafeAction") ?? DASH}</p>` })}
    ${partialNotice(missing)}
  `;
}

function renderPhase7MicrotradePreflightView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const verdict = need(missing, "preflightVerdict", readString(rec, "preflightVerdict"));
  const missingReqs = readStringArray(rec, "missingRequirements");
  const caveats = readStringArray(rec, "caveats");
  const ready = verdict === "ready-for-separate-execution-authorization";
  const safe =
    rec.liveExecutionAuthorized === false &&
    rec.authorizesLiveTrading === false &&
    rec.neverSends === true &&
    rec.neverSigns === true &&
    rec.notExecutable === true &&
    rec.requiresSeparateExecutionApproval === true &&
    rec.phase7LiveTradingReady === false &&
    readString(rec, "network") === "mainnet-beta";
  const maxLamports = readNumber(rec, "maxSpendCapLamports");
  return html`
    ${RiskNotice({
      tone: safe ? (ready ? "info" : "caution") : "caution",
      title: safe
        ? `S104 micro-trade preflight — verdict ${verdict ?? DASH}. This does NOT execute trades.`
        : "Micro-trade preflight is missing its no-execute / no-authorize safety markers — do NOT trust this artifact",
      body: html`A read-only check of whether the structural inputs for a FUTURE, separately-authorized
        controlled micro-trade are present. <strong>This artifact does not execute a trade — it never
        signs, never sends, and loads no key.</strong> The best possible verdict,
        <code>ready-for-separate-execution-authorization</code>, authorizes NOTHING: a separate,
        explicit, written S104 execution authorization, the fourteen-condition live gate, and a
        reviewed sprint are still required. Live trading stays disabled.`,
    })}
    ${kvSection("Preflight", undefined, [
      { term: "verdict", detail: code(verdict) },
      { term: "mode", detail: code(readString(rec, "mode")) },
      { term: "network", detail: code(readString(rec, "network")) },
      { term: "repo sha", detail: code(readString(rec, "repoSha")) },
    ])}
    ${kvSection("Structural inputs", "None of these executes a trade.", [
      { term: "written human sign-off", detail: code(readString(rec, "signoffStatus")) },
      { term: "reconciled devnet proof", detail: code(readString(rec, "devnetProofStatus")) },
      { term: "mainnet dry-run release candidate", detail: code(readString(rec, "releaseCandidateStatus")) },
      { term: "public burner wallet", detail: text(`${readString(rec, "burnerWalletStatus") ?? DASH}${readString(rec, "burnerWalletAddress") ? ` (${readString(rec, "burnerWalletAddress")})` : ""}`) },
      { term: "manual confirmation", detail: code(readString(rec, "manualConfirmationStatus")) },
      { term: "max spend cap", detail: text(maxLamports === null ? "(none)" : `${num(maxLamports)} lamports (${num(readNumber(rec, "maxSpendCapSol"))} SOL)`) },
    ])}
    ${kvSection("Trade-evidence posture (echoed from the release candidate)", undefined, [
      { term: "risk", detail: code(readString(rec, "riskStatus")) },
      { term: "Token-2022 blocker", detail: code(readString(rec, "token2022BlockerStatus")) },
      { term: "quote freshness", detail: code(readString(rec, "quoteFreshnessStatus")) },
      { term: "simulation", detail: code(readString(rec, "simulationStatus")) },
      { term: "kill switch", detail: code(readString(rec, "killSwitchStatus")) },
      { term: "reconciliation", detail: code(readString(rec, "reconciliationRequirement")) },
    ])}
    ${
      missingReqs.total === 0
        ? null
        : Section({
            title: `Missing requirements (${String(missingReqs.total)})`,
            body: html`<ul class="sm-bullets sm-bullets--plain">${missingReqs.items.map((m) => html`<li>${m}</li>`)}</ul>`,
          })
    }
    ${Section({ title: "Next safe action", body: html`<p>${readString(rec, "nextSafeAction") ?? DASH}</p>` })}
    ${
      caveats.total === 0
        ? null
        : Section({ title: `Caveats (${String(caveats.total)})`, body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>` })
    }
    ${partialNotice(missing)}
  `;
}

function renderSniperWatchlistView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const watchlistId = need(missing, "watchlistId", readString(rec, "watchlistId"));
  const counts = asRecord(rec["statusCounts"]);
  const entries = Array.isArray(rec["entries"])
    ? (rec["entries"] as unknown[]).filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e))
    : [];
  const duplicateMints = readStringArray(rec, "duplicateMints");
  const caveats = readStringArray(rec, "caveats");
  // A watchlist status is bookkeeping only — these literals prove it carries no trade/execution meaning.
  const safe =
    rec.statusIsNotTradeReadiness === true &&
    rec.neverSends === true &&
    rec.paperOnly === true &&
    rec.notLiveResult === true;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? `Sniper watchlist — ${num(readNumber(rec, "entryCount"))} entry(ies); a status is bookkeeping only`
        : "Watchlist is missing its paper-only / not-trade-readiness markers — do NOT trust this artifact",
      body: html`A deterministic, offline list of candidate mints to monitor. A status
        (<code>watch</code> / <code>review</code> / <code>blocked</code> / <code>archived</code>) is
        <strong>bookkeeping only</strong> — it is never a trade signal and never means a candidate is
        ready or safe to trade. Every mint is validated as a public key; nothing here signs, sends, or
        trades. Live trading stays disabled.`,
    })}
    ${kvSection("Watchlist", undefined, [
      { term: "id", detail: code(watchlistId) },
      { term: "network", detail: code(readString(rec, "network")) },
      { term: "source", detail: text(readString(rec, "sourceLabel") ?? DASH) },
      { term: "entries", detail: text(`${num(readNumber(rec, "entryCount"))} (${String(readStringArray(rec, "distinctMints").total)} distinct mint(s))`) },
      {
        term: "status tally",
        detail: counts === null
          ? text(DASH)
          : text(`watch ${num(readNumber(counts, "watch"))} · review ${num(readNumber(counts, "review"))} · blocked ${num(readNumber(counts, "blocked"))} · archived ${num(readNumber(counts, "archived"))}`),
      },
    ])}
    ${tableSection({
      title: `Entries (${String(entries.length)})`,
      description: "Operator-supplied; a status is monitoring bookkeeping, never trade readiness.",
      columns: [{ header: "Status" }, { header: "Entry" }, { header: "Mint" }, { header: "Label" }, { header: "Via" }, { header: "Tags" }],
      rows: entries.slice(0, 100).map((e) => {
        const tags = readStringArray(e, "tags");
        return [
          code(readString(e, "status")),
          code(readString(e, "entryId")),
          text(readString(e, "mint") ?? DASH),
          text(readString(e, "label") ?? DASH),
          text(readString(e, "provider") ?? DASH),
          text(tags.items.length > 0 ? tags.items.join(", ") : DASH),
        ];
      }),
      empty: "No entries.",
    })}
    ${duplicateMints.total === 0 ? "" : Section({
      title: `Duplicate mints (${String(duplicateMints.total)})`,
      description: "Allowed, but surfaced — the same mint appears on more than one entry.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${duplicateMints.items.map((m) => html`<li>${code(m)}</li>`)}</ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperDryRunCampaignView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const campaignId = need(missing, "campaignId", readString(rec, "campaignId"));
  const liveSendStatus = need(missing, "liveSendStatus", readString(rec, "liveSendStatus"));
  const counts = asRecord(rec["verdictCounts"]);
  const candidates = Array.isArray(rec["candidates"])
    ? (rec["candidates"] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
  const stages = Array.isArray(rec["stages"])
    ? (rec["stages"] as unknown[]).filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && !Array.isArray(s))
    : [];
  const caveats = readStringArray(rec, "caveats");
  const refs = readStringArray(rec, "artifactRefs");
  // The campaign can never report a live send; a score can never override a blocker.
  const safe =
    liveSendStatus === "disabled" &&
    rec.neverSends === true &&
    rec.notExecutable === true &&
    rec.phase7LiveTradingReady === false &&
    rec.scoreCannotOverrideBlock === true;
  const blockedCount = counts === null ? null : readNumber(counts, "blocked");
  const blockedCandidates = candidates.filter((c) => readString(c, "finalOperatorVerdict") === "blocked");
  return html`
    ${RiskNotice({
      tone: safe && (blockedCount ?? 0) === 0 ? "info" : "caution",
      title: safe
        ? `Sniper dry-run campaign — ${num(readNumber(rec, "candidateCount"))} candidate(s); LIVE SENDING DISABLED`
        : "Campaign is missing its no-send / no-override safety literals — do NOT trust this artifact",
      body: html`A no-send comparison of candidates across the paper / dry-run evidence already
        gathered. Live sending is <strong>${liveSendStatus}</strong> by policy; this artifact is
        structurally incapable of reporting a live send, a signature, or an armed state. Each
        candidate's verdict is re-derived from risk / build / simulation / preflight evidence — a
        candidate score is <strong>never</strong> read by the derivation, so a high score can never
        override a blocker. <code>watch</code> is the best a candidate reaches: it means keep
        monitoring, never ready or safe to trade.`,
    })}
    ${kvSection("Campaign", undefined, [
      { term: "id", detail: code(campaignId) },
      { term: "mode / network", detail: text(`${readString(rec, "mode") ?? DASH} / ${readString(rec, "network") ?? DASH}`) },
      { term: "live-send status", detail: text(liveSendStatus ?? DASH) },
      {
        term: "verdict tally",
        detail: counts === null
          ? text(DASH)
          : text(`watch ${num(readNumber(counts, "watch"))} · review ${num(readNumber(counts, "review"))} · BLOCKED ${num(readNumber(counts, "blocked"))} · insufficient ${num(readNumber(counts, "insufficientEvidence"))}`),
      },
    ])}
    ${tableSection({
      title: `Candidates (${String(candidates.length)})`,
      description: "Ranked / risked / quoted / dry-run comparison. A blocked candidate stays blocked no matter the score.",
      columns: [
        { header: "Verdict" }, { header: "Candidate" }, { header: "Mint" }, { header: "Score" }, { header: "Risk" },
        { header: "Quote" }, { header: "Build" }, { header: "Sim" }, { header: "Preflight" }, { header: "RC" },
      ],
      rows: candidates.slice(0, 100).map((c) => [
        code(readString(c, "finalOperatorVerdict")),
        code(readString(c, "candidateId")),
        text(readString(c, "mint") ?? DASH),
        text(num(readNumber(c, "score"))),
        text(readString(c, "riskDecision") ?? DASH),
        text(readString(c, "quoteStatus") ?? DASH),
        text(readString(c, "buildStatus") ?? DASH),
        text(readString(c, "simulationStatus") ?? DASH),
        text(readString(c, "preflightVerdict") ?? DASH),
        text(readString(c, "releaseCandidateVerdict") ?? DASH),
      ]),
      empty: "No candidates.",
    })}
    ${blockedCandidates.length === 0 ? "" : Section({
      title: `Blocked candidates (${String(blockedCandidates.length)})`,
      description: "The blockers below are derived from the evidence — never overridable by a score.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${blockedCandidates.map((c) => {
        const blockers = readStringArray(c, "blockers");
        return html`<li>${code(readString(c, "candidateId"))}: ${blockers.items.length > 0 ? blockers.items.join("; ") : DASH}</li>`;
      })}</ul>`,
    })}
    ${stages.length === 0 ? "" : tableSection({
      title: "Stage coverage",
      description: "How many candidates carry evidence for each pipeline stage.",
      columns: [{ header: "Stage" }, { header: "Covered" }],
      rows: stages.map((s) => [
        code(readString(s, "stage")),
        text(`${num(readNumber(s, "candidatesCovered"))} / ${num(readNumber(s, "candidateCount"))}`),
      ]),
      empty: "No stages.",
    })}
    ${Section({ title: "Next safe action", body: html`<p>${readString(rec, "nextSafeAction") ?? DASH}</p>` })}
    ${refs.total === 0 ? "" : Section({
      title: `Evidence references (${String(refs.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${refs.items.map((l) => html`<li>${code(l)}</li>`)}</ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperReadonlyCampaignPlanView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const planId = need(missing, "planId", readString(rec, "planId"));
  const liveSendStatus = need(missing, "liveSendStatus", readString(rec, "liveSendStatus"));
  const allowed = readStringArray(rec, "allowedStages");
  const disabled = readStringArray(rec, "disabledStages");
  const caveats = readStringArray(rec, "caveats");
  // A plan can never send / sign / authorize a live path — these literals prove it.
  const safe =
    liveSendStatus === "disabled" &&
    rec.noSend === true &&
    rec.noSigner === true &&
    rec.noLiveTrading === true &&
    rec.phase7LiveTradingReady === false;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Read-only auto-campaign plan — LIVE TRADING DISABLED · THIS DOES NOT SEND TRANSACTIONS"
        : "Plan is missing its no-send / no-signer safety literals — do NOT trust this artifact",
      body: html`The constitution a no-send live-read-only auto-campaign binds itself to BEFORE it runs.
        Every allowed stage is read-only intelligence / inspection — there is no send, sign, arm, or
        broadcast stage. <code>noSend</code> / <code>noSigner</code> / <code>noLiveTrading</code> are
        pinned, <code>liveSendStatus</code> is <strong>${liveSendStatus}</strong>, and a plan can never
        imply readiness to trade.`,
    })}
    ${kvSection("Plan", undefined, [
      { term: "id", detail: code(planId) },
      { term: "campaign", detail: code(readString(rec, "campaignId")) },
      { term: "mode / network", detail: text(`${readString(rec, "mode") ?? DASH} / ${readString(rec, "network") ?? DASH}`) },
      { term: "provider policy", detail: code(readString(rec, "providerPolicy")) },
      { term: "candidate limit", detail: text(num(readNumber(rec, "candidateLimit"))) },
      { term: "max quote age", detail: text(rec.maxQuoteAgeMs === null || rec.maxQuoteAgeMs === undefined ? DASH : `${num(readNumber(rec, "maxQuoteAgeMs"))} ms`) },
      { term: "live-send status", detail: text(liveSendStatus ?? DASH) },
    ])}
    ${Section({
      title: `Allowed stages (${String(allowed.total)})`,
      description: "Read-only stages this campaign may run. No send / sign / arm stage can appear here.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${allowed.items.length > 0 ? allowed.items.map((s) => html`<li>${code(s)}</li>`) : html`<li>${text("(none)")}</li>`}</ul>`,
    })}
    ${Section({
      title: `Disabled stages (${String(disabled.total)})`,
      description: "The re-derived complement — off for this run.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${disabled.items.length > 0 ? disabled.items.map((s) => html`<li>${code(s)}</li>`) : html`<li>${text("(none)")}</li>`}</ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperCampaignDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const diffId = need(missing, "diffId", readString(rec, "diffId"));
  const liveSendStatus = need(missing, "liveSendStatus", readString(rec, "liveSendStatus"));
  const summary = asRecord(rec["summary"]);
  const changes = Array.isArray(rec["candidateChanges"])
    ? (rec["candidateChanges"] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
  const caveats = readStringArray(rec, "caveats");
  const safe = liveSendStatus === "disabled" && rec.authorizesLiveTrading === false && rec.neverSends === true;
  const moved = changes.filter((c) => readString(c, "status") !== "unchanged");
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Sniper campaign diff — LIVE TRADING DISABLED · reports movement only, authorizes nothing"
        : "Diff is missing its no-send / authorizes-nothing literals — do NOT trust this artifact",
      body: html`A no-send comparison of two campaigns, keyed by mint. It NEVER re-derives or overrides a
        campaign verdict; improved / worsened are counted only when both verdicts are present (no fake
        movement on a one-sided add / remove). <code>liveSendStatus</code> is
        <strong>${liveSendStatus}</strong> and it authorizes nothing.`,
    })}
    ${kvSection("Diff", undefined, [
      { term: "id", detail: code(diffId) },
      { term: "before", detail: text(readString(rec, "beforeCampaignRef") ?? DASH) },
      { term: "after", detail: text(readString(rec, "afterCampaignRef") ?? DASH) },
      {
        term: "summary",
        detail: summary === null
          ? text(DASH)
          : text(`+${num(readNumber(summary, "addedCount"))} added · -${num(readNumber(summary, "removedCount"))} removed · ${num(readNumber(summary, "changedCount"))} changed · ${num(readNumber(summary, "unchangedCount"))} unchanged`),
      },
      {
        term: "movement",
        detail: summary === null
          ? text(DASH)
          : text(`${num(readNumber(summary, "improvedCount"))} improved · ${num(readNumber(summary, "worsenedCount"))} worsened · ${num(readNumber(summary, "newlyBlockedCount"))} newly-blocked · ${num(readNumber(summary, "newlyWatchCount"))} newly-watch`),
      },
    ])}
    ${tableSection({
      title: `Changes (${String(moved.length)})`,
      description: "Candidate movement between the two campaigns.",
      columns: [{ header: "Status" }, { header: "Mint" }, { header: "Verdict" }, { header: "Score Δ" }, { header: "Risk" }, { header: "Quote" }, { header: "Build" }, { header: "Sim" }],
      rows: moved.slice(0, 100).map((c) => [
        code(readString(c, "status")),
        text(readString(c, "mint") ?? DASH),
        text(`${readString(c, "verdictBefore") ?? DASH} → ${readString(c, "verdictAfter") ?? DASH}`),
        text(c["scoreDelta"] === null || c["scoreDelta"] === undefined ? DASH : num(readNumber(c, "scoreDelta"))),
        text(readString(c, "riskChange") ?? DASH),
        text(readString(c, "quoteChange") ?? DASH),
        text(readString(c, "buildChange") ?? DASH),
        text(readString(c, "simulationChange") ?? DASH),
      ]),
      empty: "No changes.",
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperAlphaRunReportView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const runId = need(missing, "runId", readString(rec, "runId"));
  const liveTradingStatus = need(missing, "liveTradingStatus", readString(rec, "liveTradingStatus"));
  const health = asRecord(rec["providerHealthSummary"]);
  const top = Array.isArray(rec["topCandidates"])
    ? (rec["topCandidates"] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
  const blocked = Array.isArray(rec["blockedCandidates"])
    ? (rec["blockedCandidates"] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
  const insufficient = Array.isArray(rec["insufficientEvidenceCandidates"])
    ? (rec["insufficientEvidenceCandidates"] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
  const stages = Array.isArray(rec["stageCoverage"])
    ? (rec["stageCoverage"] as unknown[]).filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && !Array.isArray(s))
    : [];
  const nextActions = readStringArray(rec, "nextSafeActions");
  const caveats = readStringArray(rec, "caveats");
  const safe = liveTradingStatus === "disabled" && rec.authorizesLiveTrading === false && rec.neverSends === true && rec.phase7LiveTradingReady === false;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Sniper alpha run report — LIVE TRADING DISABLED · THIS DOES NOT SEND TRANSACTIONS"
        : "Alpha report is missing its no-send / not-authorized safety literals — do NOT trust this artifact",
      body: html`A no-send summary of a live-read-only campaign, projected from a validated campaign.
        Candidate verdicts come from the campaign's own re-derivation. <strong>Real read-only</strong>
        evidence is labelled separately from fixture / fictional-example
        (<code>${readString(rec, "evidenceProvenance") ?? DASH}</code>). It is never a profitability
        claim and never a live-readiness claim; <code>liveTradingStatus</code> is
        <strong>${liveTradingStatus}</strong>.`,
    })}
    ${kvSection("Alpha run", undefined, [
      { term: "run id", detail: code(runId) },
      { term: "mode / network", detail: text(`${readString(rec, "mode") ?? DASH} / ${readString(rec, "network") ?? DASH}`) },
      { term: "provenance", detail: code(readString(rec, "evidenceProvenance")) },
      { term: "live-trading status", detail: text(liveTradingStatus ?? DASH) },
      { term: "phase 7", detail: text(readString(rec, "phase7Status") ?? DASH) },
      { term: "candidates", detail: text(`${num(readNumber(rec, "candidateCount"))} (top ${String(top.length)} · blocked ${String(blocked.length)} · insufficient ${String(insufficient.length)})`) },
      {
        term: "providers",
        detail: health === null
          ? text(DASH)
          : text(`risk=${readString(health, "risk") ?? DASH} quote=${readString(health, "quote") ?? DASH} sim=${readString(health, "simulation") ?? DASH} · rust=${readString(rec, "rustEngineStatus") ?? DASH}`),
      },
    ])}
    ${tableSection({
      title: `Top candidates (${String(top.length)})`,
      description: "Best-ranked watch / review candidates on the current evidence — never a buy list.",
      columns: [{ header: "Verdict" }, { header: "Candidate" }, { header: "Mint" }, { header: "Score" }, { header: "Risk" }, { header: "Quote" }, { header: "Build" }, { header: "Sim" }],
      rows: top.slice(0, 100).map((c) => [
        code(readString(c, "verdict")),
        code(readString(c, "candidateId")),
        text(readString(c, "mint") ?? DASH),
        text(num(readNumber(c, "score"))),
        text(readString(c, "riskDecision") ?? DASH),
        text(readString(c, "quoteStatus") ?? DASH),
        text(readString(c, "buildStatus") ?? DASH),
        text(readString(c, "simulationStatus") ?? DASH),
      ]),
      empty: "No top candidates.",
    })}
    ${blocked.length === 0 ? "" : Section({
      title: `Blocked candidates (${String(blocked.length)})`,
      description: "Hard-blocked by the evidence — never overridable by a score.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${blocked.map((c) => {
        const blockers = readStringArray(c, "blockers");
        return html`<li>${code(readString(c, "candidateId"))} ${text(readString(c, "mint") ?? DASH)}: ${blockers.items.length > 0 ? blockers.items.join("; ") : DASH}</li>`;
      })}</ul>`,
    })}
    ${insufficient.length === 0 ? "" : Section({
      title: `Insufficient evidence (${String(insufficient.length)})`,
      description: "Evidence is missing — gather risk / quote / dry-run evidence and re-run.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${insufficient.map((c) => html`<li>${code(readString(c, "candidateId"))} ${text(readString(c, "mint") ?? DASH)}</li>`)}</ul>`,
    })}
    ${stages.length === 0 ? "" : tableSection({
      title: "Stage coverage",
      description: "How many candidates carry evidence for each pipeline stage.",
      columns: [{ header: "Stage" }, { header: "Covered" }],
      rows: stages.map((s) => [code(readString(s, "stage")), text(`${num(readNumber(s, "candidatesCovered"))} / ${num(readNumber(s, "candidateCount"))}`)]),
      empty: "No stages.",
    })}
    ${nextActions.total === 0 ? "" : Section({
      title: "Next safe actions",
      body: html`<ul class="sm-bullets sm-bullets--plain">${nextActions.items.map((a) => html`<li>${a}</li>`)}</ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperProviderHealthView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const reportId = need(missing, "reportId", readString(rec, "reportId"));
  const liveSendStatus = need(missing, "liveSendStatus", readString(rec, "liveSendStatus"));
  const summary = asRecord(rec["summary"]);
  const checks = Array.isArray(rec["checks"])
    ? (rec["checks"] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
  const caveats = readStringArray(rec, "caveats");
  // A provider health report can never send / sign / authorize a live path — these literals prove it.
  const safe =
    liveSendStatus === "disabled" &&
    rec.noSend === true &&
    rec.noSigner === true &&
    rec.authorizesLiveTrading === false;
  const canRunLive = rec.canRunLiveReadonlyCampaign === true;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Provider health report — LIVE TRADING DISABLED · reachability only, never a risk verdict"
        : "Provider health report is missing its no-send / no-signer safety literals — do NOT trust this artifact",
      body: html`Whether a no-send read-only alpha campaign can REACH its providers (RPC, the Jupiter quote API,
        the Rust engine). A provider status is reachability ONLY — <code>available</code> / <code>unavailable</code>
        / <code>timeout</code> / <code>rate-limited</code> / <code>misconfigured</code> / <code>error</code> /
        <code>skipped</code> — and is never a candidate risk verdict. No endpoint secret is carried (every endpoint
        is reduced to its host). <code>canRunLiveReadonlyCampaign</code> means only the read-only network is
        reachable; <code>liveSendStatus</code> is <strong>${liveSendStatus}</strong> and it authorizes nothing.`,
    })}
    ${kvSection("Provider health", undefined, [
      { term: "report id", detail: code(reportId) },
      { term: "mode / network", detail: text(`${readString(rec, "mode") ?? DASH} / ${readString(rec, "network") ?? DASH}`) },
      { term: "profile", detail: code(readString(rec, "providerProfile")) },
      { term: "can run", detail: text(`live-readonly=${String(canRunLive)} · fixture=${String(rec.canRunFixtureCampaign === true)}`) },
      { term: "live-send status", detail: text(liveSendStatus ?? DASH) },
      {
        term: "summary",
        detail: summary === null
          ? text(DASH)
          : text(
              `${num(readNumber(summary, "availableCount"))} available · ${num(readNumber(summary, "unavailableCount"))} unavailable · ${num(readNumber(summary, "timeoutCount"))} timeout · ${num(readNumber(summary, "rateLimitedCount"))} rate-limited · ${num(readNumber(summary, "misconfiguredCount"))} misconfigured · ${num(readNumber(summary, "errorCount"))} error · ${num(readNumber(summary, "skippedCount"))} skipped`,
            ),
      },
    ])}
    ${tableSection({
      title: `Checks (${String(checks.length)})`,
      description: "Per-provider reachability. Endpoints are host-only; a provider being down is honest evidence, never a risk verdict.",
      columns: [{ header: "Status" }, { header: "Provider" }, { header: "Endpoint" }, { header: "Latency" }, { header: "Message" }],
      rows: checks.slice(0, 100).map((c) => [
        code(readString(c, "status")),
        code(readString(c, "provider")),
        text(readString(c, "redactedEndpoint") ?? DASH),
        text(c["latencyMs"] === null || c["latencyMs"] === undefined ? DASH : `${num(readNumber(c, "latencyMs"))} ms`),
        text(readString(c, "message") ?? DASH),
      ]),
      empty: "No checks.",
    })}
    ${checks.length === 0 ? "" : Section({
      title: "Next safe actions",
      body: html`<ul class="sm-bullets sm-bullets--plain">${checks.map((c) => {
        const action = readString(c, "nextSafeAction");
        return action === null ? "" : html`<li>${code(readString(c, "provider"))}: ${action}</li>`;
      })}</ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperAlphaHistoryView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const historyId = need(missing, "historyId", readString(rec, "historyId"));
  const liveTradingStatus = need(missing, "liveTradingStatus", readString(rec, "liveTradingStatus"));
  const agg = asRecord(rec["aggregateVerdictCounts"]);
  const prov = asRecord(rec["evidenceProvenanceRollup"]);
  const providerRollup = asRecord(rec["providerHealthRollup"]);
  const scan = asRecord(rec["sensitiveFieldScan"]);
  const runs = Array.isArray(rec["runs"])
    ? (rec["runs"] as unknown[]).filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r))
    : [];
  const invalid = Array.isArray(rec["invalidArtifacts"])
    ? (rec["invalidArtifacts"] as unknown[]).filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null && !Array.isArray(a))
    : [];
  const topBlockers = Array.isArray(rec["topBlockerReasons"])
    ? (rec["topBlockerReasons"] as unknown[]).filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null && !Array.isArray(b))
    : [];
  const phase7 = readStringArray(rec, "phase7Postures");
  const nextActions = readStringArray(rec, "nextSafeActions");
  const caveats = readStringArray(rec, "caveats");
  // A history can never report a live send / authorize a live path — these literals prove it.
  const safe =
    liveTradingStatus === "disabled" &&
    rec.authorizesLiveTrading === false &&
    rec.anyRunAuthorizesLiveTrading === false &&
    rec.neverSends === true &&
    rec.phase7LiveTradingReady === false;
  const scanClean =
    scan !== null &&
    scan.signaturePresent === false &&
    scan.txidPresent === false &&
    scan.sendResultPresent === false &&
    scan.keyLikePresent === false;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Sniper alpha history — LIVE TRADING DISABLED · THIS DOES NOT SEND TRANSACTIONS"
        : "Alpha history is missing its no-send / not-authorized safety literals — do NOT trust this artifact",
      body: html`A no-send rollup across many live-read-only alpha runs. Per-run verdict counts come from each
        run's own re-derivation (a high score can never override a blocker); this rollup only aggregates and
        ranks them. A recognized-but-invalid or unrecognized artifact is listed honestly and never counted as
        a run, and a run claiming live authorization is refused. <code>authorizesLiveTrading</code> and
        <code>anyRunAuthorizesLiveTrading</code> are <strong>false</strong>;
        <code>liveTradingStatus</code> is <strong>${liveTradingStatus}</strong>. It is never a profitability
        claim and never a live-readiness claim.`,
    })}
    ${kvSection("Alpha history", undefined, [
      { term: "history id", detail: code(historyId) },
      { term: "runs", detail: text(`${num(readNumber(rec, "runCount"))} valid · ${num(readNumber(rec, "invalidArtifactCount"))} invalid / unrecognized`) },
      { term: "candidates", detail: text(num(readNumber(rec, "totalCandidateCount"))) },
      {
        term: "verdicts",
        detail: agg === null
          ? text(DASH)
          : text(`watch ${num(readNumber(agg, "watch"))} · review ${num(readNumber(agg, "review"))} · blocked ${num(readNumber(agg, "blocked"))} · insufficient ${num(readNumber(agg, "insufficientEvidence"))}`),
      },
      {
        term: "provenance",
        detail: prov === null
          ? text(DASH)
          : text(`real-readonly ${num(readNumber(prov, "realReadonly"))} · fixture ${num(readNumber(prov, "fixture"))} · fictional ${num(readNumber(prov, "fictionalExample"))} · mixed ${num(readNumber(prov, "mixed"))}`),
      },
      {
        term: "provider health",
        detail: providerRollup === null
          ? text(DASH)
          : (() => {
              const r = asRecord(providerRollup["risk"]);
              const q = asRecord(providerRollup["quote"]);
              const s = asRecord(providerRollup["simulation"]);
              return text(
                `risk ok=${num(readNumber(r ?? {}, "ok"))}/unavailable=${num(readNumber(r ?? {}, "unavailable"))} · quote ok=${num(readNumber(q ?? {}, "ok"))}/unavailable=${num(readNumber(q ?? {}, "unavailable"))} · sim ok=${num(readNumber(s ?? {}, "ok"))}/unavailable=${num(readNumber(s ?? {}, "unavailable"))}`,
              );
            })(),
      },
      { term: "phase 7 postures", detail: phase7.items.length === 0 ? text(DASH) : text(phase7.items.join(", ")) },
      { term: "sensitive-field scan", detail: text(scanClean ? "clean (no signature / txid / send-result / key-shaped field)" : "INCOMPLETE — review") },
      { term: "live-trading status", detail: text(liveTradingStatus ?? DASH) },
    ])}
    ${tableSection({
      title: `Runs (${String(runs.length)})`,
      description: "Per-run summary. Verdicts come from each run's own campaign re-derivation — never a buy list.",
      columns: [{ header: "Run" }, { header: "Mode / network" }, { header: "Provenance" }, { header: "Watch" }, { header: "Review" }, { header: "Blocked" }, { header: "Insufficient" }, { header: "Top mint" }],
      rows: runs.slice(0, 200).map((r) => {
        const vc = asRecord(r["verdictCounts"]);
        return [
          code(readString(r, "runRef")),
          text(`${readString(r, "mode") ?? DASH} / ${readString(r, "network") ?? DASH}`),
          code(readString(r, "evidenceProvenance")),
          text(num(readNumber(vc ?? {}, "watch"))),
          text(num(readNumber(vc ?? {}, "review"))),
          text(num(readNumber(vc ?? {}, "blocked"))),
          text(num(readNumber(vc ?? {}, "insufficientEvidence"))),
          text(readString(r, "topMint") ?? DASH),
        ];
      }),
      empty: "No valid runs.",
    })}
    ${invalid.length === 0 ? "" : Section({
      title: `Invalid / unrecognized artifacts (${String(invalid.length)})`,
      description: "Listed honestly and NEVER counted as runs — re-generate them.",
      body: html`<ul class="sm-bullets sm-bullets--plain">${invalid.map((a) => html`<li>${code(readString(a, "ref"))}: ${text(readString(a, "reason") ?? DASH)}</li>`)}</ul>`,
    })}
    ${topBlockers.length === 0 ? "" : tableSection({
      title: "Most common blocker reasons",
      description: "How many runs carried each blocker reason (a blocker is never overridable by a score).",
      columns: [{ header: "Reason" }, { header: "Runs" }],
      rows: topBlockers.map((b) => [text(readString(b, "reason") ?? DASH), text(num(readNumber(b, "runCount")))]),
      empty: "No blocker reasons.",
    })}
    ${nextActions.total === 0 ? "" : Section({
      title: "Next safe actions",
      body: html`<ul class="sm-bullets sm-bullets--plain">${nextActions.items.map((a) => html`<li>${a}</li>`)}</ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

/** Format a base/next/delta movement triple as "base -> next (+delta)". */
function triple(rec: Record<string, unknown>, key: string): string {
  const t = asRecord(rec[key]);
  if (t === null) return DASH;
  const base = readNumber(t, "base");
  const next = readNumber(t, "next");
  const delta = readNumber(t, "delta");
  const d = typeof delta === "number" ? (delta > 0 ? `+${delta}` : `${delta}`) : DASH;
  return `${num(base)} -> ${num(next)} (${d})`;
}

function renderSniperAlphaHistoryDiffView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const liveTradingStatus = need(missing, "liveTradingStatus", readString(rec, "liveTradingStatus"));
  const summaryLine = readString(rec, "summaryLine");
  const identity = asRecord(rec["runIdentity"]) ?? {};
  const verdictMovement = asRecord(rec["aggregateVerdictMovement"]) ?? {};
  const scan = asRecord(rec["sensitiveFieldScan"]);
  const runChanges = Array.isArray(rec["runChanges"])
    ? (rec["runChanges"] as unknown[]).filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r))
    : [];
  const blockerMovement = Array.isArray(rec["blockerReasonMovement"])
    ? (rec["blockerReasonMovement"] as unknown[]).filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null && !Array.isArray(b))
    : [];
  const phase7 = asRecord(rec["phase7PostureMovement"]) ?? {};
  const caveats = readStringArray(rec, "caveats");
  // A diff can never report a live send / authorize a live path — these literals prove it.
  const safe =
    liveTradingStatus === "disabled" &&
    rec.authorizesLiveTrading === false &&
    rec.anyInputAuthorizesLiveTrading === false &&
    rec.neverSends === true &&
    rec.phase7LiveTradingReady === false;
  const scanClean =
    scan !== null &&
    scan.signaturePresent === false &&
    scan.txidPresent === false &&
    scan.sendResultPresent === false &&
    scan.keyLikePresent === false;
  const phaseAdded = Array.isArray(phase7["added"]) ? (phase7["added"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const phaseRemoved = Array.isArray(phase7["removed"]) ? (phase7["removed"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Sniper alpha history diff — LIVE TRADING DISABLED · THIS DOES NOT SEND TRANSACTIONS"
        : "Alpha history diff is missing its no-send / not-authorized safety literals — do NOT trust this artifact",
      body: html`A no-send comparison of two alpha-history rollups. It reports MOVEMENT only and never
        re-derives a verdict — runs are paired by <code>runRef</code> (an alpha history carries run-level
        counts, not per-candidate identity). <strong>Movement is not momentum:</strong> a falling blocked
        count is bookkeeping, never a buy signal. <code>authorizesLiveTrading</code> and
        <code>anyInputAuthorizesLiveTrading</code> are <strong>false</strong>;
        <code>liveTradingStatus</code> is <strong>${liveTradingStatus}</strong>.`,
    })}
    ${kvSection("Alpha history diff", undefined, [
      { term: "base", detail: text(`${readString(rec, "baseHistoryId") ?? DASH} (${num(readNumber(identity, "baseRunCount"))} runs, ${num(readNumber(identity, "baseTotalCandidateCount"))} candidates)`) },
      { term: "next", detail: text(`${readString(rec, "nextHistoryId") ?? DASH} (${num(readNumber(identity, "nextRunCount"))} runs, ${num(readNumber(identity, "nextTotalCandidateCount"))} candidates)`) },
      { term: "summary", detail: text(summaryLine ?? DASH) },
      { term: "watch movement", detail: text(triple(verdictMovement, "watch")) },
      { term: "review movement", detail: text(triple(verdictMovement, "review")) },
      { term: "blocked movement", detail: text(triple(verdictMovement, "blocked")) },
      { term: "insufficient movement", detail: text(triple(verdictMovement, "insufficientEvidence")) },
      { term: "invalid artifacts", detail: text(`${num(readNumber(identity, "baseInvalidArtifactCount"))} -> ${num(readNumber(identity, "nextInvalidArtifactCount"))}`) },
      { term: "sensitive-field scan", detail: text(scanClean ? "clean (no signature / txid / send-result / key-shaped field)" : "INCOMPLETE — review") },
      { term: "live-trading status", detail: text(liveTradingStatus ?? DASH) },
    ])}
    ${tableSection({
      title: `Run changes (${String(runChanges.length)})`,
      description: "Runs paired by runRef. A one-sided run is added / removed, never an improvement or a regression.",
      columns: [{ header: "Run" }, { header: "Status" }, { header: "Candidate Δ" }, { header: "Verdict deltas" }, { header: "Movement" }],
      rows: runChanges.slice(0, 200).map((c) => {
        const vd = asRecord(c["verdictCountDeltas"]);
        const candidateDelta = c["candidateCountDelta"];
        const vdText = vd === null
          ? DASH
          : ["watch", "review", "blocked", "insufficientEvidence"]
              .map((k) => ({ k, v: readNumber(vd, k) }))
              .filter((e) => typeof e.v === "number" && e.v !== 0)
              .map((e) => `${e.k} ${(e.v as number) > 0 ? "+" : ""}${e.v}`)
              .join(", ");
        return [
          code(readString(c, "runRef")),
          text(readString(c, "status") ?? DASH),
          text(typeof candidateDelta === "number" ? (candidateDelta > 0 ? `+${candidateDelta}` : `${candidateDelta}`) : DASH),
          text(vdText.length === 0 ? DASH : vdText),
          text(readString(c, "movementNote") ?? DASH),
        ];
      }),
      empty: "No run changes.",
    })}
    ${blockerMovement.length === 0 ? "" : tableSection({
      title: "Blocker reason movement (by run frequency)",
      description: "How many runs carried each blocker reason in the base vs the next history (movement only).",
      columns: [{ header: "Reason" }, { header: "Base runs" }, { header: "Next runs" }, { header: "Δ" }],
      rows: blockerMovement.slice(0, 100).map((m) => {
        const delta = readNumber(m, "delta");
        return [
          text(readString(m, "reason") ?? DASH),
          text(num(readNumber(m, "baseRunCount"))),
          text(num(readNumber(m, "nextRunCount"))),
          text(typeof delta === "number" ? (delta > 0 ? `+${delta}` : `${delta}`) : DASH),
        ];
      }),
      empty: "No blocker reason movement.",
    })}
    ${phaseAdded.length === 0 && phaseRemoved.length === 0 ? "" : Section({
      title: "Phase 7 posture movement",
      body: html`<ul class="sm-bullets sm-bullets--plain">
        ${phaseAdded.length === 0 ? "" : html`<li>appeared: ${text(phaseAdded.join(", "))}</li>`}
        ${phaseRemoved.length === 0 ? "" : html`<li>gone: ${text(phaseRemoved.join(", "))}</li>`}
      </ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperAlphaHistoryTrendView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const liveTradingStatus = need(missing, "liveTradingStatus", readString(rec, "liveTradingStatus"));
  const summaryLine = readString(rec, "summaryLine");
  const scan = asRecord(rec["sensitiveFieldScan"]);
  const consistency = asRecord(rec["providerHealthConsistency"]) ?? {};
  const snapshots = Array.isArray(rec["snapshots"])
    ? (rec["snapshots"] as unknown[]).filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && !Array.isArray(s))
    : [];
  const steps = Array.isArray(rec["stepDeltas"])
    ? (rec["stepDeltas"] as unknown[]).filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && !Array.isArray(s))
    : [];
  const blockerTotals = Array.isArray(rec["blockerReasonTotals"])
    ? (rec["blockerReasonTotals"] as unknown[]).filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null && !Array.isArray(b))
    : [];
  const caveats = readStringArray(rec, "caveats");
  const safe =
    liveTradingStatus === "disabled" &&
    rec.authorizesLiveTrading === false &&
    rec.anyInputAuthorizesLiveTrading === false &&
    rec.neverSends === true &&
    rec.phase7LiveTradingReady === false;
  const scanClean =
    scan !== null &&
    scan.signaturePresent === false &&
    scan.txidPresent === false &&
    scan.sendResultPresent === false &&
    scan.keyLikePresent === false;
  const consistencyLabel = (key: string): string => {
    const c = asRecord(consistency[key]);
    return c === null ? DASH : `${readString(c, "label") ?? DASH} (${num(readNumber(c, "okRuns"))}/${num(readNumber(c, "totalRuns"))})`;
  };
  const sign = (n: unknown): string => (typeof n === "number" ? (n > 0 ? `+${n}` : `${n}`) : DASH);
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Sniper alpha history trend — LIVE TRADING DISABLED · THIS DOES NOT SEND TRANSACTIONS"
        : "Alpha history trend is missing its no-send / not-authorized safety literals — do NOT trust this artifact",
      body: html`A no-send series across ordered alpha-history snapshots. The order is the
        <strong>supplied order</strong> — there is no wall-clock and no fake time series.
        <strong>Movement is not momentum.</strong> <code>authorizesLiveTrading</code> and
        <code>anyInputAuthorizesLiveTrading</code> are <strong>false</strong>;
        <code>liveTradingStatus</code> is <strong>${liveTradingStatus}</strong>.`,
    })}
    ${kvSection("Alpha history trend", undefined, [
      { term: "trend id", detail: code(readString(rec, "trendId")) },
      { term: "snapshots", detail: text(num(readNumber(rec, "snapshotCount"))) },
      { term: "summary", detail: text(summaryLine ?? DASH) },
      { term: "provider consistency", detail: text(`risk ${consistencyLabel("risk")} · quote ${consistencyLabel("quote")} · sim ${consistencyLabel("simulation")}`) },
      { term: "sensitive-field scan", detail: text(scanClean ? "clean (no signature / txid / send-result / key-shaped field)" : "INCOMPLETE — review") },
      { term: "live-trading status", detail: text(liveTradingStatus ?? DASH) },
    ])}
    ${tableSection({
      title: `Snapshots (${String(snapshots.length)}) — supplied order`,
      description: "Each snapshot is one alpha-history rollup. Verdict counts come from each rollup's own re-derivation.",
      columns: [{ header: "Label" }, { header: "Runs" }, { header: "Candidates" }, { header: "Watch" }, { header: "Review" }, { header: "Blocked" }, { header: "Insufficient" }],
      rows: snapshots.slice(0, 200).map((s) => {
        const vc = asRecord(s["verdictCounts"]) ?? {};
        return [
          code(readString(s, "label")),
          text(num(readNumber(s, "runCount"))),
          text(num(readNumber(s, "totalCandidateCount"))),
          text(num(readNumber(vc, "watch"))),
          text(num(readNumber(vc, "review"))),
          text(num(readNumber(vc, "blocked"))),
          text(num(readNumber(vc, "insufficientEvidence"))),
        ];
      }),
      empty: "No snapshots.",
    })}
    ${steps.length === 0 ? "" : tableSection({
      title: "Step deltas (consecutive snapshots)",
      description: "Movement between each pair of consecutive snapshots — bookkeeping, never a forecast.",
      columns: [{ header: "From" }, { header: "To" }, { header: "Blocked Δ" }, { header: "Watch Δ" }, { header: "Candidates Δ" }],
      rows: steps.slice(0, 200).map((st) => {
        const vd = asRecord(st["verdictDeltas"]) ?? {};
        return [
          code(readString(st, "fromLabel")),
          code(readString(st, "toLabel")),
          text(sign(readNumber(vd, "blocked"))),
          text(sign(readNumber(vd, "watch"))),
          text(sign(readNumber(st, "candidateDelta"))),
        ];
      }),
      empty: "No step deltas.",
    })}
    ${blockerTotals.length === 0 ? "" : tableSection({
      title: "Most common blocker reasons (across snapshots)",
      description: "Total run-occurrences of each blocker reason across all snapshots (a blocker is never overridable by a score).",
      columns: [{ header: "Reason" }, { header: "Run occurrences" }, { header: "Snapshots" }],
      rows: blockerTotals.slice(0, 100).map((b) => [text(readString(b, "reason") ?? DASH), text(num(readNumber(b, "totalRunCount"))), text(num(readNumber(b, "snapshotCount")))]),
      empty: "No blocker reasons.",
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

function renderSniperStrategyIntelligenceView(rec: Record<string, unknown>): RawHtml {
  const missing: string[] = [];
  const intelligenceId = need(missing, "intelligenceId", readString(rec, "intelligenceId"));
  const liveTradingStatus = need(missing, "liveTradingStatus", readString(rec, "liveTradingStatus"));
  const verdicts = asRecord(rec["verdictCounts"]);
  const confidence = asRecord(rec["confidenceCounts"]);
  const mintClasses = asRecord(rec["mintClassCounts"]);
  const candidates = Array.isArray(rec["candidates"])
    ? (rec["candidates"] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
  const concerns = Array.isArray(rec["topConcerns"])
    ? (rec["topConcerns"] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
  const strategyNotes = readStringArray(rec, "strategyNotes");
  const nextActions = readStringArray(rec, "nextSafeActions");
  const caveats = readStringArray(rec, "caveats");
  const safe =
    liveTradingStatus === "disabled" &&
    rec.authorizesLiveTrading === false &&
    rec.neverSends === true &&
    rec.phase7LiveTradingReady === false &&
    rec.notAProfitabilityClaim === true;
  return html`
    ${RiskNotice({
      tone: safe ? "info" : "caution",
      title: safe
        ? "Sniper strategy intelligence — LIVE TRADING DISABLED · read-only study guidance, NOT a buy signal"
        : "Strategy intelligence is missing its no-send / not-a-profitability-claim literals — do NOT trust this artifact",
      body: html`Read-only candidate intelligence projected from a campaign + token:risk reports: the notable risk
        flags by name, a mint class, a confidence label (evidence completeness — never price direction), reason
        codes, and plain-English why-this-matters / what-to-study-next. Verdicts come from the campaign's own
        re-derivation; a high score can never override a blocker. <code>liveTradingStatus</code> is
        <strong>${liveTradingStatus}</strong>; it is never a buy signal and never a profitability claim.`,
    })}
    ${kvSection("Strategy intelligence", undefined, [
      { term: "id", detail: code(intelligenceId) },
      { term: "candidates", detail: text(num(readNumber(rec, "candidateCount"))) },
      {
        term: "verdicts",
        detail: verdicts === null
          ? text(DASH)
          : text(`watch ${num(readNumber(verdicts, "watch"))} · review ${num(readNumber(verdicts, "review"))} · blocked ${num(readNumber(verdicts, "blocked"))} · insufficient ${num(readNumber(verdicts, "insufficientEvidence"))}`),
      },
      {
        term: "confidence",
        detail: confidence === null
          ? text(DASH)
          : text(`high ${num(readNumber(confidence, "high"))} · medium ${num(readNumber(confidence, "medium"))} · low ${num(readNumber(confidence, "low"))}`),
      },
      {
        term: "mint classes",
        detail: mintClasses === null
          ? text(DASH)
          : text(`wrapped-sol ${num(readNumber(mintClasses, "wrappedSol"))} · stablecoin ${num(readNumber(mintClasses, "stablecoin"))} · other ${num(readNumber(mintClasses, "other"))}`),
      },
      { term: "provenance", detail: code(readString(rec, "evidenceProvenance")) },
      { term: "live-trading status", detail: text(liveTradingStatus ?? DASH) },
    ])}
    ${tableSection({
      title: `Candidates (${String(candidates.length)})`,
      description: "Per-candidate intelligence. Verdicts come from the campaign — never a buy list.",
      columns: [{ header: "Verdict" }, { header: "Candidate" }, { header: "Mint" }, { header: "Class" }, { header: "Confidence" }, { header: "Risk" }, { header: "Reason codes" }],
      rows: candidates.slice(0, 200).map((c) => [
        code(readString(c, "verdict")),
        code(readString(c, "candidateId")),
        text(readString(c, "mint") ?? DASH),
        text(readString(c, "mintClass") ?? DASH),
        text(readString(c, "confidence") ?? DASH),
        text(readString(c, "riskDecision") ?? DASH),
        text(readStringArray(c, "reasonCodes").items.join(", ") || DASH),
      ]),
      empty: "No candidates.",
    })}
    ${concerns.length === 0 ? "" : tableSection({
      title: "Top read-only concerns",
      description: "How many candidates carry each notable risk flag (a flag is read verbatim from its risk report).",
      columns: [{ header: "Flag" }, { header: "Severity" }, { header: "Candidates" }],
      rows: concerns.map((c) => [code(readString(c, "flagId")), text(readString(c, "severity") ?? DASH), text(num(readNumber(c, "candidateCount")))]),
      empty: "No concerns.",
    })}
    ${strategyNotes.total === 0 ? "" : Section({
      title: "Strategy notes",
      body: html`<ul class="sm-bullets sm-bullets--plain">${strategyNotes.items.map((n) => html`<li>${n}</li>`)}</ul>`,
    })}
    ${nextActions.total === 0 ? "" : Section({
      title: "Next safe actions",
      body: html`<ul class="sm-bullets sm-bullets--plain">${nextActions.items.map((a) => html`<li>${a}</li>`)}</ul>`,
    })}
    ${caveats.total === 0 ? "" : Section({
      title: `Caveats (${String(caveats.total)})`,
      body: html`<ul class="sm-bullets sm-bullets--plain">${caveats.items.map((c) => html`<li>${c}</li>`)}</ul>`,
    })}
    ${partialNotice(missing)}
  `;
}

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
    case "sniper.mainnet_dryrun.release_candidate.v1":
      return renderMainnetDryRunReleaseCandidateView(rec);
    case "phase7.authorization.audit.v1":
      return renderPhase7AuthorizationAuditView(rec);
    case "execution.devnet.funding_status.v1":
      return renderDevnetFundingStatusView(rec);
    case "phase7.human_signoff.record.v1":
      return renderPhase7HumanSignoffView(rec);
    case "phase7.microtrade.preflight.v1":
      return renderPhase7MicrotradePreflightView(rec);
    case "sniper.operator_demo.manifest.v1":
      return renderSniperOperatorDemoView(rec);
    case "sniper.watchlist.v1":
      return renderSniperWatchlistView(rec);
    case "sniper.dryrun.campaign.v1":
      return renderSniperDryRunCampaignView(rec);
    case "sniper.readonly_campaign.plan.v1":
      return renderSniperReadonlyCampaignPlanView(rec);
    case "sniper.dryrun.campaign.diff.v1":
      return renderSniperCampaignDiffView(rec);
    case "sniper.alpha_run.report.v1":
      return renderSniperAlphaRunReportView(rec);
    case "sniper.alpha_history.v1":
      return renderSniperAlphaHistoryView(rec);
    case "sniper.alpha_history.diff.v1":
      return renderSniperAlphaHistoryDiffView(rec);
    case "sniper.alpha_history.trend.v1":
      return renderSniperAlphaHistoryTrendView(rec);
    case "sniper.strategy_intelligence.v1":
      return renderSniperStrategyIntelligenceView(rec);
    case "sniper.provider_health.report.v1":
      return renderSniperProviderHealthView(rec);
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
    case "engine.realtime.observations.report.v1":
      return renderEngineRealtimeObservationsView(rec);
    case "engine.routequote.score.report.v1":
      return renderEngineQuoteScoreView(rec);
    case "engine.tx.inspect.report.v1":
      return renderEngineTxInspectView(rec);
    case "engine.sim.classification.report.v1":
      return renderEngineSimClassificationView(rec);
    case "engine.sniper.score.report.v1":
      return renderSniperCandidateScoreView(rec);
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
