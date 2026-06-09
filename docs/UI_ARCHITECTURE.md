# Soulmaker UI Architecture

How `apps/web` is built, and the conventions to keep it safe and consistent.

## Principle: render functions, not a framework

The foundation is rendered as **plain HTML strings** produced by pure
TypeScript functions. There is no React/Next/Vite/bundler and no runtime
dependency. This is deliberate:

- It fits the repo's existing toolchain (TypeScript ESM, Vitest, ESLint) with
  **no new dependencies** and **no lockfile churn** — which also avoids
  conflicting with backend work that may touch dependencies.
- It typechecks under the repo's Node-only `tsconfig` (`lib: ["ES2022"]`, no
  `dom`), so components must stay DOM-free (no `document`, no `window`).
- It is trivially testable: a component is a function from typed data to a
  string.

A real app framework can be introduced later as its own decision; nothing here
blocks that.

## The HTML engine (`src/lib/html.ts`)

- `html\`...\`` is a tagged template that returns a `RawHtml` fragment.
- **Every interpolated string is HTML-escaped by default** (XSS-safe). Numbers
  are stringified; `null`/`undefined`/booleans render as empty; arrays flatten.
- Pre-rendered fragments (other components) are `RawHtml` and are inserted
  verbatim — so composition never double-escapes.
- `raw(s)` marks trusted HTML. **Never wrap untrusted/dynamic text in `raw()`.**
  Pass dynamic text as a plain string so it is escaped.
- `renderToString(value)` produces the final string.
- `renderDocument(value)` is `renderToString` plus per-line trailing-whitespace
  stripping. Use it **only at the document-write boundary** (the static
  generator and the inspect command) so committed output stays clean; never for
  inline fragments, where whitespace can be significant.

## Layers

```text
src/lib/         pure data + the html engine (no components)
  html.ts              rendering primitives
  safety.ts            modes, disclaimers, hard guarantees, current mode
  nav.ts               routes + inline SVG icons
  report-types.ts      frontend-only report schema registry + envelope type
  command-reference.ts factual CLI command reference data (+ web build/inspect)
  local-artifact.ts    defensive normalizer for a local report JSON (pure, bounded)
  json-access.ts       defensive accessors/formatters for untrusted JSON (pure, bounded)
  folder-index.ts      pure folder-index builder + schema-aware diff-verdict extraction
  sample-data.ts       clearly-labelled, non-live fixtures

src/components/  pure RawHtml builders (import lib, never pages)
  layout.ts            DashboardShell, SidebarNav, SafetyBanner, ModeBadge, …
  ui.ts                StatusCard, MetricCard, Section, EmptyState, RiskNotice, …
  cards.ts             CommandCard, ArtifactCard
  tables.ts            DataTable, CapabilityTable, ReportTable
  reports.ts           ReportSchemaBadge, ReportSummaryCard, ReportPlaceholder
  artifact.ts          ArtifactSchemaBadge, ArtifactReportView (inspector view)
  artifact-views.ts    schema-aware typed views + renderTypedArtifactView dispatch

src/pages/       one render function per page + registry.ts (the page list)
  artifact.ts          renderArtifact (empty state) + renderArtifactReport (loaded)
  folder.ts            renderFolder (empty state) + renderFolderIndex (loaded)
src/build.ts     generator: wraps each page in the shell, writes public/
src/inspect.ts   Node-only command: --input reads ONE report JSON; --dir scans a
                 folder of report JSON; writes one static page either way
fixtures/        committed, benign sample report JSON (for the inspect smoke/tests);
                 folder-sample/ is a mixed sample folder for the folder-index tests
styles/theme.css the dark command-center theme
tests/           Vitest tests
public/          GENERATED output (committed; do not hand-edit)
```

Dependency direction is one-way: `pages → components → lib`. The shell injects
the `SafetyBanner` and `Footer` so every page carries the required safety
language automatically.

## Generation & the "no stale output" rule

`pnpm web:build` (`apps/web/src/build.ts`) renders `pages/registry.ts` through
`DashboardShell` and writes `public/*.html` + `public/assets/theme.css`.
`public/` is committed so the site opens with no dev server (`file://` works).

`tests/pages.test.ts` re-renders each page and asserts the committed file
matches — so forgetting to rebuild fails the test, not review.

`pnpm web:inspect` (`apps/web/src/inspect.ts`) is a second, separate writer with
two modes:

- `--input <report.json>` reads exactly one local report JSON, normalizes it via
  `lib/local-artifact.ts`, and renders the loaded artifact through the **same**
  `DashboardShell` to a single flat file (default `public/research-artifact.html`).
- `--dir <folder>` scans one local folder of report JSON (no recursion), builds a
  bounded folder index via `lib/folder-index.ts`, and renders it through the same
  shell to `public/research-folder.html`, with a per-artifact section for each
  recognized artifact that reuses the single-artifact inspector view.

Both modes share the safety guarantees of the generator — no upload, no network,
no server, no wallet, no keys — and never execute report content (everything is
escaped and capped). See
[`WEB_LOCAL_ARTIFACT_INSPECTOR.md`](WEB_LOCAL_ARTIFACT_INSPECTOR.md).

## Folder index + diff verdicts (`src/lib/folder-index.ts`)

The folder index is a **pure, total** layer (lib, no component imports): the
Node-only `--dir` mode reads the directory and hands `buildFolderIndex` a list of
already-read entries (`{ name, type: "json", text }` or `{ name, type: "skipped",
reason }`). It parses each JSON entry defensively, normalizes valid artifacts,
extracts a verdict, and aggregates honest counts (scanned / valid / malformed /
skipped / unknown / with-regression / with-change) plus a by-schema breakdown.
Output is **deterministic** — entries are sorted by name first, so the same folder
always yields byte-identical HTML.

