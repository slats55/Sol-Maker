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
backtest.research.manifest.diff.v1
```

Emerging schemas (the cross-scenario matrix and research-run families) are
labelled **emerging** because the corresponding backend work is in progress; the
inspector still renders them, it just does not pretend they are finalized.

## What this is not

- **Not the Chrome extension.** No extension is implemented here; see
  [`CHROME_EXTENSION_COMPANION_PLAN.md`](CHROME_EXTENSION_COMPANION_PLAN.md).
- **Not a live viewer.** It reads a static local file you already generated.
- **Not a wallet / trading surface.** It connects nothing and sends nothing.

See [`WEB_DASHBOARD_FOUNDATION.md`](WEB_DASHBOARD_FOUNDATION.md) and
[`UI_ARCHITECTURE.md`](UI_ARCHITECTURE.md) for the broader dashboard design.
