# Sol Maker — Alpha Release Checklist

A practical, honest snapshot of what the Sol Maker alpha can and cannot do, and exactly how to show it.

**The alpha is a no-send, read-only operator workflow.** Live trading is **disabled by policy** and is
structurally impossible to trigger from the CLI. Nothing in this checklist sends, signs, or loads a key.

---

## 1. What works now

All of these are paper / dry-run / read-only and ship with tests:

- **Paper pipeline** — candidate intake, token preflight, paper decisions, workflow planning, run
  reports + diffs, policy config, audit log, session packs, safety gates.
- **Read-only risk** — `token:risk` (advisory) and `token:risk --deep` (holder concentration, metadata
  mutability, freeze/mint authority, Token-2022 extension blockers). Proven on real mainnet data.
- **Route quotes** — `paper:routequote:fetch` (live Jupiter quotes) + `paper:routequote:prepare`, with
  honest freshness provenance and a Rust quote scorer (`engine:quote:score`).
- **Unsigned build dry-run** — `execution:build` is refusal-first, produces an UNSIGNED envelope only,
  and **never signs or sends**. `paper:simulation:tx` runs a real `simulateTransaction` (sigVerify
  false) over the unsigned envelope. `engine:tx:inspect` decodes its wire shape.
- **Rust candidate scoring** — `engine:sniper:score` ranks candidates from a facts bundle (intelligence
  only; a score never moves a verdict).
- **Mainnet dry-run release candidate** — `paper:sniper:rehearse --mode mainnet-dry-run` folds the
  pipeline into `sniper.mainnet_dryrun.release_candidate.v1` (live-send pinned disabled).
- **Devnet proof** — `execution:devnet:funding-status` / `execution:devnet:rehearse` (the only
  broadcast surface, devnet-only, double opt-in) + reconciliation accounting.
- **Watchlist** — `paper:sniper:watchlist:prepare` (`sniper.watchlist.v1`; a status is bookkeeping
  only, never trade readiness).
- **Campaign (aggregation)** — `paper:sniper:campaign:run` compares candidates across evidence the
  operator already gathered (`sniper.dryrun.campaign.v1`).
- **Auto-campaign (S105-A)** — `paper:sniper:campaign:auto-run` GATHERS the safe read-only evidence
  itself across candidates and writes `sniper.readonly_campaign.plan.v1` + `sniper.dryrun.campaign.v1` +
  `sniper.alpha_run.report.v1` + per-candidate evidence + `RUN_SUMMARY.md`. Network reads happen ONLY in
  `--mode mainnet-dry-run` with the explicit `--allow-readonly-network` opt-in; a risk REJECT
  short-circuits the candidate's downstream stages; unavailable providers / Rust are recorded honestly.
- **Campaign diff (S105-A)** — `paper:sniper:campaign:diff` (`sniper.dryrun.campaign.diff.v1`): movement
  only (added / removed / changed, score deltas, verdict transitions, improved / worsened / newly-blocked
  / newly-watch). Never overrides a verdict; authorizes nothing.
- **Alpha report (S105-A)** — `paper:sniper:alpha:report` (`sniper.alpha_run.report.v1`): a showable
  summary with top / blocked / insufficient candidates, provider + Rust engine health, the Phase 7
  posture, and honest evidence provenance. Never a profitability or live-readiness claim.
- **UI command center** — `pnpm web:inspect --dir <folder>` renders typed views for every artifact above
  (plan / campaign / diff / alpha report included) under a **LIVE TRADING DISABLED** banner; the
  `/sniper` page carries the calm Phase 7 posture.
- **Operator demo** — `paper:sniper:operator-demo` assembles a safe, showable folder that now includes
  the whole alpha workflow (plan + campaign + diff + alpha report), every artifact labelled by
  provenance.

## 2. What does NOT work yet (honest)

- **Live trading** — not implemented; 0% by policy.
- **Autonomous sniper** — there is no unattended trading loop.
- **Mainnet send** — there is **no** `execution:mainnet:*send*` command, no `arm` / `go-live` /
  `force-live` flag, and no mainnet send seam anywhere. The only broadcast surface is
  `execution:devnet:send` (devnet, double opt-in).
