# Live Trading Test Gap Matrix — Sol Maker

> The test roadmap for after **Part 1** (Phantom + live execution) merges. It records what live-path
> coverage **already exists** on `origin/master` and what is **missing** before live trading can be
> trusted. Produced in the parallel QA lane (`sprint-107b-live-readiness-qa-part2-part3-plan`,
> base SHA `614cdf2`). No test or source files were edited in this lane.

Legend: ✅ present · 🟡 partial · ❌ missing · 🔒 blocked on Part 1 code existing first.

Measured baseline at base SHA: vitest `4316` tests (4289 pass / 16 skip under load; see
[QA Pack §2](../live/LIVE_READINESS_QA_PACK.md) for the explained failures) · Rust `80` tests
(incl. `tests/safety_scan.rs` 5/5).

---

## 1. Coverage that already exists (by area)

| Area | Key test files (on master) | Coverage |
| --- | --- | --- |
| Mainnet live gate (14 conditions) | `packages/execution/src/live-gate.test.ts` | ✅ each condition; default-blocked |
| Send path refusals | `packages/execution/src/execution.test.ts` | ✅ mode wall, gate re-verify, safety controls, envelope/network mismatch, signer missing, mock send |
| Signer boundary | `packages/execution/src/execution.test.ts`, `package-safety.test.ts` | ✅ no-seed, redaction marker, devnet-first, frozen object |
| Reconciliation | `packages/execution/src/reconciliation.test.ts` | ✅ verdict set; unreconciled-session wall |
| Session ledger | `packages/execution/src/session.test.ts` | ✅ ledger lifecycle |
| Devnet rehearsal / funding | `rehearsal.test.ts`, `devnet-funding-status.test.ts` | ✅ funding re-derived from observed lamports |
| Phase 7 authorization | `phase7-authorization-audit.test.ts`, `-redteam.test.ts`, `phase7-human-signoff.test.ts`, `phase7-microtrade-preflight.test.ts` | ✅ verdict re-derivation, red-team, sign-off record |
| Quote freshness | `quote-freshness.test.ts`, `quote-freshness-wiring.test.ts` | ✅ fresh/stale/missing → verdict |
| Risk / anti-rug | `risk-score.test.ts`, `risk-report.test.ts`, `risk-flags.test.ts`, `token2022-flags.test.ts`, `deep-flags.test.ts` | ✅ scoring, hard flags, Token-2022 |
| Kill switch (spec) | `kill-switch-spec.test.ts`, `kill-switch-spec-safety.test.ts` | 🟡 **spec only** — not wired to a live UI/runtime trigger |
| Rust/TS parity | `packages/engine-bridge/src/*.test.ts` (8 files) | ✅ status/realtime/quote-score/sim-classify/tx-inspect/sniper-score parity |
| Package safety nets | `*-safety.test.ts`, `no-forbidden-imports.test.ts` across all packages | ✅ forbidden capability tokens absent from prod source |
| Web typed views | `apps/web/tests/*.test.ts` (28 files) | ✅ artifact rendering, no-send assertions |

**Takeaway:** the *gated, paper/dry-run/devnet* surface is well covered. The gaps below are almost
all in the **live mainnet + Phantom + autonomous** surface that does not exist yet.

---

## 2. Gap matrix (missing coverage before live can be trusted)

### 2.1 Live policy / gate

