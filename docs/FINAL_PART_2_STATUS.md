# Final Live Build — Part 2 Status (Sprint 108)

Branch: `sprint-108-final-live-part2-autonomous-sniper-rc` (stacked on Part 1
`sprint-107-final-live-part1-phantom-execution-rc`, commit `5a65141`).

Part 2 turns the Part 1 Phantom-signing bridge into an **operator-controlled, armed sniper loop**
that discovers real candidates, scores them, paper-shadows them, and — only when explicitly armed and
every gate is green — **recommends** preparing one tiny canary. It never signs, sends, or trades. The
human is the only signer, in Phantom.

## What Part 2 added (`@soulmaker/live`)

| Module | Schema | Purpose |
| --- | --- | --- |
| `discovery.ts` | `live.sniper.candidate.v1` | normalize real feed observations / manual mints → typed candidates; fail-closed; dedupe; provenance required |
| `strategy.ts` | `live.strategy.score.v2` | transparent scoring; hard risk block overrides score; confidence; risk appetite |
| `escalation.ts` | `live.escalation.policy.v1` | canary caps / cooldown / auto-pause / manual re-arm; large trades disabled |
| `sniper-loop.ts` | `live.sniper.loop.v1` | the mode machine (off/observe_only/paper_shadow/armed_canary/paused/killed) + pure per-candidate pipeline |
| `paper-shadow.ts` | `live.paper_shadow.session.v1` | would-enter/would-skip simulation + session report |
| `quote-refresh.ts` | `live.quote_refresh.state.v1` | TTL + provider redundancy + fail-closed + latency |
| `canary-reconcile.ts` | `live.canary.reconciliation.v1` | honest accounting; PnL unknown unless computable |

CLI (all read-only, none send): `live:sniper:policy`, `live:sniper:discover`, `live:sniper:shadow`,
`live:sniper:run`, `live:sniper:reconcile`, `live:sniper:session`.

UI: `apps/web/public/sniper-dashboard.html` — a read-only operator dashboard (modes, kill switch,
discovery, watchlist, candidate detail, paper shadow, escalation). It carries **no** wallet code;
signing stays in the Part 1 live console.

## Live capability — exact statuses

| Capability | Status |
| --- | --- |
| discover real candidates | **yes** (real `@soulmaker/realtime` snapshots or manual mints) |
| run observe_only | **yes** |
| run paper_shadow | **yes** |
| prepare live canary (unsigned) | **yes** (via `live:canary:prepare`, Part 1) |
| arm live canary | **yes** (armed_canary mode + explicit escalation arm) |
| request Phantom signature | **yes** (in the live console; human-initiated) |
| submit via Phantom | **yes** (Phantom submits; backend never does) |
| confirm / finalize | **yes** (console polls a public RPC) |
| reconcile | **yes** (`live:sniper:reconcile`) |
| **actual real canary trade performed** | **no** — see below |

**Actual real canary trade performed: no.** A real mainnet trade requires a funded burner wallet and
a human clicking Approve in Phantom. That human step was not performed in this automated session — no
Phantom, no funded wallet, no human at the keyboard. **This was not faked.** All pre-human steps are
proven with real data (below); the only missing step is the human Phantom confirmation.

## Real-data evidence (no fake data)

Captured live against Solana mainnet during this sprint (committed under
`examples/live/part2/real-evidence/`):

- **Real risk (read-only mainnet):**
  - WSOL (`So111…112`): score **35 / CAUTION**, freeze authority **renounced**, mint authority **renounced**.
  - USDC (`EPjF…Dt1v`): score **100 / REJECT**, **freeze-authority-present** (real honeypot vector).
- **Real Jupiter quote** (0.005 WSOL → USDC): observed `347306` raw USDC out, route `GoonFi V2 > AlphaQ`,
  50 bps slippage, price impact 0% — a real `routequote.observation.input.v1`.
- **Real armed-canary run over USDC:** with the loop in `armed_canary` mode, manually armed, and a fresh
  real quote, the loop **correctly IGNORED** USDC (`risk-rejected`), **0 canary recommended**. The real
  freeze authority blocked it. See `real-evidence/run-report.real-usdc-reject.json`.

This is the point: the gates hold on **real** mainnet data. A real risk flag stops a real candidate even
in armed mode with a fresh real quote.

## Performance (real, this machine)

From `pnpm bench:live` (`examples/live/part2-sniper-latency-report.json`):

- candidate-score: **~0.001 ms** median
- policy build+eval: **~0.002 ms** median
- canary-request build: **~0.037 ms** median
- Rust engine spawn (one-off): **~10.5 ms** median

Decision: the loop keeps every per-candidate decision in **TypeScript** (sub-millisecond). Rust's
~10.5 ms per-spawn cost dominates any single tiny decision, so it is **not** called per-candidate. The
Rust sidecar remains available for batch/heavy work; the TS path is the safe default.

## Safety guarantees (unchanged from Part 1, extended)

- No seed phrase / private key input anywhere. No backend key custody. No backend send surface.
- Every real transaction requires a human Phantom confirmation. The human is the only signer.
- Live disabled by default; loop default mode `off`; `loopModeCanTrade` is `false` for **every** mode.
- Kill switch + emergency stop block all live actions. Escalation caps + cooldown + auto-pause +
  manual re-arm. Large trades disabled (`largeTradesEnabled: false`, pinned).
- Safety-scan allowlist unchanged from Part 1 (3 example files, base58 rule only). No new exemptions.

## Part 1 review

Reviewed the full Part 1 live surface. **Confirmed safe; no critical issues.** `signAndSendTransaction`
exists only in the browser console; the only `secretKey`/`privateKey` occurrences are negative tests
asserting the validators reject them. Part 2 adds a regression suite
(`part2-safety-regression.test.ts`) proving the loop does not weaken any Part 1 gate: an armed
recommendation, built into a real canary request, is still unsigned, Phantom-required, and never sent.

See `docs/LIVE_SNIPER_CANARY_RUNBOOK.md` for the human canary procedure and
`docs/FINAL_PART_3_PRODUCTION_RELEASE_CHECKLIST.md` for what Part 3 must still do.
