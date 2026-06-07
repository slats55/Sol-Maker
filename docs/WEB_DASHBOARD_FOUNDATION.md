# Soulmaker Web Dashboard — Foundation

Status: **foundation only.** A safe, non-conflicting UI shell that prepares the
project for a real dashboard without touching active backend/backtest work and
without adding any new capability or dependency.

This document is the UI counterpart to the roadmap's Phase 8 (web dashboard). It
does **not** supersede [`SECURITY.md`](../SECURITY.md) or
[`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md) — those remain authoritative.

## Product shape

```text
Backend engine  = the bot brain      (packages/*)
CLI             = admin / power-user  (apps/cli)
Web dashboard   = the cockpit         (apps/web)   ← this foundation
Chrome extension= optional companion  (later — design only, see below)
```

The dashboard is a **cockpit, not a trader.** It surfaces local, simulated
research artifacts and the project's safety posture. It never executes anything.

## Hard guarantees (non-negotiable)

The foundation contains **none** of the following, and tests enforce their
absence in rendered output:

- No wallet connection, key, seed/mnemonic, signing, or sending.
- No transaction building, planning, or simulation.
- No live trading, live market data, scraping, or provider network calls.
- No fake "connected wallet", "running bot", or "profit" — no live data at all.
- No new runtime dependencies; no charting library.

Every page renders the required safety language prominently:

```text
PAPER ONLY · No live trading · No wallet connected · No signing or sending
Local simulated reports only · Not financial advice · Not a profitability claim
```

## Scope delivered

Pages (generated to `apps/web/public/`):

| Route (intended)     | File                     | Purpose                                            |
| -------------------- | ------------------------ | -------------------------------------------------- |
| `/`                  | `index.html`             | Cockpit overview: posture, modes, jump-in          |
| `/research`          | `research.html`          | The PAPER-only research pipeline                   |
| `/research/reports`  | `research-reports.html`  | Report viewer foundation + schema catalogue        |
| `/research/matrix`   | `research-matrix.html`   | Sensitivity matrix viewer (emerging schema)        |
| `/research/coverage` | `research-coverage.html` | Suite coverage viewer (behavioural bookkeeping)    |
| `/commands`          | `commands.html`          | Reference for the existing CLI workflows           |
| `/safety`            | `safety.html`            | Modes, hard guarantees, live-mode gate             |
| `/settings`          | `settings.html`          | Local display preferences (placeholder shell)      |

Components: `DashboardShell`, `SidebarNav`, `SafetyBanner`, `ModeBadge`,
`PageHeader`, `Footer`, `StatusCard`, `MetricCard`, `Section`, `EmptyState`,
`RiskNotice`, `Pill`, `DefinitionList`, `BulletList`, `CommandCard`,
`ArtifactCard`, `DataTable`, `CapabilityTable`, `ReportTable`,
`ReportSchemaBadge`, `ReportSummaryCard`, `ReportPlaceholder`.

## Data strategy

- **No live data, ever.** The only sample content is in
  `apps/web/src/lib/sample-data.ts`, tagged `source: "sample-local-ui-fixture"`
  and `isLive: false`.
- Sample status cards report the project's **true** posture (PAPER / none /
  offline / not running) rather than inventing activity.
- The single sample PnL figure is explicitly labelled `simulated · not real ·
  not advice`, mirroring how the backend's own reports are labelled.
- The CLI command reference is **factual documentation** of shipped commands,
  not fixture data.

## Report-viewer foundation

`apps/web/src/lib/report-types.ts` is a **frontend-only** catalogue of the
backtest artifact schemas (`backtest.report.v1`, `backtest.suite.v1`,
`backtest.suite.diff.v1`, `backtest.sensitivity.v1`,
`backtest.sensitivity.diff.v1`, `backtest.coverage.v1`,
`backtest.variant-plan.explain.v1`, plus the emerging
`backtest.sensitivity.matrix.v1` / `…matrix.diff.v1`). It imports **no** backend
code and is **not** wired to any loader/parser — it only lets the UI label known
vs. emerging vs. unknown schemas. File loading is intentionally deferred (no
upload, no network, no backend import).

## Constraints honoured

- Built entirely under `apps/web/**` plus three additive, low-conflict edits:
  `tsconfig.json` (include `apps/web`), `package.json` (a `web:build` script),
  and three new UI docs. No active backend/backtest files were touched.
- Zero new dependencies; reuses the repo's TypeScript + Vitest + ESLint setup.

## Next UI slices (suggested)

1. A read-only local file bridge so the viewer can render a real generated
   report JSON (still local, still no network).
2. Dashboard tables/visuals over loaded artifacts (no charting dep until one is
   justified).
3. An auth shell for an eventual hosted, read-only deployment.
4. The Chrome companion prototype (see
   [`CHROME_EXTENSION_COMPANION_PLAN.md`](CHROME_EXTENSION_COMPANION_PLAN.md)).
