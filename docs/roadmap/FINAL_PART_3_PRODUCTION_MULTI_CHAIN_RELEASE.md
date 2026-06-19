# Final Build — Part 3 of 3: Production Hardening & Multi-Chain Release Planning

> **Build plan / checklist only. Not implemented in this lane.** Part 3 turns the manually-armed
> Solana sniper (Parts 1 + 2) into an operable, observable, recoverable production system, and
> *plans* a multi-chain boundary without claiming multi-chain trading is done.

| Field | Value |
| --- | --- |
| Depends on | Part 1 (live execution) + Part 2 (autonomous loop) merged and audited |
| Base SHA (plan written against) | `614cdf2` |
| Real trading target | **Solana only.** Other chains are **adapter-planned**, not implemented. |
| Safety stance | Hardening must not weaken any gate; manual-arm + per-trade approval remain. |

---

## 0. Truth-in-labeling for Part 3

- **Solana is the only chain that trades.** Any multi-chain content here is *architecture and
  adapter planning*. Do not ship a UI/CLI affordance that implies another chain can trade until a
  real, audited adapter exists and is separately authorized.
- Production hardening **adds** operability (deploy, alerting, monitoring, backup, incident
  response). It does not add autonomy beyond what Part 2's manual-arm model allows.
- Profit is never claimed or guaranteed.

---

## 1. Production hardening

- **Config hardening:** one validated config schema; fail-closed on missing/invalid; secrets only
  via env-var NAMEs pointing at paths (never inline). No new secret-bearing tracked file.
- **Process safety:** the loop and any long-running watcher are bounded, restartable, and idempotent
  on restart; no duplicate sends possible across a restart (reconciliation wall enforces this).
- **Resource limits:** memory/CPU caps; bounded queues; backpressure; graceful shutdown that
  reconciles in-flight state.
- **Determinism:** keep the byte-deterministic artifact/build property (already true for `web:build`)
  so artifacts are diff-able across runs.
- **Dependency discipline:** keep the Rust dependency allowlist (`serde`/`serde_json` only) and the
  TS forbidden-token nets; no new network/signer capability sneaks into a "utility" package.

## 2. Operator deployment

- **Modes:** `local` (operator workstation, default) and `cloud` (a hardened headless host).
- **Cloud caveats:** headless runs must still require a human for arming/approval — document that
  interactively-authenticated surfaces (and Phantom) are **not** available headless, so headless
  mode is **observe/paper/shadow only** unless a separately-authorized signing host is designed.
- **Runbook:** extend `docs/SNIPER_RUNBOOK.md` with deploy, start/stop, health, kill, and recovery
  procedures for both modes.
- **Least privilege:** the deploy account holds no keys; the signer host (if any) is isolated.

## 3. Alerting

- Alert channels (operator choice): desktop/log/webhook. Events: kill-switch activation, provider
  all-down, gate armed/disarmed, send submitted, send failed, reconciliation mismatch, loss-cap
  hit, unexpected restart.
- Alerts carry **redacted** payloads only (never a key/signature secret).
- Alert delivery failure is itself an alert-worthy condition (degrade to local log).

## 4. Reconciliation (production)

- Extend the existing reconciliation wall to a scheduled reconciliation sweep: every armed/submitted
  attempt must reach a terminal, chain-verified state.
- Unreconciled state BLOCKS new arming (already enforced for sessions) — extend across restarts.
- Reconciliation artifacts feed PnL accounting (§5).

## 5. Portfolio / PnL accounting

- **Inputs:** confirmed/finalized fills (from reconciliation), fees, and on-chain balances —
  **observed, never assumed**.
- **Outputs:** a PnL/portfolio artifact (`portfolio.pnl.report.v1`, proposed) with realized/
  unrealized split, per-token and per-session rollups, and explicit "unknown" where data is missing.
- **Honesty:** no projected/guaranteed returns; losses shown plainly; paper PnL clearly separated
  from live PnL.

## 6. Strategy feedback loop

- **Paper/live comparison:** compare shadow-mode (paper) decisions against the live outcomes that a
  human approved — divergence is a signal, not an auto-tuning trigger.
- **Scoring improvement:** feed reconciled outcomes back into the scoring model as *offline
  analysis* (a report + proposed weight changes), reviewed by a human before any change ships.
- **No auto-tuning of live parameters** without human review and a recorded decision.

## 7. Long-running process safety

- Heartbeats + watchdog; a stuck loop self-halts and alerts rather than silently continuing.
- Clock/timezone correctness for age caps (quote freshness) — fail-closed if the clock is suspect.
- Log rotation; bounded `runs/` growth; journaled state is replay-safe.
- A crash never leaves the gate "armed" — arming has a TTL and does not survive an unclean restart.

## 8. Cloud / local deployment modes

| Mode | Trading | Notes |
| --- | --- | --- |
| `local` | manual-arm + Phantom approval | full feature set; the canonical live mode |
| `cloud-observe` | none | discovery/scoring/watch/shadow only; no signer, no Phantom |
| `cloud-signing` (design-only) | **out of scope** until separately designed + audited + authorized | a hardened signing host is a major security decision, not a config flag |

