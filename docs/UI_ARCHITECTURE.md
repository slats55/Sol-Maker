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

## Layers

```text
src/lib/         pure data + the html engine (no components)
  html.ts              rendering primitives
  safety.ts            modes, disclaimers, hard guarantees, current mode
  nav.ts               routes + inline SVG icons
  report-types.ts      frontend-only report schema registry + envelope type
  command-reference.ts factual CLI command reference data
  sample-data.ts       clearly-labelled, non-live fixtures

src/components/  pure RawHtml builders (import lib, never pages)
  layout.ts            DashboardShell, SidebarNav, SafetyBanner, ModeBadge, …
  ui.ts                StatusCard, MetricCard, Section, EmptyState, RiskNotice, …
  cards.ts             CommandCard, ArtifactCard
  tables.ts            DataTable, CapabilityTable, ReportTable
  reports.ts           ReportSchemaBadge, ReportSummaryCard, ReportPlaceholder

src/pages/       one render function per page + registry.ts (the page list)
src/build.ts     generator: wraps each page in the shell, writes public/
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

## Adding a page

1. Add a `NavItem` to `src/lib/nav.ts` (group, icon, route, file).
2. Add `src/pages/<name>.ts` exporting `render<Name>(): RawHtml`.
3. Register it in `src/pages/registry.ts`.
4. `pnpm web:build`, then `pnpm typecheck && pnpm lint && pnpm test`.

## Out of scope (by design)

No wallet/keys/signing/sending, no transaction planning/simulation, no live
data/scraping/network, no new dependencies, no backend imports, no charting
library. See [`WEB_DASHBOARD_FOUNDATION.md`](WEB_DASHBOARD_FOUNDATION.md).