`extractVerdict(schemaVersion, raw)` is the conservative core. Each verdict field
is `"yes" | "no" | "missing" | "not-applicable"`:

- A recognized **diff** schema's real `hasRegression` / `hasChange` boolean is
  reflected (`true` → "yes", `false` → "no"). The set of which schema carries
  which field mirrors the backend diff interfaces verified on `master`
  (`packages/backtest/src/*-diff.ts`): sensitivity / suite / matrix diffs carry
  `hasRegression` only; the research-manifest diff carries `hasChange` only; the
  research bundle and campaign diffs carry both.
- A field the schema **carries but is missing** (absent or wrong type) →
  `"missing"`, never silently `"no"` — a missing verdict is not a clean one.
- A recognized **non-diff** schema → `"not-applicable"` (it has no such concept).
- An **unknown / absent** schema → `"not-applicable"`; verdict fields are **not**
  read from unrecognized shapes, so an unknown artifact can never fabricate a
  verdict even if it literally contains those booleans.

`hasTypedView` is **injected** into `buildFolderIndex` (rather than imported from
the component layer) so the lib stays dependency-free; the inspect command and the
folder-index tests pass the real predicate from `components/artifact-views.ts`.
The page (`pages/folder.ts`) renders verdict badges (`.sm-verdict--regression` /
`--changed` / `--clean`, with muted `missing` / `n/a`), a by-schema table, an
artifact list that links to per-artifact sections, a skipped-files table, and a
verdict legend — all escaped and capped like the rest of the inspector.

## Schema-aware typed views (`src/components/artifact-views.ts`)

The inspector renders two layers for a loaded artifact:

1. A **typed, schema-aware view** when the declared `schemaVersion` is recognized
   — identity fields, headline counts, regression/validity notices, and
   row-capped tables tailored to that schema.
2. The **generic normalized view** (always shown below the typed view) plus the
   length-capped raw preview, so nothing is ever hidden.

`renderTypedArtifactView(view, raw)` is the dispatch: it picks a renderer by
`schemaVersion` and returns `null` to fall back to the generic view. It is **UI-only
and total** by contract:

- It imports **no backend package**; it reads the raw parsed JSON purely as data
  through `lib/json-access.ts` (every accessor returns `null` on a missing or
  type-mismatched field — it never throws).
- It returns `null` for an unknown schema, for a non-object value, and for any
  error thrown while building a view (wrapped in `try/catch`).
- Untrusted values are interpolated as **plain strings** (escaped by the `html`
  engine) and **never** wrapped in `raw()`; tables/lists are row-capped and
  digests elided.
- Missing expected fields render as “—” with a visible **partial-view** notice,
  so a typed view is honest about what it could not read.

The sensitivity-matrix view goes a level deeper with a **base × variant grid**
(rows = base scenarios, columns = variant suffixes; each cell = that variant's
total simulated PnL delta vs the base baseline). It is row/column-capped, marks
absent cells with `·` and non-diffable cells with a status word, and is wrapped
in `.sm-matrixgrid` (a sticky first column + tabular numerals). Typed-view chrome
has dedicated, dependency-free CSS hooks — `.sm-typedview__self`,
`.sm-artifactview__generic-lead`, `.sm-digest`, `.sm-matrixgrid` — and degrades
gracefully if the stylesheet is absent.

Adding a typed view: extend `lib/report-types.ts` (so the schema is badged), add
a `render<Schema>View(rec)` and a `switch` case in `buildTypedView`, add a
fixture/test, and `pnpm web:build`.

## Styling conventions

- All classes are prefixed `sm-` and follow a light BEM style
  (`block__element`, `block--modifier`).
- Tones map to CSS variables: `safe` (green), `info` (sky), `caution` (amber),
  `danger` (red), `muted` (gray). Dark theme only, for now.
- Icons are tiny inline SVGs using `currentColor` (no icon dependency).

## Safety invariants enforced by tests

- Every rendered page contains the required PAPER-only safety language.
- No rendered page contains scripts, inline event handlers, network calls
  (`fetch`/`axios`/WebSocket), or transaction/key identifiers
  (`signTransaction`, `sendTransaction`, `Keypair`, `privateKey`, …).
- Interpolated strings are escaped (verified with hostile inputs).
- Sample data is always `isLive: false` and never fakes connected/running/profit.
- `report-types.ts` labels known vs. emerging vs. unknown schemas honestly.
- Schema-aware typed views are defensive: unknown schemas, non-object values, and
  malformed shapes fall back to the generic view, and missing fields render as
  “—” — the dispatcher never throws.
- The command-reference page lists every shipped backtest/research CLI command,
  and each command's produced-artifact badge (id + stable/emerging status) is
  **derived** from the schema registry via `schemaForCli` rather than duplicated.
  A drift guard (`tests/command-reference.test.ts`) asserts every registry `cli`
  is a real listed command, so the page and the registry cannot drift silently;
  a command with no catalogued artifact simply shows no badge (never a faked one).

## Adding a page

1. Add a `NavItem` to `src/lib/nav.ts` (group, icon, route, file).
2. Add `src/pages/<name>.ts` exporting `render<Name>(): RawHtml`.
3. Register it in `src/pages/registry.ts`.
4. `pnpm web:build`, then `pnpm typecheck && pnpm lint && pnpm test`.

## Out of scope (by design)

No wallet/keys/signing/sending, no transaction planning/simulation, no live
data/scraping/network, no new dependencies, no backend imports, no charting
library. See [`WEB_DASHBOARD_FOUNDATION.md`](WEB_DASHBOARD_FOUNDATION.md).
