# Sniper examples (PAPER-only, deterministic fixtures)

> **These are deterministic FIXTURES — NOT live data, NOT trading results, NOT financial advice.**
> The mints in `candidates.example.json` are real, well-known public token mints used purely as
> offline, copyable examples. The mints in the `*.fictional.json` / `candidates.invalid-mint.json` /
> `candidates.duplicate-mint.json` / `preflight-inputs.fictional.json` fixtures are **invented**
> (synthetic valid 32-byte keys), and their inspection/risk values are **invented** — they are **NOT**
> the real on-chain state of any token. Every liquidity / market-cap / volume / observed value is a
> made-up operator-supplied number and is **NOT verified on-chain**. Nothing here builds, signs,
> simulates, or sends a transaction; nothing here is a trade signal.

## One-command dress rehearsal

[`operator-dress-rehearsal/`](operator-dress-rehearsal/README.md) is the fastest way to see the
whole pipeline: four ready-to-run candidate files for `paper:sniper:dry-run` (minimal, rich,
watch-only, blocked-risk) that together produce every operator verdict, with the exact commands,
the expected output folder, and what each verdict means. Start there if you just want to run the
PAPER sniper end to end.

## Fixture files

| File | Purpose |
| --- | --- |
| `candidates.example.json` | Valid candidate list using real, well-known public mints (copyable). |
| `candidates.fictional.json` | Valid candidate list of 3 **invented** mints that drive the end-to-end test. |
| `candidates.duplicate-mint.json` | Two candidates share one mint — exercises the duplicate-mint **warning**. |
| `candidates.invalid-mint.json` | A candidate with an invalid mint — **negative** fixture (intake refuses it). |
| `preflight-inputs.fictional.json` | Invented `token:inspect` / `token:risk`-shaped inputs (keyed by candidateId) for the fictional candidates. |
| `preflight-input.example.json` | A `sniper.preflight.input.v1` input bundle for the example candidates (one entry deliberately missing risk — shows the honest warning). Validate: `pnpm soulmaker paper:sniper:preflight:input:validate --input examples/sniper/preflight-input.example.json --candidates examples/sniper/candidates.example.json`. |
| `policy.example.json` | A conservative example operator/risk policy (`sniper.policy.config.v1`). |
| `preflight-input.v2.fictional.json` | **Fictional** `sniper.preflight.input.v1` input for the V2 end-to-end suite (same invented values as `preflight-inputs.fictional.json`; fic-freeze deliberately misses risk, fic-reject misses inspection). |
| `policy-v2.fictional.json` | **Fictional** raw `sniper.policy.config.v2` input: research-only mode, requires the preflight input artifact. |
| `kill-switch.config.fictional.json` | **Fictional** adopted `sniper.kill_switch.spec.v1` operator config (NOT a kill switch — controls nothing). |
| `secrets-policy.config.fictional.json` | **Fictional** adopted `sniper.secrets.policy.v1` operator config (stores NO secret). |
| `burner-isolation.config.fictional.json` | **Fictional** adopted `sniper.burner.isolation.spec.v1` operator config (NOT a wallet; loss bound is a LABEL). |

The V2 end-to-end suite (`apps/cli/src/sniper-e2e-v2.test.ts`) runs the whole v2 pipeline over these
fixtures — intake → preflight input → preflight → policy v2 → decision v2 → audit → run report v2 →
the three spec artifacts → safety gates v2 → phase6 prereqs v2 → session pack v2 — generating every
artifact into a temp dir (never committed, so artifacts can never drift), validating each with its
production validator, and proving the sequence byte-deterministic. Everything is **fictional**.

## End-to-end walkthrough (fictional fixtures)

The full PAPER pipeline, start to finish, over the invented fixtures (the
[end-to-end test](../../apps/cli/src/sniper-e2e.test.ts) runs exactly this and validates every stage):

