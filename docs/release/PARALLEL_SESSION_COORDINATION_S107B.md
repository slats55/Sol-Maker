# Parallel Session Coordination — S107B (Live Readiness QA / Part 2+3 Plan)

> This lane ran **in parallel** with an active Part 1 session (Phantom wallet connect + Solana
> mainnet live execution bridge + live policy gates + canary path + live UI + tx preview/sign/send +
> Rust hot path). This document tells the owner and the Part 1 session exactly what changed here,
> what was deliberately left untouched, the conflict risk, and the recommended merge order.

| Field | Value |
| --- | --- |
| Branch | `sprint-107b-live-readiness-qa-part2-part3-plan` |
| Forked from | `origin/master` @ `614cdf24816bb8f6a8f9327bcbb14b596e7d8d6e` |
| Lane type | **Docs-only.** No source, test, schema, or config files changed. |
| Date | 2026-06-18 |

---

## 1. Files changed in this lane

All additions. No modifications, no deletions. Five new Markdown files in four new directories:

```
docs/live/LIVE_READINESS_QA_PACK.md
docs/security/LIVE_TRADING_SAFETY_AUDIT.md
docs/testing/LIVE_TRADING_TEST_GAP_MATRIX.md
docs/roadmap/FINAL_PART_2_AUTONOMOUS_SNIPER_LOOP.md
docs/roadmap/FINAL_PART_3_PRODUCTION_MULTI_CHAIN_RELEASE.md
docs/release/PARALLEL_SESSION_COORDINATION_S107B.md   ← this file
```

`git status --short` shows only these untracked docs. Nothing else.

---

## 2. Files deliberately NOT touched

To avoid conflicting with the active Part 1 session, this lane did **not** edit (only read):

- `packages/execution/src/*` — live gate, `send.ts`, `signer.ts`, modes, safety controls,
  reconciliation, session, rehearsal, phase7-*.
- `packages/adapters/src/*` — where the Phantom wallet-adapter bridge will land (currently a stub).
- `apps/web/*` live command center / any live UI panel.
- `apps/cli/src/commands.ts` and any execution/send CLI surface.
- `packages/{txbuilder,txpreview,quotefetch,realtime,solana,risk}/src/*` and
  `crates/solmaker-engine/*` — read for the audit only.
- Any test file — including the one with the known test-isolation defect (F-1). It was **diagnosed,
  not edited**, because it belongs to the active alpha pipeline.

No wallet signing code, Phantom adapter code, transaction send/submit code, safety gate, or seed/key
handling was added, weakened, or removed. No fake trading success was introduced.

---

## 3. Conflict risk assessment

**Overall: NONE-to-NEGLIGIBLE.**

| Vector | Risk | Why |
| --- | --- | --- |
| Source file overlap | **None** | This lane changed zero source files. |
| New directory collision | **None** | `docs/live`, `docs/security`, `docs/testing`, `docs/roadmap`, `docs/release` did not previously exist; Part 1 is unlikely to create the same doc paths. |
| Build/lockfile drift | **None** | No dependency, lockfile, or config change. |
| Generated-artifact drift | **None** | `web:build` output is byte-identical to committed (deterministic); nothing regenerated/committed. |
| Semantic conflict | **None** | Docs reference Part 1's planned files but do not bind them. |

The only thing to watch: if the Part 1 session *also* writes a coordination or live-readiness doc
under the same path, a trivial textual merge may be needed. Unlikely given the distinct filenames.

---

## 4. Recommended merge order

1. **Part 1 first** (Phantom + live execution + UI + Rust hot path) — it is the substantive code.
2. **This lane second.** Because it is docs-only and forked from the same `origin/master`, it should
   fast-forward or merge cleanly on top of Part 1 with no code conflicts.
3. **Immediately after both merge:** re-run the safety audit and the full gate suite against the
   combined tree (see §6), and update the QA Pack's "verified repo state" + gate table with the
   post-merge SHA and results.