- **Signed Phase 7 authorization** — no written human Phase 7 sign-off exists yet. The audit
  (`paper:phase7:authorization:audit`) stays `authorized-for-design-only`; the micro-trade preflight
  (`paper:phase7:microtrade:preflight`) stays `blocked-missing-signoff`.
- **S104-B execution surface** — the controlled mainnet micro-trade send commands are **not built** and
  must not be built without separate, explicit written user authorization.

## 3. How to demo the alpha

```
# 1. Create a watchlist (or use a candidate list).
pnpm soulmaker paper:sniper:watchlist:prepare --candidates runs/candidates.json --out runs/watchlist.json

# 2. Run the auto campaign.
#    Offline (no network): ingest risk files; Rust scoring runs offline.
pnpm soulmaker paper:sniper:campaign:auto-run --watchlist runs/watchlist.json \
  --risk <MINT>=risk.<MINT>.json --out runs/alpha --run-id demo
#    Live read-only (mainnet-dry-run): gather deep risk + quotes itself (no send, no signer).
pnpm soulmaker paper:sniper:campaign:auto-run --candidates runs/candidates.json \
  --mode mainnet-dry-run --allow-readonly-network --out runs/alpha --run-id demo

# 3. Diff against a previous run.
pnpm soulmaker paper:sniper:campaign:diff --before runs/prev/campaign.json \
  --after runs/alpha/campaign.json --out runs/alpha/campaign-diff.json

# 4. Inspect the alpha report (it is also written by auto-run).
pnpm soulmaker paper:sniper:alpha:report --campaign runs/alpha/campaign.json \
  --plan runs/alpha/readonly-campaign-plan.json --diff runs/alpha/campaign-diff.json \
  --out runs/alpha/alpha-report.json

# 5. Open the command center over the whole folder.
pnpm web:inspect --dir runs/alpha
```

Or run the curated workbench in one command: `paper:sniper:operator-demo --out runs/demo`, then
`pnpm web:inspect --dir runs/demo`.

## 4. Safety status

- **no-send** — no command builds, signs, or broadcasts a mainnet transaction; the alpha artifacts pin
  `liveSendStatus` / `liveTradingStatus` `"disabled"` and refuse any `signature` / `txid` / `sendResult`
  field (closed schemas).
- **no-signer** — the alpha runner loads no keypair; `loadLocalSignerBoundary` is devnet-only and
  refuses a mainnet signer without an armed fourteen-condition gate (which never arms).
- **no-live-trading** — the fourteen-condition live gate defaults blocked; `resolveExecutionMode` is
  fail-closed (unknown / `mainnet-live` → blocked or paper).
- **no Rust send / sign** — the Rust engine is read-only/intelligence only (serde + serde_json), behind
  JSON IPC and TypeScript parity walls; it has no network, signer, or send.
- **no secrets** — `pnpm safety:scan` is clean; mints (≤44 base58 chars) are safe; no tx signature
  (≥80-char base58) is ever committed; `runs/` and key/secret paths are gitignored.

## 5. Next gates (in order)

1. **Written human Phase 7 sign-off** — generate with `paper:phase7:signoff:template`; this is the only
   remaining live blocker. Until it is signed, the audit cannot read
   `ready-for-separate-microtrade-authorization` and the preflight stays `blocked-missing-signoff`.
2. **Explicit S104 execution authorization** — a separate, written user authorization, distinct from the
   sign-off and from any audit/preflight verdict. No agent self-authorizes.
3. **Build the controlled micro-trade surface (S104-B)** — only after 1 + 2, as a separate, reviewed
   sprint: burner wallet, micro cap, manual confirmation (see
   [docs/S104_CONTROLLED_MICROTRADE_PLAN.md](S104_CONTROLLED_MICROTRADE_PLAN.md) and
   [docs/PHASE7_AUTHORIZATION_DOSSIER.md](PHASE7_AUTHORIZATION_DOSSIER.md)).

**Win condition for the alpha (met):** watchlist → live-read-only auto-campaign where safe → diff →
alpha report → command center, with live trading still disabled.
