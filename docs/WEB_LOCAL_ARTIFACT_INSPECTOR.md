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
| `--input <file>` | Path to ONE local `.json` report artifact (single-artifact mode).       |
| `--dir <folder>` | Path to a local folder of report JSON (folder-index mode, no recursion). Exactly one of `--input` / `--dir` is required. |
| `--out <file>`   | Output HTML path. Default: `apps/web/public/research-artifact.html` for `--input`, `apps/web/public/research-folder.html` for `--dir`. |
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
backtest.research.bundle.diff.v1   backtest.research.campaign.diff.v1
sniper.paper.decision.report.v2    sniper.run.report.v2         sniper.run.report.diff.v2
simulation.intent.plan.v2          simulation.result.v1         simulation.route.resolution.v1
simulation.intent.plan.diff.v2     simulation.result.diff.v1
phase6.audit.report.v1             phase6.simulation.readiness.report.v1
phase6.simulation.handoff.pack.v1
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

### Sprint 19 research-diff schemas (now on `master`)

The last two ids above are the Sprint 19 research diffs. They were **merged to
`origin/master`** (verified at commit `53a7f83`: `packages/backtest/src/research-bundle-diff.ts`
and `research-campaign-index-diff.ts`), so the UI now catalogues them as stable:

| Schema                                 | CLI command                             |
| -------------------------------------- | --------------------------------------- |
| `backtest.research.bundle.diff.v1`     | `paper:backtest:diff:research:bundle`   |
| `backtest.research.campaign.diff.v1`   | `paper:backtest:diff:research:index`    |

Both have a faithful committed fixture (`apps/web/fixtures/sample-research-bundle-diff.json`,
`sample-research-campaign-diff.json`) shaped to the real backend types, and a
typed view (below). For any schema NOT yet on `master`, the inspector still
degrades honestly: `schemaForCli` returns `undefined`, the command reference shows
no artifact badge rather than a fake one, and an artifact bearing an unrecognized
`schemaVersion` falls back to the generic, capped, escaped view (see
`apps/web/tests/command-reference.test.ts` for the forward-compat guard).

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

The Sprint 19 **research bundle diff** and **campaign diff** views each lead with
a conservative integrity-regression notice (distinct from the broader change
notice), then a compared-summary block, a row-capped change table (added /
removed / digest-changed artifacts, or changed runs with their validity
transition), and a count-change table — all read defensively and escaped.

### Sniper + Phase 6 simulation schemas (S25–S87, verified on `master`)

The inspector also catalogues and renders typed views for the paper-only sniper
pipeline and the Phase 6 simulation chain — eleven schemas, each mapped to its
real CLI command (`paper:sniper:decide` / `paper:sniper:report` /
`paper:sniper:diff:report` with `--schema-version v2`, and the eight
`paper:simulation:*` artifact commands). These are integrity/safety artifacts,
and the views keep their honesty rules visible:

- **UNRESOLVED / UNAVAILABLE / BLOCKED states render as the truthful capability
  boundary, never as success or failure.** No route resolver and no real dry-run
  engine exist; the route-resolution view says so in plain language, and a
  blocked plan/result/route renders as the honest fail-closed record.
- **Safety locks are echoed from the artifact's own data** (`neverSigns`,
  `neverSends`, `dryRunOnly`, `neverAuthorizesLiveTrading`, and the always-false
  `phase7LiveTradingReady` where the schema carries it). A lock that reads
  unsafe gets a loud *treat-as-tampered* warning — the backend validators refuse
  such artifacts.
- **The S87 chain roles are visible**: the Phase 6 audit view lists all ten
  audited roles and the handoff view all twelve handed-off roles, including
  `route-resolution`; the readiness view shows the eleven-area evidence bar
  including `route-resolution-tests`.
- **Nothing is ever phrased as an order, an execution, or live readiness.** A
  `paper-enter` is rendered as a SIMULATED classification demanding operator
  review; the readiness view pins Phase 7 to a permanent NO.

The committed `sample-simulation-*` / `sample-sniper-*` / `sample-phase6-*`
fixtures are **FICTIONAL artifacts generated by the backend production builders**
(the same fictional fixture chain the repo's e2e tests use — invented mints,
`sample-fictional-*` labels). They are deterministic test/preview data and are
never real chain data, real candidates, or real market results.