## 9. Multi-chain architecture boundary (adapter-planned)

- Define a **narrow chain-adapter interface** so chain-specific code (RPC, quote/route, tx build,
  sign request, confirm/reconcile) sits behind one boundary, with Solana as the only concrete
  implementation.
- The interface must make the safety invariants chain-agnostic: default-blocked live gate,
  no-seed-phrase signer boundary, refusal-first send, observed confirmation, reconciliation wall.
- **Do not** add a second concrete adapter in Part 3. Ship the interface + the Solana adapter +
  a documented "what a new chain adapter must prove" checklist.

### 9.1 Chain adapters (planning)
- Each future adapter is individually audited and documented before use (the `@soulmaker/adapters`
  header already commits to this); none is vendored from a reference repo without a recorded
  license + security review.
- A new adapter must re-pass the full safety audit and the live test gap matrix for its chain
  before any of its trading surface is exposed.

## 10. Security review (production)

- Re-run [`LIVE_TRADING_SAFETY_AUDIT`](../security/LIVE_TRADING_SAFETY_AUDIT.md) against the merged
  Parts 1+2 and again before any production deploy.
- Threat-model the deployment: host compromise, RPC MITM, malicious token metadata, provider
  poisoning, log exfiltration, dependency supply chain.
- Verify no new path logs secrets; redaction covers all new artifacts/alerts; `safety:scan` clean.
- External review recommended before real funds scale beyond the canary.

## 11. Final release checklist

- [ ] All Part 1 + Part 2 + Part 3 tests pass; full gates green; `safety:scan` clean.
- [ ] Safety audit re-run with no HIGH/CRITICAL findings.
- [ ] Confirmed devnet broadcast + confirmed canary mainnet trade reconciled.
- [ ] Written human sign-off for the production scope (size/token/mode caps).
- [ ] Kill switch, alerting, monitoring, backup/restore, and runbook verified.
- [ ] Rollback plan documented and tested.
- [ ] No override/bypass exists anywhere; manual-arm + per-trade approval intact.

## 12. Backup / restore

- Back up: config (without secrets), session ledgers, reconciliation + PnL artifacts, watchlists.
- **Never** back up keys via the app; keypair files stay in their gitignored, operator-managed
  location and are backed up out-of-band by the operator.
- Restore is replay-safe: restoring state never re-sends a settled trade (reconciliation gate).
- Periodic restore drill documented in the runbook.

## 13. Incident response

- Severity ladder (e.g. SEV1 = funds at risk / unexpected send, SEV2 = trading blocked, SEV3 =
  degraded). Map to the `engineering:incident-response` workflow.
- Immediate actions: kill switch → disarm → reconcile → preserve artifacts → assess.
- Blameless postmortem template; track action items into the test gap matrix / hardening backlog.

## 14. Monitoring dashboard

- Real-time: kill-switch state, gate state, provider health, loop latency, watchlist size, open/
  unreconciled sessions, last submitted/confirmed/finalized.
- Alerts surfaced inline; honest empty/unknown/timing-unavailable states.
- Read-only; the dashboard cannot arm or send.

## 15. Future Axiom Pro companion workflow (optional)

- Treat Axiom Pro as a **UX/benchmark reference only** (consistent with the existing competitive
  reference doc). A companion workflow would *compare* Sol Maker's discovery/scoring against an
  Axiom-style surface — observational, not a trading integration.
- Do not integrate any third-party surface that would custody keys or send on the user's behalf.

---

## 16. Expected artifacts (Part 3)

| Artifact | Schema (proposed) | Notes |
| --- | --- | --- |
| PnL / portfolio | `portfolio.pnl.report.v1` | observed fills/fees; realized/unrealized; "unknown" honest |
| Paper/live comparison | `strategy.paper_live.compare.v1` | divergence report; human-reviewed |
| Reconciliation sweep | reuse `execution.reconciliation.report.v1` | scheduled, cross-restart |
| Monitoring snapshot | `ops.monitor.snapshot.v1` | read-only dashboard state |
| Incident record | `ops.incident.record.v1` | severity, timeline, postmortem link |
| Chain-adapter capability | `chain.adapter.capability.v1` | what an adapter implements/proves (Solana = only concrete) |

---

## 17. Definition of done (Part 3)

- [ ] System is deployable in `local` and `cloud-observe` modes with a verified runbook.
- [ ] Alerting, monitoring, backup/restore, and incident response are implemented and drilled.
- [ ] PnL accounting is honest and reconciled; paper and live PnL are clearly separated.
- [ ] Strategy feedback is offline + human-reviewed; no auto-tuning of live params.
- [ ] The chain-adapter interface exists with Solana as the only concrete implementation, plus a
      "new adapter must prove" checklist.
- [ ] Final release checklist (§11) complete; safety audit clean; sign-off recorded.

*Solana is the real trading target. Multi-chain is adapter-planned, not implemented. Profit is
never claimed or guaranteed.*
