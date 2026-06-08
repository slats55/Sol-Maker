# apps/web — Soulmaker dashboard (foundation)

A **safe, zero-dependency static foundation** for the Soulmaker web dashboard —
the "cockpit" half of the product (backend engine = brain, CLI = admin, web =
cockpit).

> **PAPER ONLY · local · offline · no wallet.** This foundation connects no
> wallet, holds no key, signs/sends nothing, makes no network calls, and shows
> no live data. Every page says so prominently. See
> [`../../SECURITY.md`](../../SECURITY.md) and
> [`../../docs/WALLET_SAFETY_MODEL.md`](../../docs/WALLET_SAFETY_MODEL.md).

## What this is

A real UI shell — navigation, layout, safety surfaces, a report-viewer
foundation, a command reference, and safety/settings pages — rendered as plain
HTML/CSS so it fits the repo's existing toolchain with **no new dependencies**:

- **Source of truth:** DOM-free TypeScript "render functions" in
  [`src/`](src) that return HTML strings. They typecheck under the repo's
  Node-only `tsconfig` (no `dom` lib) and are tested with the existing Vitest.
- **Generated output:** [`pnpm web:build`](../../package.json) renders every
  page through the shared shell to [`public/`](public) (committed static HTML)
  and copies the theme to `public/assets/theme.css`.
- **No framework, no bundler, no runtime deps.** A real app framework can be
  layered on later; this foundation deliberately does not pick one yet.

## Quick start

```bash
pnpm install
pnpm web:build           # regenerate public/*.html from src/
# then open apps/web/public/index.html in a browser (file:// is fine)

# Inspect ONE local PAPER report JSON as a static page (local-only, no network):
pnpm web:inspect --input <report.json> --out apps/web/public/research-artifact.html --force
pnpm web:inspect --input <report.json> --json   # print a summary, write nothing
```

Gates (run from the repo root):

```bash
pnpm typecheck
pnpm lint
pnpm test                # includes apps/web/tests/**
```

## Layout

```text
apps/web/
  src/
    lib/         html engine, safety model, nav, report-schema registry,
                 CLI command reference, local-artifact normalizer, fixtures
    components/  layout (shell, sidebar, banner), ui primitives, cards,
                 tables, report-viewer + artifact-inspector components
    pages/       one render function per route + a registry
    build.ts     static-site generator (reads styles/, writes public/)
    inspect.ts   Node-only command: read ONE local report JSON → one static page
  fixtures/      committed benign sample report JSON (inspect smoke + tests)
  styles/        theme.css (dark command-center theme)
  tests/         Vitest tests (rendering, safety, schema, normalizer, CLI, drift)
  public/        GENERATED static site — do not edit by hand
```

`public/` is generated. Edit `src/` / `styles/` and re-run `pnpm web:build`;
a test (`tests/pages.test.ts`) fails if the committed output is stale.

## Local artifact inspector

`pnpm web:inspect` renders **one local PAPER report JSON** into a static page
(`public/research-artifact.html`) using the same shell. It is **local-only**:
reads one `.json` file, writes one HTML file — no upload, no server, no network,
no wallet, no keys. Report content is normalized, capped, and HTML-escaped, never
executed. Malformed JSON, directories, and non-`.json` inputs are refused with a
non-zero exit; the default output is the committed empty-state page, so
overwriting it requires `--force`. Full details:
[`../../docs/WEB_LOCAL_ARTIFACT_INSPECTOR.md`](../../docs/WEB_LOCAL_ARTIFACT_INSPECTOR.md).

## Data policy

There is **no live data**. The only sample content lives in
[`src/lib/sample-data.ts`](src/lib/sample-data.ts), where every item is tagged
`source: "sample-local-ui-fixture"` and `isLive: false`. Sample status cards
reflect the project's *true* posture (PAPER / no wallet / offline / engine not
running) — they never fake a connected wallet, a running bot, or profit. The
`fixtures/` directory holds a clearly-benign sample report used only by the
inspect smoke test and tests.

## Deliberately NOT here

No wallet connection, no key/seed handling, no signing/sending, no transaction
building/planning/simulation, no live market data, no scraping, no network
calls, no charting library, no new dependencies. The Phantom / Solana Wallet
Adapter "watch-only" idea from the original roadmap is **deferred and gated** —
it is not part of this foundation.

See [`../../docs/WEB_DASHBOARD_FOUNDATION.md`](../../docs/WEB_DASHBOARD_FOUNDATION.md)
and [`../../docs/UI_ARCHITECTURE.md`](../../docs/UI_ARCHITECTURE.md).