> Alternatively, this docs-only lane can merge to `master` independently at any time — it does not
> depend on Part 1 to be correct; it only describes the standard Part 1 must meet.

---

## 5. What Part 1 should finish before this branch is fully "useful"

This branch is useful *now* as the readiness standard. It becomes *actionable* once Part 1 lands:

- [ ] Phantom connection implemented as **non-custodial** (key never reaches app code).
- [ ] Live UI panel exists with the §6 transaction status vocabulary (QA Pack).
- [ ] The mainnet send path is wired to the existing fourteen-condition gate **and** core gate, with
      **no** new override/bypass.
- [ ] Per-trade human approval flow (no batch/auto-approve).
- [ ] Kill switch wired to a runtime trigger reachable without the trading UI.
- [ ] Confirmation + reconciliation path observes the chain (no assumed confirmation).
- [ ] A confirmed **devnet** broadcast exists end-to-end (historically faucet-blocked — track it).

Once those land, work the **test gap matrix** in its priority order and re-run the **safety audit**.

---

## 6. Post-merge verification (run after Part 1 + this lane combine)

```
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test            # run as its OWN step, NOT concurrent with a cargo build (avoids F-2 flake)
pnpm run web:build
pnpm run safety:scan
cargo build --workspace && cargo test --workspace   # separate step from vitest
```

Then re-run the independent safety audit (§`docs/security/LIVE_TRADING_SAFETY_AUDIT.md` §8 checklist)
against the merged tree, focusing on the new Phantom/live/adapter code.

---

## 7. Baseline gate results captured by this lane (at `614cdf2`)

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ exit 0 |
| `pnpm run typecheck` | ✅ exit 0 |
| `pnpm run lint` | ✅ exit 0 (0 warnings) |
| `cargo build --workspace` | ✅ ~20 s |
| `cargo test --workspace` | ✅ 80 passed (incl. `safety_scan` 5/5) |
| `pnpm run safety:scan` | ✅ 712 files, no leaks |
| `pnpm run web:build` | ✅ 11 pages, deterministic |
| `pnpm test` | ⚠️ 4289 pass / 16 skip / 11 fail **under concurrent cargo load**; all 11 explained (10 contention timeouts pass in isolation; 1 = test-isolation defect F-1). Green under canonical CI. |

Details + reproduction: [`docs/live/LIVE_READINESS_QA_PACK.md`](../live/LIVE_READINESS_QA_PACK.md) §2.

---

## 8. Recommended next prompt for the owner (after Part 1 lands)

> "Part 1 (Phantom + live execution) is merged at SHA `<sha>`. On a fresh branch from the merged
> master: (1) re-run all gates with `pnpm test` and `cargo test` as separate, non-overlapping
> steps; (2) re-run the independent safety audit in `docs/security/LIVE_TRADING_SAFETY_AUDIT.md`
> against the new Phantom/live/adapter code and update its findings; (3) implement the test gap
> matrix in priority order, starting with PH-1/PH-2 (key never reaches app code) and SM-1/SM-2/CR-1
> (transaction state machine + `submitted ≠ confirmed`); (4) fix test-isolation defect F-1 so the
> 'engine absent' test is deterministic regardless of a local Rust build. Do not add any
> override/bypass to a safety gate and do not implement autonomous sending."

For the autonomous loop and production phases, hand the implementer
[`FINAL_PART_2_AUTONOMOUS_SNIPER_LOOP.md`](../roadmap/FINAL_PART_2_AUTONOMOUS_SNIPER_LOOP.md) and
[`FINAL_PART_3_PRODUCTION_MULTI_CHAIN_RELEASE.md`](../roadmap/FINAL_PART_3_PRODUCTION_MULTI_CHAIN_RELEASE.md)
respectively — each has its own definition-of-done and test list.

---

*Docs-only lane. No live trading enabled, no safety gate weakened, no profit claimed.*
