# Final Live Release Dossier — Part 3 of 3 (Sprint 109)

Branch: `sprint-109-final-live-part3-production-canary-operator-release`
(stacked on Part 2 `sprint-108-final-live-part2-autonomous-sniper-rc` @ `f58cd0f`, which stacks on
Part 1 `sprint-107-final-live-part1-phantom-execution-rc` @ `5a65141`; master untouched at `614cdf2`).

This dossier is the honest, machine-backed statement of what the final live build **is**, what it
**guarantees**, what it **cannot do**, and what remains. Its companion artifact is
[`examples/live/part3/ready-for-human-canary.report.json`](../examples/live/part3/ready-for-human-canary.report.json)
(`live.operator.human_canary_readiness.v1`) — a validated report whose workflow checks are DERIVED
from real artifacts, not asserted.

## Honest status, up front

**A real canary trade has NOT been executed.** No human operator with a funded burner Phantom
wallet was present in this automated session, and this build refuses to fake what did not happen:
the readiness artifact pins `realCanaryExecuted: false` with the reason, and its validator REFUSES
a report that claims execution without settled, signed reconciliation evidence. The verdict is
**`ready-for-human-canary`**: every pre-human step of the workflow is built, tested, and proven on
fixtures + prior-sprint real mainnet evidence. The only missing ingredients are the human, the
funded burner, and their Phantom click — by design, those cannot be automated away.

## Current capabilities (Parts 1+2+3 together)

| Capability | Status |
| --- | --- |
| discover real candidates (real `@soulmaker/realtime` feeds / manual mints) | yes (Part 2) |
| risk-check with real mainnet reads (`token:risk`, incl. deep + Token-2022) | yes (S92/S93) |
| score + paper-shadow candidates | yes (Part 2) |
| validate a production operator config (fail-closed, secret-refusing) | **yes (Part 3)** |
| durable append-only session journal (pause/re-arm survive restarts) | **yes (Part 3)** |
| supervised recommend-only operator runs (off/observe_only/paper_shadow/armed_canary) | **yes (Part 3)** |
| recommend ONE tiny canary when armed + every gate green | yes (Part 2, hardened Part 3) |
| prepare the UNSIGNED Phantom request | yes (Part 1, `live:canary:prepare`) |
| human signs + submits in Phantom (browser live console) | yes (Part 1; human-only) |
| post-canary reconciliation + PnL accounting (honest unknowns) | **yes (Part 3, `live:operator:reconcile`)** |
| operator dashboard (mode/safety/feed/risk/canary/Phantom/positions/PnL/timeline) | **yes (Part 3, read-only)** |
| local alert hooks (console + webhook-file; disabled by default) | **yes (Part 3)** |
| **real canary trade executed** | **no — see above** |
| autonomous trading / backend sending / key custody | **no — structurally refused, tested** |

## Exact safety guarantees (all enforced in code and tested)

1. **No key custody.** No seed phrase / private key input exists anywhere. Every Part 3 validator
   deep-scans for sensitive-named keys AND secret-shaped values (long base58/hex) and refuses the
   whole document (`operator-config`, journal events, alerts, reconciliation inputs).
2. **No backend send.** The Part 3 modules import no network, wallet, or signing capability —
   pinned by a source-level scan in `part3-safety-regression.test.ts`. The whole-CLI
   `command-surface-audit.test.ts` still proves the only send-named command is the devnet-scoped
   `execution:devnet:send`.
3. **Phantom/human approval required.** `phantomApprovalRequired: true` is a pinned literal a
   config cannot alter; the loop's strongest output is a recommendation whose next steps hand off
   to the human console flow.
4. **Live disabled by default.** Default operator mode is `off`; a run may only NARROW the
   configured mode; `armed_canary` additionally requires the journal, an explicit per-invocation
   arm, and a green Part 1 policy + Part 2 escalation evaluation.
5. **`largeTradesEnabled: false` stays pinned.** Tampering the literal fails validation; every cap
   is clamped to the same hard ceilings as Parts 1–2 (canary ≤ 0.05 SOL absolute), and caps only
   tighten.
6. **Kill switch / emergency stop block everything.** Engaged switches zero out EVERY mode —
   including observe — and force a pause that requires an explicit, journaled manual re-arm
   (tested per mode).
7. **No fake accounting.** Reconciliation derives every number from supplied evidence or reports
   `null`/`unknown`; a price requires evidence; confidence and PnL status are RE-DERIVED by the
   validator, so a tampered artifact refuses. `notProfitabilityClaim: true` everywhere.
8. **Tamper-evident journal.** Append-only with strict sequence numbers, closed after session end,
   refuses secrets; unparseable lines are counted, never hidden.
9. **No new safety-scan exemptions.** The Part 1/2 allowlist is unchanged; committed examples use
   short signature fixtures and prefix references (the slot is the durable identifier).