Every currently-recognized schema (the list above) has a typed view. Try one of
the committed sample fixtures under `apps/web/fixtures/`, e.g.:

```bash
pnpm web:inspect --input apps/web/fixtures/sample-research-verify.json \
  --out apps/web/public/research-artifact.html --force
# or a Phase 6 artifact:
pnpm web:inspect --input apps/web/fixtures/sample-phase6-audit-report.json \
  --out apps/web/public/research-artifact.html --force
```

The committed empty-state inspector page also lists which schemas have typed
views; run `pnpm web:build` to restore it.

## Local artifact folder index (`--dir`)

Reviewing one artifact at a time is fine for a single file, but a research run or
a campaign produces a *folder* of them. The `--dir` mode scans **one local folder**
of report JSON (no recursion) and renders a static **index** with a safe
**diff-verdict overview**, so you can see across many artifacts at once.

> **Same local-only contract as the single-artifact inspector.** It reads local
> files and writes one local HTML file — **no upload, no server, no network, no
> wallet, no keys, no trading.** It is **not** the Chrome extension and **not** a
> live view of anything.

### Usage

```bash
# Scan a local folder of report JSON into the folder index page (overwrites the
# committed empty-state page, so --force is required):
pnpm web:inspect --dir <folder> --out apps/web/public/research-folder.html --force

# Print a machine-readable folder summary to stdout and write NO file:
pnpm web:inspect --dir <folder> --json

# Restore the committed empty-state folder index page:
pnpm web:build
```

There is a committed sample folder you can try directly:

```bash
pnpm web:inspect --dir apps/web/fixtures/folder-sample \
  --out apps/web/public/research-folder.html --force
```

### What the index shows

For the folder it summarizes:

- **Which artifacts were found**, each with its filename, declared `schemaVersion`,
  the registered schema kind (if known), and a stable / unknown / absent status.
- **Whether a typed view is available** for each artifact.
- **Diff verdicts** — whether each artifact indicates `hasRegression` and/or
  `hasChange` (see below).
- **Top-level counts** — total files scanned, valid JSON artifacts, malformed JSON
  files, skipped non-JSON files, unknown schemas, artifacts with regression,
  artifacts with change, and counts by schema.
- **Per-artifact sections** — every recognized artifact links to a section on the
  same page rendered with the typed inspector view; malformed files are clearly
  labelled and never parsed into a fake view.