```bash
# 1) Intake — validate + normalize (write the CANONICAL list for later stages):
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.fictional.json --json > candidates.json

# 2) Preflight — produce per-candidate inspection/risk files from the fixture, then preflight.
#    (Real inputs come from your own read-only `token:inspect` / `token:risk` output.)
pnpm soulmaker paper:sniper:preflight --candidates candidates.json \
  --inspection fic-clean=fic-clean.insp.json --risk fic-clean=fic-clean.risk.json \
  --inspection fic-freeze=fic-freeze.insp.json --risk fic-reject=fic-reject.risk.json \
  --out preflight.json                # → 1 pass / 1 warn / 1 fail

# 3) Decide (paper-only):
pnpm soulmaker paper:sniper:decide --candidates candidates.json --preflight preflight.json --out decision.json
#   → fic-clean paper-enter, fic-freeze watch, fic-reject paper-reject (SIMULATED)

# 4) Run report (bundle):
pnpm soulmaker paper:sniper:report --candidates candidates.json --preflight preflight.json --decisions decision.json --out run.json

# 5) Run report diff (vs a candidates-only baseline run):
pnpm soulmaker paper:sniper:report --candidates candidates.json --out run-base.json
pnpm soulmaker paper:sniper:diff:report --base run-base.json --next run.json

# 6) Audit log (provenance; no wall-clock time):
pnpm soulmaker paper:sniper:audit --report run.json --label "e2e-run" --out audit.json

# 7) Session pack (bundle the whole session):
pnpm soulmaker paper:sniper:session:pack \
  --artifact candidates=candidates.json --artifact preflight=preflight.json \
  --artifact decision=decision.json --artifact run=run.json --artifact audit=audit.json \
  --label "e2e-session" --out pack.json
```

Every stage is deterministic and **writes nothing** unless `--out` is given. A `paper-enter` is a
**simulated** classification, never an order.

## Candidate intake (Sprint 25)

A sniper bot needs a safe, validated INTAKE layer before it can score, paper-simulate, or (much later,
behind heavy safety work) act on a token. `candidates.example.json` is an operator-authored candidate
list. Validate + normalize it with:

```bash
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json
# JSON (the normalized canonical sniper.candidate.list.v1):
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json --json
# Treat any warning (e.g. a duplicate mint) as a CI failure:
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json --fail-on-warning
```

The command validates every `mint` as a 32-byte Solana **public** key — secret-length /
private-key-like input is **refused** — requires unique `candidateId`s, and surfaces duplicate mints
as warnings. It reads the named file only and **writes nothing**. The list's optional context fields
(`symbol`, `name`, `sourceTag`, `observedLiquidityUsd`, …) are operator-supplied and are **not**
verified on-chain by this step — a later read-only preflight does that.

### Candidate list shape (operator-friendly raw input)

```json
{
  "sourceLabel": "my-watchlist",
  "candidates": [
    { "candidateId": "c1", "mint": "<32-byte base58 mint>", "symbol": "ABC", "sourceTag": "manual" }
  ]
}
```

Only `candidateId` and `mint` are required per candidate. A `schemaVersion`, if present, must be
`sniper.candidate.list.v1`.

## Token preflight (Sprint 26)

The preflight combines each candidate's mint validity with **already-loaded** read-only inspection and
advisory risk data into a `pass` / `warn` / `fail` / `unknown` status. It performs **no on-chain reads
itself** — you produce the inputs with the existing read-only commands and feed them in as local files
(this repo ships no fabricated on-chain facts about real mints):

```bash
# 1) Produce the read-only inputs per candidate (operator-run; token:inspect uses read-only RPC):
pnpm soulmaker token:inspect <mint> --json > example-usdc.inspect.json
pnpm soulmaker token:risk <mint> --json > example-usdc.risk.json

# 2) Preflight the candidate list against those local files (--inspection/--risk are candidateId=path):
pnpm soulmaker paper:sniper:preflight \
  --candidates candidates.example.json \
  --inspection example-usdc=example-usdc.inspect.json \
  --risk example-usdc=example-usdc.risk.json

# JSON / write / CI gates:
pnpm soulmaker paper:sniper:preflight --candidates candidates.example.json --risk example-usdc=example-usdc.risk.json --json
pnpm soulmaker paper:sniper:preflight --candidates candidates.example.json --risk example-usdc=example-usdc.risk.json --out preflight.json
pnpm soulmaker paper:sniper:preflight --candidates candidates.example.json --risk example-usdc=example-usdc.risk.json --fail-on-fail
```