| ID | Test needed | Status | Notes |
| --- | --- | --- | --- |
| LP-1 | Mainnet gate AND core gate are BOTH required (CLI refuses if either fails) | ❌ | live-gate.test.ts covers the 14-gate alone; the *combination* requirement needs an integration test |
| LP-2 | No override / `--force` / bypass can arm the gate (property test over flags + env) | 🟡 | strengthen: assert no env/flag combination short-circuits a FAILED condition |
| LP-3 | Stale armed-gate at submit time refuses (gate re-verified in `send.ts`) | 🟡 | present for mode/missing; add explicit "armed then mutated to partial → refused" |
| LP-4 | Unknown kill-switch state → gate BLOCKED (condition #8) | 🟡 | add the explicit "unknown ≠ clear" case at the gate level |

### 2.2 Phantom UI 🔒 (blocked on Part 1)

| ID | Test needed | Status |
| --- | --- | --- |
| PH-1 | Private key never reaches app code (frontend or backend) — connection yields only a public key + a sign request | ❌ 🔒 |
| PH-2 | No seed/private-key import affordance exists in the UI | ❌ 🔒 |
| PH-3 | User-rejection path recorded as `user rejected`, never retried silently | ❌ 🔒 |
| PH-4 | Network mismatch (Phantom on devnet while arming mainnet) refuses | ❌ 🔒 |
| PH-5 | Per-trade approval only — no batch/auto/pre-approve | ❌ 🔒 |
| PH-6 | Preview shown to the user matches the exact bytes sent to the wallet | ❌ 🔒 |
| PH-7 | Disconnect / revoke clears session arming | ❌ 🔒 |

### 2.3 Transaction state machine

| ID | Test needed | Status | Notes |
| --- | --- | --- | --- |
| SM-1 | Every legal transition in [QA Pack §6](../live/LIVE_READINESS_QA_PACK.md#6-real-transaction-status-vocabulary) | ❌ | no unified state machine exists yet |
| SM-2 | Illegal transitions are impossible (`submitted`→`confirmed` without observation; `requested`→`signed` without a wallet response) | ❌ | the most safety-relevant cases |
| SM-3 | `submitted` is never rendered/serialized as success anywhere | 🟡 | `send.ts` carries the caveat; needs a UI + artifact assertion |
| SM-4 | `failed`/ambiguous result forces a reconciliation gate | 🟡 | reconciliation wall exists; tie it to the state machine |

### 2.4 Stale quotes

| ID | Test needed | Status |
| --- | --- | --- |
| SQ-1 | Stale quote → live BLOCKED (gate condition #9) | 🟡 strengthen at the gate/send integration level |
| SQ-2 | Missing/unchecked quote → BLOCKED (not treated as fresh) | 🟡 |
| SQ-3 | Quote that goes stale between simulate and sign → refusal | ❌ |

### 2.5 Risk denial

| ID | Test needed | Status |
| --- | --- | --- |
| RD-1 | A REJECT verdict BLOCKS the live attempt | 🟡 covered for scoring; add at the live-send boundary |
| RD-2 | A hard flag (freeze authority, mint authority, Token-2022 blocker) can never be overridden by a high score | ✅ at scorer; ❌ at live-send boundary |
| RD-3 | Risk score above the explicit cap → gate condition #11 fails | 🟡 |

### 2.6 Kill switch

| ID | Test needed | Status |
| --- | --- | --- |
| KS-1 | Active kill switch → next gate eval BLOCKS and send refuses | ❌ (spec exists; runtime wiring untested) |
| KS-2 | Unknown kill-switch state treated as ACTIVE | ❌ |
| KS-3 | Mid-session kill does not fabricate a result for an in-flight tx; forces reconciliation | ❌ |
| KS-4 | Kill switch reachable without the trading UI | ❌ 🔒 (depends on Part 1 UI/runtime) |

### 2.7 Audit artifacts

| ID | Test needed | Status |
| --- | --- | --- |
| AA-1 | An `execution.attempt.report.v1` is written on BOTH outcomes | 🟡 (covered for refusals; add for submitted) |
| AA-2 | Redaction findings == 0 across all attempt artifacts | 🟡 |
| AA-3 | No signature-shaped value (base58 ≥ 80 chars) embedded; slot recorded instead | ❌ (matches the safety-scan rule; needs an artifact-level test) |
| AA-4 | `phase7LiveTradingReady: false` pinned in every artifact | ✅ |

### 2.8 Rust / TS parity

| ID | Test needed | Status | Notes |
| --- | --- | --- | --- |
| RT-1 | Engine vs TS re-derivation agreement | ✅ (8 bridge test files) |
| RT-2 | **"engine absent" case is deterministic regardless of a local build** | ❌ | **fixes finding F-1**: `sniper-alpha-campaign-command.test.ts:116` must force engine-absent (resolver → non-existent path / empty PATH override) instead of relying on the binary not existing |
| RT-3 | Engine-spawning CLI tests have a timeout that tolerates a cold first spawn | 🟡 | relates to finding F-2 (flake under load) |

### 2.9 Provider failure 🔒 (mostly Part 2)

| ID | Test needed | Status |
| --- | --- | --- |
| PF-1 | RPC/quote provider outage degrades to **refusal**, never a silent or fake send | 🟡 (send refuses on `rpc-unavailable`; add explicit outage test) |
| PF-2 | Provider failover selects a healthy provider and records which was used | ❌ 🔒 (no failover code yet — Part 2) |
| PF-3 | All providers down → BLOCKED, with an honest artifact | ❌ 🔒 |

### 2.10 Confirmation / reconciliation

| ID | Test needed | Status |
| --- | --- | --- |
| CR-1 | `submitted` is never reported as confirmed/landed | 🟡 (caveat present; needs assertion across UI + artifacts) |
| CR-2 | Confirmation is observed (RPC), not assumed | ❌ 🔒 (depends on the confirm path in Part 1) |
| CR-3 | An unreconciled prior session BLOCKS the next attempt | ✅ (reconciliation wall) |
| CR-4 | A dropped/expired tx reconciles to a non-success terminal state | ❌ |

---

## 3. Priority order (after Part 1 merges)

1. **PH-1, PH-2** — prove the key never reaches app code and there is no import UI. Nothing else
   matters if these fail.
2. **SM-1, SM-2, CR-1, CR-2** — the state machine and the `submitted ≠ confirmed` honesty.
3. **KS-1, KS-2, KS-3** — kill switch runtime wiring.
4. **LP-1, LP-2** — both-gates-required and no-bypass property tests.
5. **RD-2 (at live-send), SQ-3** — risk/stale denial at the live boundary.
6. **AA-1, AA-2, AA-3** — artifact + redaction completeness for the submitted path.
7. **RT-2, RT-3** — fix the test-isolation flake (F-1) and timeout flake (F-2).
8. **PF-1, PF-2, PF-3, CR-4** — provider failover and tail reconciliation (overlaps Part 2).

---

## 4. Cross-references

- Failures explained, gate results: [`docs/live/LIVE_READINESS_QA_PACK.md`](../live/LIVE_READINESS_QA_PACK.md)
- Findings F-1 / F-2: [`docs/security/LIVE_TRADING_SAFETY_AUDIT.md`](../security/LIVE_TRADING_SAFETY_AUDIT.md)
- Autonomous-loop test needs: [`docs/roadmap/FINAL_PART_2_AUTONOMOUS_SNIPER_LOOP.md`](../roadmap/FINAL_PART_2_AUTONOMOUS_SNIPER_LOOP.md)
- Production/multi-chain test needs: [`docs/roadmap/FINAL_PART_3_PRODUCTION_MULTI_CHAIN_RELEASE.md`](../roadmap/FINAL_PART_3_PRODUCTION_MULTI_CHAIN_RELEASE.md)
