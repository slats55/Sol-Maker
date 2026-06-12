# Real-input operator rehearsal (PAPER-only)

This folder is the Sprint 90 **real-input rehearsal**: the full operator path from read-only token
intelligence to a PAPER dry-run artifact folder, using the **bridge** command
`paper:sniper:preflight:input:prepare`.

> **No wallet is involved anywhere in this flow.** No key, no seed phrase, no signing, no
> transaction, no order, no live trade. The only chain access is the *read-only* `token:inspect` /
> `token:risk` commands (and only when you run them yourself against your own RPC). Everything
> downstream is local file processing.

## The real path (operator-supplied inputs)

Replace `<MINT>` with a real mint you want to research. You need a local `soulmaker.config.json`
with `mode: "WATCH_ONLY"` (or `PAPER` plus `--allow-paper-read`) and an `rpcUrl`. Create the output
folder first — no command here creates directories for single-file `--out` paths.

```bash
mkdir -p runs/rehearsal

# 1. Author your candidate file (see candidates.fictional.json for the shape).
#    candidateId, mint, and any observed* numbers are YOUR labels — nothing verifies them.

# 2. Capture read-only intelligence as JSON (UTF-8 — prefer --out over shell redirection;
#    PowerShell's `>` writes UTF-16, which the downstream readers refuse):
pnpm soulmaker token:inspect <MINT> --json --out runs/rehearsal/inspect.json
pnpm soulmaker token:risk <MINT> --json --out runs/rehearsal/risk.json

# 3. Bridge the outputs into the preflight input artifact (paired to candidates BY MINT):
pnpm soulmaker paper:sniper:preflight:input:prepare \
  --candidates runs/rehearsal/candidates.json \
  --inspect runs/rehearsal/inspect.json --risk runs/rehearsal/risk.json \
  --out runs/rehearsal/preflight-input.json

# 4. One-command PAPER dry-run (writes 19 artifacts + RUN_SUMMARY.md):
pnpm soulmaker paper:sniper:dry-run \
  --candidates runs/rehearsal/candidates.json \
  --preflight-input runs/rehearsal/preflight-input.json \
  --adopt-specs --operator "<your-name>" --acknowledge-paper-enter-review \
  --run-label real-input-rehearsal \
  --out runs/rehearsal/out

# 5. Open the folder in the web UI (then read RUN_SUMMARY.md):
pnpm web:inspect --dir runs/rehearsal/out --force
```

**Operator-supplied** (nothing here invents them): the mints, the candidate file, the RPC endpoint,
and any observed liquidity/market-cap labels. **Honesty rules of the bridge**: read-only values are
carried VERBATIM; a candidate without data stays uncovered with an explicit warning (never marked
safe); malformed, cross-kind, unknown-mint, duplicate, or secret-shaped files are refused.

## The offline fictional path (runnable right now, no RPC)

The committed fixtures here are **FICTIONAL** — invented mints that do not exist on-chain — but
their *shapes* are generated through the production builders
(`scripts/gen-real-input-rehearsal-fixtures.ts`; the pin test fails if they drift):

| File | What it is |
| --- | --- |
| `candidates.fictional.json` | Two fictional candidates: FICA (clean facts) + FICB (freeze authority). |
| `candidates.clean.fictional.json` | FICA only — the remedy run after FICB is rejected. |
| `inspect.fica.fictional.json` / `inspect.ficb.fictional.json` | `token:inspect --json` shaped output (production-built). |
| `risk.fica.fictional.json` / `risk.ficb.fictional.json` | Real risk-engine output over the invented facts (FICB → critical `freeze-authority-present`, decision REJECT). |

```bash
mkdir -p runs/rehearsal-fictional

pnpm soulmaker paper:sniper:preflight:input:prepare \
  --candidates examples/sniper/real-input-rehearsal/candidates.fictional.json \
  --inspect examples/sniper/real-input-rehearsal/inspect.fica.fictional.json \
  --inspect examples/sniper/real-input-rehearsal/inspect.ficb.fictional.json \
  --risk examples/sniper/real-input-rehearsal/risk.fica.fictional.json \
  --risk examples/sniper/real-input-rehearsal/risk.ficb.fictional.json \
  --out runs/rehearsal-fictional/preflight-input.json

pnpm soulmaker paper:sniper:dry-run \
  --candidates examples/sniper/real-input-rehearsal/candidates.fictional.json \
  --preflight-input runs/rehearsal-fictional/preflight-input.json \
  --adopt-specs --operator "rehearsal" --acknowledge-paper-enter-review \
  --run-label real-input-rehearsal \
  --out runs/rehearsal-fictional/out

pnpm web:inspect --dir runs/rehearsal-fictional/out --force
```

### What you should see (pinned by `apps/cli/src/real-input-rehearsal-example.test.ts`)

- **Mixed run (FICA + FICB)** — decisions: FICA `paper-enter`, FICB `paper-reject` (critical
  freeze-authority REJECT). One rejected candidate honestly **blocks the whole chain**: operator
  verdict `blocked`, route `blocked`, blocking codes `simulation-blocked-prereqs-not-ready`,
  `simulation-dry-run-skipped-blocked-plan`, `simulation-route-resolution-blocked-plan`; the intent
  plan is blocked with 0 entries. That is risk-first behavior, not a bug.
- **Clean run (`candidates.clean.fictional.json`, FICA only)** — the canonical honest end state:
  verdict `blocked` on the single code `simulation-blocked-prereqs-not-ready` (paper-enters always
  demand operator review), route honestly `unavailable` (no resolver capability exists), intent
  plan **unblocked with 1 entry**.

Neither outcome is a trade signal. `reviewable-paper-only` is the best verdict this system can ever
produce; nothing in it can become a live order.

## Regenerating the fixtures

```bash
pnpm tsx scripts/gen-real-input-rehearsal-fixtures.ts
```
