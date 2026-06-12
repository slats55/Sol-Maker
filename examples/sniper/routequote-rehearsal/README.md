# Route quote rehearsal (Sprint 91) — read-only quote provenance, end to end

Everything here is **FICTIONAL** (the mints do not exist on-chain) and **PAPER-only**. A quote
observation proves a route/quote was *visible* to the operator at some point — never that one is
executable. Nothing in this walkthrough signs, sends, builds a transaction, or places an order.

The fixtures reuse the clean candidate + production-generated inspect/risk files from
[`../real-input-rehearsal/`](../real-input-rehearsal/README.md) and add the S91 layer on top:

- [`quote.fica.fictional.json`](quote.fica.fictional.json) — a `quote-observed` observation for
  FICA (WSOL → FICA via a fictional venue; label-only amounts/fees; the observed-at value is an
  operator LABEL, never system time).
- [`quote.ficb.error.fictional.json`](quote.ficb.error.fictional.json) — the honest non-observed
  path: an `error` outcome with a reason, never upgraded, never faked.

## The full chain

```bash
mkdir runs/routequote-rehearsal

# 1) Bridge the read-only inspect/risk fixtures to the clean candidate list (S90):
pnpm soulmaker paper:sniper:preflight:input:prepare \
  --candidates examples/sniper/real-input-rehearsal/candidates.clean.fictional.json \
  --inspect examples/sniper/real-input-rehearsal/inspect.fica.fictional.json \
  --risk examples/sniper/real-input-rehearsal/risk.fica.fictional.json \
  --out runs/routequote-rehearsal/pf.json

# 2) Bridge the quote observation to the same candidate list (S91):
pnpm soulmaker paper:routequote:prepare \
  --candidates examples/sniper/real-input-rehearsal/candidates.clean.fictional.json \
  --quote examples/sniper/routequote-rehearsal/quote.fica.fictional.json \
  --out runs/routequote-rehearsal/rq.json

# 3) Run the PAPER dry-run with both bridges:
pnpm soulmaker paper:sniper:dry-run \
  --candidates examples/sniper/real-input-rehearsal/candidates.clean.fictional.json \
  --preflight-input runs/routequote-rehearsal/pf.json \
  --routequote runs/routequote-rehearsal/rq.json \
  --adopt-specs --acknowledge-paper-enter-review \
  --operator "you" --run-label routequote-rehearsal \
  --out runs/routequote-rehearsal/out

# 4) Inspect the folder in the web UI:
pnpm web:inspect --dir runs/routequote-rehearsal/out --force
```

## What you should see (pinned by `apps/cli/src/routequote-rehearsal-example.test.ts`)

- The intent plan is **unblocked** with 1 entry (clean preflight + the review acknowledgment).
- `route-resolution.json` records the quote facts with provenance: resolver
  `routequote-operator-supplied`, **attempted: yes**, per-entry route + fee facts
  `resolved-as-label`, destination honestly **unresolved** (a quote validates no destination),
  artifact status `unresolved`, and the **live-state caveat: YES**.
- `routequote-prepared.json` rides verbatim in the output folder with the mandatory caveats.
- The operator verdict is still **`blocked`** on `simulation-blocked-prereqs-not-ready` —
  paper-enters always demand operator review. That is the system telling the truth, not a bug,
  and a quote can never change it.
- `phase7LiveTradingReady` is `false` everywhere. Nothing became executable.

Two identical runs produce byte-identical artifacts (determinism is pinned too).
