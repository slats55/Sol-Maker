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
src/build.ts     generator: wraps each page in the shell, writes public/
src/inspect.ts   Node-only command: reads ONE local report JSON, writes one page
fixtures/        committed, benign sample report JSON (for the inspect smoke/tests)
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

`pnpm web:inspect` (`apps/web/src/inspect.ts`) is a second, separate writer: it
reads exactly one local report JSON, normalizes it via `lib/local-artifact.ts`,
and renders the loaded artifact through the **same** `DashboardShell` to a single
flat file (default `public/research-artifact.html`). It shares the safety
guarantees of the generator — no upload, no network, no server, no wallet, no
keys — and never executes report content (everything is escaped and capped). See
[`WEB_LOCAL_ARTIFACT_INSPECTOR.md`](WEB_LOCAL_ARTIFACT_INSPECTOR.md).

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

## Adding a page

1. Add a `NavItem` to `src/lib/nav.ts` (group, icon, route, file).
2. Add `src/pages/<name>.ts` exporting `render<Name>(): RawHtml`.
3. Register it in `src/pages/registry.ts`.
4. `pnpm web:build`, then `pnpm typecheck && pnpm lint && pnpm test`.

## Out of scope (by design)

No wallet/keys/signing/sending, no transaction planning/simulation, no live
data/scraping/network, no new dependencies, no backend imports, no charting
library. See [`WEB_DASHBOARD_FOUNDATION.md`](WEB_DASHBOARD_FOUNDATION.md).