- **Static filter sections** — the scan is also grouped into pre-rendered
  all / regression / changed / unknown-or-malformed / clean sections (no
  JavaScript; see [Static filter sections](#static-filter-sections-pre-rendered-no-javascript)).

### Fail-soft scanning

The folder scan is conservative but does not abort on bad input:

- Reads only `.json` files in the folder. **No recursion**, no globs.
- Non-`.json` files and subdirectories are **skipped with an honest count** and a
  reason — never silently dropped.
- **Malformed JSON is listed** (with the parser's message) instead of crashing the
  scan; nothing is interpreted from it.
- Unknown or absent `schemaVersion` values are **labelled honestly**, never faked.
- Output is **deterministic**: entries are sorted by name first, so the same folder
  always produces byte-identical HTML.

### Diff verdict fields — and why `missing` is not `false`

Each artifact gets a verdict with two fields, each one of
`yes` / `no` / `missing` / `not-applicable`:

| Verdict          | Meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `yes`            | The artifact's own flag (`hasRegression` / `hasChange`) is `true`.       |
| `no`             | The artifact's own flag is `false`.                                      |
| `missing`        | The schema carries this field, but it was absent or not a boolean.       |
| `not-applicable` | The schema has no such field (a non-diff artifact, or an unknown schema). |

The verdict layer is **schema-aware**. Only the recognized **diff** schemas carry
these fields, and each carries a specific subset (mirroring the backend diff types
on `master`):

| Schema                                 | `hasRegression` | `hasChange` |
| -------------------------------------- | :-------------: | :---------: |
| `backtest.suite.diff.v1`               | ✅              | —           |
| `backtest.sensitivity.diff.v1`         | ✅              | —           |
| `backtest.sensitivity.matrix.diff.v1`  | ✅              | —           |
| `backtest.research.manifest.diff.v1`   | —               | ✅          |
| `backtest.research.bundle.diff.v1`     | ✅              | ✅          |
| `backtest.research.campaign.diff.v1`   | ✅              | ✅          |

Two rules keep the overview honest:

- **`missing` is never collapsed into `no`.** If a recognized diff schema *should*
  carry a verdict field but it is absent or the wrong type, the index says
  `missing` — it does **not** pretend the field was `false`. A missing verdict is
  an unknown, not a clean result.
- **Unknown schemas never produce a verdict.** Verdict fields are read only from a
  recognized diff schema. An unrecognized artifact is `not-applicable` even if it
  literally contains `hasRegression` / `hasChange` booleans — the index does not
  infer regression from text, filenames, or invented fields, so it cannot show a
  fake verdict. (The committed `fixtures/folder-sample/unknown-schema.json` proves
  this: it carries both booleans set to `true`, yet renders as `not-applicable`.)

### Static filter sections (pre-rendered, no JavaScript)

The loaded folder page groups the same scan into **five pre-rendered filter
sections**, plus a row of summary cards that link to them. These are generated at
inspect time from the local folder summary — there is **no JavaScript, no query
params, and no dynamic browser behaviour**. Each card is a plain in-page fragment
link (`#sm-filter-…`) to a section further down the page.

| Section                           | Membership                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| **All artifacts**                 | Every JSON file found (valid or malformed). Keeps the `sm-folder-artifacts` anchor.         |
| **Regression artifacts**          | Recognized diff artifacts whose own `hasRegression` flag is `yes`.                          |
| **Changed artifacts**             | Recognized diff artifacts whose own `hasChange` flag is `yes` (a regression is **not** required). |
| **Unknown or malformed artifacts**| Unrecognized schemas, artifacts with no `schemaVersion`, and malformed JSON.                |
| **Clean / no-change artifacts**   | Recognized artifacts with **no** regression or change flagged.                              |

The grouping is deterministic and conservative — it derives entirely from each
artifact's status / schema / verdict, exactly like the verdict layer above:

- An artifact may appear in **both** Regression and Changed when its own flags say
  so; Unknown and Clean never overlap each other or the regression/changed pair.
- **Unknown / absent / malformed artifacts are never** counted as regression,
  change, or clean — even if an unknown artifact literally contains
  `hasRegression` / `hasChange` booleans, they are not trusted, so it lands only in
  the Unknown-or-malformed section.
- **Malformed JSON** always appears in the Unknown-or-malformed section (never in a
  group that implies it was interpreted). Skipped non-`.json` files are **not
  artifacts** — they stay in the separate Skipped-files table and are absent from
  every filter section.
- A recognized diff whose verdict field is **`missing`** is not a regression or a
  change (because `missing` is never treated as `yes`), and it is a recognized
  schema (so it is not unknown/malformed) — it therefore appears under
  Clean / no-change with an honest `missing` badge, never a faked `no`.
- Each section's **heading count equals the rows it renders**, and the same counts
  ride along in the `--json` summary under a `filters` object
  (`{ all, regression, changed, unknown, clean }`).

### Sample folder fixture

`apps/web/fixtures/folder-sample/` is a small, clearly-labelled mixed folder used
by the folder-index tests. It contains a stable non-diff report, a bundle diff with
`hasRegression: true`, a bundle diff with `hasChange: true` but no regression, a
manifest diff (change-only), an unknown-schema artifact, an absent-schema artifact,
a malformed `.json` file, and a non-JSON `.txt` file — exercising every branch of
the scan and verdict logic.

## What this is not

- **Not the Chrome extension.** No extension is implemented here; see
  [`CHROME_EXTENSION_COMPANION_PLAN.md`](CHROME_EXTENSION_COMPANION_PLAN.md).
- **Not a live viewer.** It reads a static local file you already generated.
- **Not a wallet / trading surface.** It connects nothing and sends nothing.

See [`WEB_DASHBOARD_FOUNDATION.md`](WEB_DASHBOARD_FOUNDATION.md) and
[`UI_ARCHITECTURE.md`](UI_ARCHITECTURE.md) for the broader dashboard design.