A candidate with no `--inspection` and no `--risk` is reported as `unknown` (it could not be assessed).
A risk `REJECT` or a critical flag is a `fail`; a `CAUTION`, a freeze/mint authority, or a high-severity
flag is a `warn`. The preflight reads the named files only and **writes nothing** unless `--out` is
given. A `pass` means "no preflight concern was found in the supplied data" — it is **not** a "safe to
trade" judgment and **not** a trade signal.

## Paper-only decisions (Sprint 27)

The decision pipeline folds the candidate list + the preflight + optional operator rules into a
per-candidate **simulated** decision. A `paper-enter` is a **paper-only** decision — **not** a buy/sell
order, **not** a transaction, and **not** live readiness.

```bash
# 1) Write the preflight to a file (see above), e.g.:
pnpm soulmaker paper:sniper:preflight --candidates candidates.example.json \
  --inspection example-usdc=example-usdc.inspect.json --risk example-usdc=example-usdc.risk.json \
  --out preflight.json

# 2) Optional rules file (all fields optional):
#    { "requirePreflightPass": true, "maxRiskScore": 60, "minObservedLiquidityUsd": 1000, "denyMints": [] }

# 3) Decide:
pnpm soulmaker paper:sniper:decide --candidates candidates.example.json --preflight preflight.json
pnpm soulmaker paper:sniper:decide --candidates candidates.example.json --preflight preflight.json --rules rules.json --json
pnpm soulmaker paper:sniper:decide --candidates candidates.example.json --preflight preflight.json --out decision.json
pnpm soulmaker paper:sniper:decide --candidates candidates.example.json --preflight preflight.json --fail-on-paper-enter
```

Without `--preflight`, every candidate is conservatively `watch`ed. The command reads the named files
only and **writes nothing** unless `--out` is given.

## Operator workflow helper (Sprint 28)

At any time, ask the helper where you are and what to run next. It checks which artifacts exist +
validate and prints the recommended NEXT command — it **executes nothing**:

```bash
pnpm soulmaker paper:sniper:workflow --candidates candidates.example.json
pnpm soulmaker paper:sniper:workflow --candidates candidates.example.json --preflight preflight.json --decision decision.json --json
```

## Run report (Sprint 30)

Bundle the candidate list + preflight + decision + workflow into one navigable run report. The candidate
list is the spine; the rest are optional and strictly validated (a sub-artifact built from a different
candidate list is refused as a wrong pairing). It **writes nothing** unless `--out`:

```bash
pnpm soulmaker paper:sniper:report --candidates candidates.example.json
pnpm soulmaker paper:sniper:report --candidates candidates.example.json \
  --preflight preflight.json --decisions decision.json --workflow workflow.json --operator "me" --json
pnpm soulmaker paper:sniper:report --candidates candidates.example.json --preflight preflight.json --fail-on-risk
```

The report carries a per-candidate reason trail (each candidate's preflight status + simulated decision),
the grouped id lists, a navigation index, and a CI section. Every status/decision is carried **verbatim**
— it re-derives nothing. A `paper-enter` carried through is a **simulated** classification, never an
order.

## Policy config (Sprint 32)

`policy.example.json` is a conservative example operator/risk policy (`sniper.policy.config.v1`). Its paper
sizing fields are **labels / simulated units only** — `budgetLabel` is a label (not real funds) and
`maxPaperPositionUnits` is a simulated unit cap (not a currency amount). Validate it, then use it to govern
a decision run:

```bash
pnpm soulmaker paper:sniper:policy:validate --input policy.example.json
pnpm soulmaker paper:sniper:policy:validate --input policy.example.json --json --fail-on-warning
# Govern a run (mutually exclusive with --rules); enforcement is tighten-only:
pnpm soulmaker paper:sniper:decide --candidates candidates.example.json --preflight preflight.json --policy policy.example.json
```

A policy can only make the run **more** conservative (downgrade a simulated `paper-enter` to
`watch`/`paper-reject`, or skip a duplicate mint) — never the reverse, and never live.

See [`docs/SNIPER_RUNBOOK.md`](../../docs/SNIPER_RUNBOOK.md) for the full operator runbook.
