# Web Local Artifact Inspector

A **static, local, read-only** inspector for the PAPER research/backtest report
JSON artifacts produced by the Soulmaker CLI. It turns one local report file into
a single static HTML page using the existing dashboard shell.

> **Local-only. No upload. No server required. No network. No wallet. No keys.
> No trading. No backend dependency. Not the Chrome extension.** The inspector
> reads one local file and writes one local HTML file — nothing else.

## Why a command, not a browser upload

The dashboard is deliberately script-free: generated pages contain no
`<script>`, no event handlers, and make no network calls. A browser "upload a
file" widget would require client-side JavaScript, breaking that guarantee.

Instead, the inspector is a **Node-only build command** (`pnpm web:inspect`).
It reads the file on your machine and renders a static page — keeping the output
exactly as safe as the rest of the site.

## Usage

Run from the repo root:

```bash
# Render a local report into the inspector page (overwrites the committed
# empty-state page, so --force is required):
pnpm web:inspect --input <report.json> --out apps/web/public/research-artifact.html --force

# Print a machine-readable summary to stdout and write NO file:
pnpm web:inspect --input <report.json> --json

# Restore the committed empty-state inspector page:
pnpm web:build
```

Then open `apps/web/public/research-artifact.html` in a browser (`file://` is
fine).

### Options

| Flag             | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `--input <file>` | **Required.** Path to one local `.json` report artifact.                |
| `--out <file>`   | Output HTML path. Default: `apps/web/public/research-artifact.html`.     |
| `--force`        | Overwrite `--out` if it already exists.                                  |
| `--json`         | Print a machine-readable summary to stdout; write no HTML file.          |
| `-h`, `--help`   | Show usage.                                                              |

### Exit codes

| Code | Meaning                                                              |
| ---- | ------------------------------------------------------------------- |
| `0`  | Success.                                                            |
| `1`  | Runtime error: input file not found, unreadable, or malformed JSON. |
| `2`  | Usage/validation error: missing `--input`, non-`.json` input, directory input, unknown flag, or `--out` exists without `--force`. |

The default `--out` is the committed empty-state page, so by default the
inspector refuses to overwrite it without `--force`. Run `pnpm web:build` to
regenerate the empty state at any time.

## Fail-closed input handling

The command is conservative by design:

- Reads **exactly one** local file — no directories, no globs, no recursion.
- Refuses directory inputs, non-`.json` inputs, and missing files (non-zero exit).
- On malformed JSON it **fails clearly and writes nothing** — no partial output.
- Refuses to overwrite an existing `--out` unless `--force` is given.
- Performs no network, fetch, server, chain, wallet, key, signing, or sending.

## Safe, bounded rendering

`apps/web/src/lib/local-artifact.ts` normalizes any parsed JSON value (object,
array, or primitive) into a small, bounded summary before rendering:

- **Schema is labelled honestly** — known / emerging / unknown / absent. Unknown
  schemas are never faked.
- **Identity & digest** fields (`title`/`name`/`id`/`mode`, `scenarioDigest`/
  `digest`/`hash`, …) are surfaced when present.
- **Warnings / disclaimers / errors** are collected and shown.
- **Top-level scalars** appear in a field table; **objects/arrays** are
  summarized (`array · N items`, `object · N keys`), never dumped inline.
- **Everything is capped** — field counts, string lengths, warning counts, and a
  length-capped raw JSON preview. A huge or deeply-nested artifact can never be
  dumped wholesale into the page.
- **Every untrusted string is HTML-escaped.** Report content is displayed, never
  executed; hostile content (e.g. `<script>`) appears only as escaped text.

The recognized schema ids include:

```
backtest.report.v1                 backtest.suite.v1            backtest.suite.diff.v1
backtest.sensitivity.v1            backtest.sensitivity.diff.v1 backtest.coverage.v1
backtest.variant-plan.explain.v1   backtest.sensitivity.matrix.v1
backtest.sensitivity.matrix.diff.v1
backtest.research.manifest.v1      backtest.research.verify.v1
backtest.research.manifest.diff.v1 backtest.research.bundle.v1
backtest.research.status.v1         backtest.research.campaign.index.v1
```

All of these are now **stable**: the cross-scenario matrix and the research-run
families (manifest / verify / manifest-diff / bundle / status / campaign-index)
have shipped to `master`, each produced by a real CLI command (e.g.
`paper:backtest:sensitivity:matrix`, `paper:backtest:research:manifest`,
`paper:backtest:research:index`). The registry's `cli` field records the real
command per schema, verified against the commands registered in `apps/cli` on
`master`. The `emerging` tier is retained only for forward-compatibility (a
future schema whose backend has not yet landed); no catalogued schema is emerging
today. The inspector never invents a command and labels any unrecognized schema
honestly.

## Schema-aware typed views

On top of the generic summary, the inspector renders a **typed, schema-aware
view** when it recognizes the declared `schemaVersion`. Each typed view surfaces
the high-signal fields for that schema — identity, headline counts,
regression/validity status, and row-capped tables — *above* the generic field
view, which is always still shown.

- **UI-only and defensive.** Typed views read the parsed JSON purely as data
  (`apps/web/src/lib/json-access.ts`) and render via
  `apps/web/src/components/artifact-views.ts`. There is **no backend import**;
  the inspector never executes backend logic.
- **Honest about gaps.** A missing or type-mismatched field renders as “—”, and a
  visible **partial-view** notice lists fields the inspector could not read. No
  field is ever invented.
- **Unknown schemas fall back safely.** An unrecognized `schemaVersion`, a
  non-object value, or any malformed shape simply renders the generic view — the
  typed dispatch returns nothing and never throws.
- **Same safety envelope.** Typed output is escaped and capped exactly like the
  rest of the inspector: no `<script>`, no handlers, no network, no wallet/keys.

The sensitivity-matrix view adds a deeper drill-down: a **base × variant grid**
(rows = base scenarios, columns = variant suffixes) where each cell shows that
variant's total simulated PnL delta vs the base's baseline. The grid is
row/column-capped (a `·` marks an absent cell; a status word marks a non-diffable
run) and notes anything hidden. The matrix-diff view lists the individual
base × variant **changed cells** (a full grid would be sparse for a diff).

Every currently-recognized schema (the list above) has a typed view. Try one of
the committed sample fixtures under `apps/web/fixtures/`, e.g.:

```bash
pnpm web:inspect --input apps/web/fixtures/sample-research-verify.json \
  --out apps/web/public/research-artifact.html --force
```

The committed empty-state inspector page also lists which schemas have typed
views; run `pnpm web:build` to restore it.

## What this is not

- **Not the Chrome extension.** No extension is implemented here; see
  [`CHROME_EXTENSION_COMPANION_PLAN.md`](CHROME_EXTENSION_COMPANION_PLAN.md).
- **Not a live viewer.** It reads a static local file you already generated.
- **Not a wallet / trading surface.** It connects nothing and sends nothing.

See [`WEB_DASHBOARD_FOUNDATION.md`](WEB_DASHBOARD_FOUNDATION.md) and
[`UI_ARCHITECTURE.md`](UI_ARCHITECTURE.md) for the broader dashboard design.
