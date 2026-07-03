# Final Live Build — Part 3 Production Release Checklist

Part 2 delivered an armed, human-confirmed canary sniper loop (see `docs/FINAL_PART_2_STATUS.md`).
Part 3 is the **production release hardening** sprint. Nothing below weakens a Part 1/2 safety gate;
each item is additive hardening. **No item authorizes autonomous mainnet trading or backend signing.**

## 1. Production packaging
- [ ] Build/publish the CLI + web console as a versioned, reproducible artifact.
- [ ] Pin and audit all runtime dependencies; no `@latest`, SRI on every browser asset.
- [ ] Ship a signed release tag.

## 2. Long-running operator mode
- [ ] A supervised long-running discovery/observe process (bounded, journaled, restart-safe).
- [ ] It still only ever RECOMMENDS; the human Phantom confirmation stays mandatory.
- [ ] Backpressure + rate limits on provider calls.

## 3. Alerts & monitoring
- [ ] Structured logs/metrics for each pipeline stage + provider health.
- [ ] Alerts on: kill-switch engaged, escalation auto-pause, provider fail-closed, quote staleness.
- [ ] No secret ever logged; redaction verified in the log path.

## 4. Durable storage
- [ ] Persist discovery/watchlist/shadow/run/reconciliation artifacts to durable storage.
- [ ] Append-only, tamper-evident session ledger; retention policy.

## 5. Deployment (local + cloud)
- [ ] Reproducible local run; documented cloud deploy (no key custody anywhere).
- [ ] The web console served over HTTPS; CSP; the RPC endpoint is operator-configured.

## 6. Strategy feedback loop
- [ ] Feed real paper-shadow outcomes back into threshold tuning (transparent, versioned).
- [ ] Backtest strategy v2 against recorded shadow sessions; no fabricated alpha.

## 7. PnL / accounting hardening
- [ ] Real per-trade PnL from on-chain balances + token prices where available; `unknown` otherwise.
- [ ] Fee/priority-fee/slippage-realized accounting; daily-loss enforcement wired to real ledger.

## 8. Multi-chain adapter implementation
- [ ] Implement at least one of the planned `ChainAdapter` stubs (EVM) behind the same
      default-blocked, human-confirmed model — or keep them honestly `not_implemented`.

## 9. Security review
- [ ] Full external security review of the live surface + signing flow.
- [ ] Re-audit the safety-scan allowlist; keep it narrow.
- [ ] Threat-model the browser console (phishing, tampered artifact, malicious RPC).

## 10. Final release
- [ ] Final gates green (typecheck/lint/test/web:build/safety:scan/cargo/bench).
- [ ] Written human sign-off for any expansion beyond the tiny canary.
- [ ] Tag the release; publish the runbook.

## Explicitly OUT of scope for Part 3 (unless separately authorized in writing)
- Backend private-key custody, backend signing, or backend sending — **never**.
- Autonomous mainnet trading without a human Phantom confirmation — **never**.
- Larger-than-canary sizes without an explicit, separately-reviewed escalation authorization.
