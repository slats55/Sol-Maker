# Operator dress rehearsal (PAPER-only, fictional fixtures)

> **Everything in this folder is a deterministic FICTIONAL fixture — NOT live data, NOT a trade
> signal, NOT financial advice.** Every mint is an invented synthetic 32-byte base58 key, every
> observed/inspection/risk value is made up, and nothing here builds, signs, simulates, or sends a
> transaction. The dry-run command itself is SIMULATION ONLY: it creates no live order, touches no
> wallet, and reaches no network.

This folder is the one-command walkthrough of the PAPER sniper dry-run. Each candidate file is a
ready-to-run operator input for `paper:sniper:dry-run`; together the four cover every operator
verdict the pipeline can produce. Real runs use the same file shapes with your own candidates and
your own read-only `token:inspect` / `token:risk` output.

## Files

| File | What it is |
| --- | --- |
| `candidates.minimal.json` | The smallest valid input: one candidate, only `candidateId` + `mint`. |
| `candidates.rich.json` | Every optional candidate field populated (2 candidates: one clean, one freeze-authority). |
| `preflight-input.rich.json` | `sniper.preflight.input.v1` inspection/risk data for the rich candidates. |
| `candidates.watch-only.json` | One freeze-authority candidate → watch decision → the BEST verdict. |
| `preflight-input.watch-only.json` | Preflight data for the watch-only candidate (clean risk, freeze authority). |
| `candidates.blocked-risk.json` | One candidate whose risk data is a critical REJECT → blocked chain. |
| `preflight-input.blocked-risk.json` | Preflight data carrying the invented critical REJECT. |

## The four rehearsals

Run each from the repo root. Every run writes the same 20-file artifact set (see below) into its
`--out` directory and exits 0 — a BLOCKED chain is the honest artifact set, not an error
(`--fail-on-blocked` gates CI).

### 1. Minimal — what happens with no preflight data and no adopted specs

```bash
pnpm soulmaker paper:sniper:dry-run \
  --candidates examples/sniper/operator-dress-rehearsal/candidates.minimal.json \
  --out runs/rehearsal-minimal
```

Expected verdict: **`blocked`** (6 blocking conditions). With no preflight data the candidate is
honestly `unknown` and the fail-closed default policy refuses to paper-enter it; the governance
specs default to DRAFT, which blocks the chain
(`simulation-blocked-kill-switch-not-adopted`, `simulation-blocked-secrets-policy-not-adopted`,
`simulation-blocked-burner-isolation-not-adopted`, `simulation-blocked-prereqs-not-ready`, plus the
two downstream skipped/blocked-plan echoes). Route resolution reports `blocked`.

### 2. Rich — the full clean path (and why it still ends blocked)

```bash
pnpm soulmaker paper:sniper:dry-run \
  --candidates examples/sniper/operator-dress-rehearsal/candidates.rich.json \
  --preflight-input examples/sniper/operator-dress-rehearsal/preflight-input.rich.json \
  --adopt-specs --operator "your-label" --acknowledge-paper-enter-review \
  --run-label rehearsal-rich \
  --out runs/rehearsal-rich
```

Expected verdict: **`blocked`** (1 blocking condition: `simulation-blocked-prereqs-not-ready`).
The clean candidate passes preflight and paper-enters (SIMULATED), the freeze-authority candidate
is watched — and a chain that contains simulated paper-enters **always demands operator review**;
that is the deliberate honest end state of a clean dress rehearsal, not a bug. Route resolution
reports `unavailable` (expected — see below).

### 3. Watch-only — the best verdict the dry-run can produce

```bash
pnpm soulmaker paper:sniper:dry-run \
  --candidates examples/sniper/operator-dress-rehearsal/candidates.watch-only.json \
  --preflight-input examples/sniper/operator-dress-rehearsal/preflight-input.watch-only.json \
  --adopt-specs --operator "your-label" \
  --run-label rehearsal-watch-only \
  --out runs/rehearsal-watch-only
```

Expected verdict: **`reviewable-paper-only`** (0 blocking conditions). The freeze authority makes
the preflight WARN, the decision is `watch` (no simulated paper-enter), and a watch-only chain is
the only state that reaches the bundle's best verdict. It is still SIMULATION ONLY — never
live-trading readiness. Route resolution reports `no_entries` (a watch-only plan has nothing to
resolve).

### 4. Blocked-risk — a critical risk REJECT blocks the chain

```bash
pnpm soulmaker paper:sniper:dry-run \
  --candidates examples/sniper/operator-dress-rehearsal/candidates.blocked-risk.json \
  --preflight-input examples/sniper/operator-dress-rehearsal/preflight-input.blocked-risk.json \
  --adopt-specs --operator "your-label" \
  --run-label rehearsal-blocked-risk \
  --out runs/rehearsal-blocked-risk
```

Expected verdict: **`blocked`** (3 blocking conditions, led by
`simulation-blocked-prereqs-not-ready`; the preflight FAIL means the chain audit is not clean).
The invented critical REJECT paper-rejects the candidate and the chain refuses to proceed.

## Expected output (every run)

Each run writes exactly these files into `--out` (byte-deterministic — rerunning with the same
input produces identical bytes):

```text
candidates.json  preflight.json  policy.json  decision.json  run-report.json
audit-log.json   session-pack.json  kill-switch.json  secrets-policy.json
burner-isolation.json  safety-gates.json  prereqs.json  intent-plan.json
simulation-result.json  route-resolution.json  chain-audit.json  readiness.json
handoff-pack.json  operator-bundle.json  RUN_SUMMARY.md
```

Start with `RUN_SUMMARY.md` (the human summary), then inspect the folder in the web UI:

```bash
pnpm web:inspect --dir runs/rehearsal-rich --force
# then open apps/web/public/research-folder.html in a browser
```

## Verdict categories (closed set)

| Verdict | Meaning |
| --- | --- |
| `reviewable-paper-only` | BEST possible: complete, consistent, nothing blocking — and still SIMULATION ONLY, never live-trading readiness. |
| `blocked` | The chain carries blocking conditions (listed verbatim in the bundle and RUN_SUMMARY.md). |
| `attention` | Something needs review before trusting the bundle (e.g. an audit attention flag). |
| `incomplete` | One or more chain artifacts are missing or invalid. |

## Why route resolution is `unavailable` (and that is correct)

No route-resolver capability exists inside the simulation boundary — by design (see
`docs/PHASE6_DRY_RUN_BOUNDARY.md`). The route-resolution artifact is an honest provenance layer:
it records that **no route was looked up and nothing was invented**. `unavailable` is the expected
status for an unblocked plan with entries; a blocked plan reports `blocked`; a watch-only plan
reports `no_entries`. A future read-only quote layer would replace `unavailable` with real
provenance — never fake fills, never fake routes.