10. **Alerts cannot leak.** Sinks are local-only (console/file), disabled by default, and every
    payload passes the same secret scan; network forwarding is deliberately out of scope.

## Exact limitations

- **No real canary has been broadcast by this build** (see honest status). All full-evidence
  reconciliation examples are labelled fixtures.
- The supervised run is **one bounded pass per invocation** (repeat it, same journal, for a longer
  session; `--max-candidates` / `--max-runtime-ms` bound each pass). There is no resident daemon.
- PnL is accounting, not strategy feedback: no position sizing, no exit strategy, no
  profitability evidence of any kind.
- Candidate quality depends on the supplied feed/risk/quote artifacts; a manual mint without
  liquidity evidence can never reach a recommendation (fail-closed, tested).
- Multi-chain remains honestly `not_implemented` stubs (Part 1 unchanged).
- The checklist items Part 2 left for "production packaging / cloud deploy / signed release tags /
  strategy feedback loop" remain OPEN — see *Remaining work* below.

## Test & gate results (this branch, this machine)

Baseline (Part 2 @ `f58cd0f`, before Part 3 changes): typecheck ✓ · lint ✓ (0 warnings) ·
**4501 passed | 16 skipped** (295 files) · web:build ✓ (11 pages + console + sniper dashboard) ·
safety:scan ✓ (781 files) · cargo build ✓ · cargo test ✓ (80) · bench:live ✓.

Final (Part 3 complete): typecheck ✓ · lint ✓ (0 warnings) ·
**4668 passed | 2 skipped** (305 files; skips dropped 16→2 because the cargo-built engine binary
un-skipped the engine-bridge e2e suite) · web:build ✓ (11 pages + console + sniper dashboard +
**operator dashboard**) · safety:scan ✓ (815 tracked files; allowlist unchanged) · cargo build ✓ ·
cargo test ✓ (80) · bench:live ✓. CLI smokes for all six `live:operator:*` commands: ✓ — including
the durable-cap proof (a second armed run on the same journal is blocked by
`session-canary-cap-reached` + `cooldown-active`) and an honest no-trade reconciliation
(`confidence: none`, PnL `unknown`). The armed smoke reproduced the Part 2 headline invariant
through the Part 3 surface: USDC with its REAL mainnet freeze-authority risk report was refused
even in armed mode with a real quote; only the clean fixture candidate was recommended.

New Part 3 surface: 6 modules in `@soulmaker/live` (operator-config, session-recorder,
operator-reconcile, operator-loop, alerts, human-readiness), 6 CLI commands, 1 dashboard page,
7 schemas (`live.operator.config.v1`, `.config.validation.v1`, `.session.event.v1`,
`.session.summary.v1` / `.session.export.v1`, `.run.report.v1`, `.reconciliation.v1`, `.alert.v1`,
`.human_canary_readiness.v1`), 11 committed deterministic examples with a pin suite, and a
Part 3 safety-regression suite.

## Known risks

- **Market risk is total.** A canary can go to zero; fees are spent even on failure. The caps make
  the loss tiny, not impossible.
- **Operator-supplied artifacts are trust inputs.** A wrong risk/quote file degrades decisions —
  the loop fails closed on missing data but cannot detect a *falsified* file; the runbook keeps a
  human review in the loop.
- **The browser + Phantom remain the human trust boundary** (Part 1 threat model unchanged):
  verify mint/amount/slippage in the Phantom popup itself, not only in any UI.
- **RPC endpoints are operator-configured**; a malicious RPC can lie about balances/status.
  Reconciliation confidence marks what was actually evidenced.
- **The journal is local**: deleting the file resets session caps. It is tamper-evident, not
  tamper-proof; the operator is trusted not to defeat their own safety rails (daily caps also
  bind independently via config).

## Remaining work after Part 3

1. The **human canary itself** — a human with a funded burner executes the runbook end-to-end and
   files the reconciliation + session export as evidence (flips the readiness artifact to
   `canary-executed-and-reconciled`).
2. Production packaging: versioned reproducible artifact, dependency pinning/audit, signed release
   tag (checklist §1), documented deploy (§5).
3. A resident supervised daemon (long-running watch with backpressure) if operators want more than
   repeated bounded passes (§2).
4. Strategy feedback loop + shadow-session backtesting (§6); PnL-aware exits and any position
   scaling — each **only** with separate written authorization (§10).
5. External security review of the live surface + console threat model (§9).
6. Multi-chain adapters remain stubs unless separately prioritized (§8).

## Statement of non-claims

This build makes **no profitability claim**, **no performance claim** beyond the measured
latencies in `examples/live/part2-sniper-latency-report.json`, and **no claim that a real trade
occurred**. Every artifact that could be mistaken for a trade result carries pinned honesty
literals and validators that refuse fabricated verdicts.
