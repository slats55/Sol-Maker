# Final Live Build — Part 3 Production Release Checklist

Part 2 delivered an armed, human-confirmed canary sniper loop (see `docs/FINAL_PART_2_STATUS.md`).
Part 3 is the **production release hardening** sprint. Nothing below weakens a Part 1/2 safety gate;
each item is additive hardening. **No item authorizes autonomous mainnet trading or backend signing.**

> **Sprint 109 status (honest):** Part 3 shipped the supervised operator release — config
> validation, the durable session journal, the recommend-only supervised run, reconciliation/PnL,
> the operator dashboard, local alert hooks, the runbook and the release dossier
> (`docs/FINAL_LIVE_RELEASE_DOSSIER.md`). Items are marked below: `[x]` done, `[~]` partially done
> (what shipped / what remains), `[ ]` still open. **No real canary was executed** (no human /
> funded burner available); the truthful artifact is
> `examples/live/part3/ready-for-human-canary.report.json`.

## 1. Production packaging
- [ ] Build/publish the CLI + web console as a versioned, reproducible artifact.
- [ ] Pin and audit all runtime dependencies; no `@latest`, SRI on every browser asset.
- [ ] Ship a signed release tag.

## 2. Long-running operator mode
- [~] A supervised long-running discovery/observe process (bounded, journaled, restart-safe).
      *Shipped (S109): `live:operator:run` — bounded journaled passes with `--max-candidates` /
      `--max-runtime-ms`; pause/re-arm/caps are durable across restarts via the journal. Remaining:
      a resident daemon variant, if wanted.*
- [x] It still only ever RECOMMENDS; the human Phantom confirmation stays mandatory. *(tested per mode)*
- [ ] Backpressure + rate limits on provider calls. *(no resident fetch loop exists yet)*

## 3. Alerts & monitoring
- [~] Structured logs/metrics for each pipeline stage + provider health.
      *Shipped (S109): per-stage session events (candidate/risk/quote/canary/Phantom/reconcile).
      Remaining: provider-health metrics.*
- [x] Alerts on: kill-switch engaged, escalation auto-pause, canary/Phantom lifecycle, risk
      rejection. *(S109: `live.operator.alert.v1`, console + local webhook-file sinks, disabled by
      default; quote staleness surfaces as blocking reasons in the run events)*
- [x] No secret ever logged; redaction verified in the log path. *(deep scans + tests on journal
      events and alert payloads)*

## 4. Durable storage
- [~] Persist discovery/watchlist/shadow/run/reconciliation artifacts to durable storage.
      *Shipped (S109): every operator command takes `--out`; the runbook names the evidence set
      under `runs/`. Remaining: automatic retention/rotation.*
- [~] Append-only, tamper-evident session ledger; retention policy.
      *Shipped (S109): the JSONL journal (strict seq, closed after end, secrets refused).
      Remaining: retention policy.*

## 5. Deployment (local + cloud)
- [ ] Reproducible local run; documented cloud deploy (no key custody anywhere).
- [ ] The web console served over HTTPS; CSP; the RPC endpoint is operator-configured.

## 6. Strategy feedback loop
- [ ] Feed real paper-shadow outcomes back into threshold tuning (transparent, versioned).
- [ ] Backtest strategy v2 against recorded shadow sessions; no fabricated alpha.

## 7. PnL / accounting hardening
- [x] Real per-trade PnL from on-chain balances + token prices where available; `unknown` otherwise.
      *(S109: `live.operator.reconciliation.v1` — pre/post SOL+token snapshots, gross received,
      SOL spent, evidenced-price-only valuation, re-derived confidence)*
- [x] Fee/priority-fee/slippage-realized accounting; daily-loss enforcement wired to real ledger.
      *(S109: realized slippage bps vs quote; the journal's reconciliation events feed
      `dailyLossSol` into the escalation gate)*

## 8. Multi-chain adapter implementation
- [ ] Implement at least one of the planned `ChainAdapter` stubs (EVM) behind the same
      default-blocked, human-confirmed model — or keep them honestly `not_implemented`.

## 9. Security review
- [ ] Full external security review of the live surface + signing flow.
- [ ] Re-audit the safety-scan allowlist; keep it narrow.
- [ ] Threat-model the browser console (phishing, tampered artifact, malicious RPC).

## 10. Final release
- [x] Final gates green (typecheck/lint/test/web:build/safety:scan/cargo/bench). *(S109; exact
      counts in `docs/FINAL_LIVE_RELEASE_DOSSIER.md`)*
- [ ] Written human sign-off for any expansion beyond the tiny canary. *(NOT granted; large trades
      stay disabled)*
- [~] Tag the release; publish the runbook. *(runbook published:
      `docs/FINAL_PART_3_PRODUCTION_CANARY_RUNBOOK.md`; signed tag still open with §1)*

## Explicitly OUT of scope for Part 3 (unless separately authorized in writing)
- Backend private-key custody, backend signing, or backend sending — **never**.
- Autonomous mainnet trading without a human Phantom confirmation — **never**.
- Larger-than-canary sizes without an explicit, separately-reviewed escalation authorization.
