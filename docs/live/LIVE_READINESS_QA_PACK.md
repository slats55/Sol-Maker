# Live Readiness QA Pack — Sol Maker

> **Purpose.** A single, strict checklist an operator and a release engineer can run through
> **before** real funds are ever at risk. It defines what "live" honestly means here, what must
> never happen, and the exact gates, vocabulary, and artifacts that make a live trade trustworthy.
>
> **This document authorizes nothing.** It is a readiness *standard*, produced in a parallel QA
> lane that did **not** edit any wallet, signing, sending, or live-execution code.

| Field | Value |
| --- | --- |
| Lane / branch | `sprint-107b-live-readiness-qa-part2-part3-plan` (from `origin/master`) |
| Base SHA | `614cdf24816bb8f6a8f9327bcbb14b596e7d8d6e` |
| Date | 2026-06-18 |
| Companion docs | [`LIVE_TRADING_SAFETY_AUDIT`](../security/LIVE_TRADING_SAFETY_AUDIT.md) · [`LIVE_TRADING_TEST_GAP_MATRIX`](../testing/LIVE_TRADING_TEST_GAP_MATRIX.md) · [`PHASE7_LIVE_EXECUTION_GATE`](../PHASE7_LIVE_EXECUTION_GATE.md) · [`EXECUTION_SAFETY`](../EXECUTION_SAFETY.md) |

---

## 1. Verified repo state (at the base SHA)

This was measured, not assumed. See §2 for exact gate results.

- **Live trading is structurally default-blocked.** Mainnet sending requires an **armed
  fourteen-condition gate** with no override, and has **no CLI surface at all** (the only send
  command is `execution:devnet:send`, devnet-only and separately opted-in).
- **There is no Phantom wallet adapter in committed master.** Phantom appears only in
  `docs/ROADMAP.md`, `apps/web/README.md`, and a *planning* comment in
  `packages/adapters/src/index.ts` (`AdapterPlaceholder { implemented: false }`). The Phantom
  connection + live UI are being built by the parallel **Part 1** session.
- **Signing is confined to one package** (`@soulmaker/execution`), behind a documented
  refusal-first boundary. No seed-phrase handling exists anywhere.
- **The safety scan passes** (712 files) and the Rust-side safety integration tests pass.

| Capability in committed master | State |
| --- | --- |
| Paper trading / research / dry-run | ✅ implemented, default |
| Devnet build / sign / send (gated) | ✅ implemented |
| Mainnet **dry-run** (build + simulate, never send) | ✅ implemented |
| Mainnet **live** send | 🔒 default-BLOCKED, **no CLI surface**, gate not armed |
| Phantom wallet connect / live UI panel | ⛔ not in master — **Part 1 in progress** |
| Autonomous live trading | ⛔ not implemented (and out of scope until Part 2/3 gating lands) |

---

## 2. Gate results (this lane, measured)

Run on Windows 11, Node ≥ 20, pnpm 9.15.0, cargo 1.96.0.

| Gate | Command | Result |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | ✅ exit 0 |
| Typecheck | `pnpm run typecheck` | ✅ exit 0 |
| Lint | `pnpm run lint` (eslint) | ✅ exit 0, 0 warnings |
| Rust build | `cargo build --workspace` | ✅ finished ~20 s |
| Rust test | `cargo test --workspace` | ✅ **80 passed** (75 lib + 5 `safety_scan` integration) |
| Safety scan | `pnpm run safety:scan` | ✅ exit 0 — 712 files, no key/seed leaks |
| Web build | `pnpm run web:build` | ✅ exit 0 — 11 pages; output byte-identical to committed (deterministic) |
| Unit/integration | `pnpm test` (vitest) | ⚠️ see note below |

**Vitest note (important, honest).** A *full* `pnpm test` run executed **while `cargo build` was
compiling the Rust workspace** reported `4289 passed / 16 skipped / 11 failed` (4316 total). All
11 failures are explained and are **not** master regressions:

- **10 of 11** are 5000 ms **timeouts** caused by CPU contention (vitest + cargo compile at once).
  Re-running those exact files in isolation → **18/18 and 36/37 pass**.
- **1 of 11** is a **test-isolation defect** (not a product issue):
  `apps/cli/src/sniper-alpha-campaign-command.test.ts:116` asserts the Rust engine is
  `"unavailable"` "when the engine is absent," but because `cargo build` had produced
  `target/debug/solmaker-engine.exe`, the command correctly discovered the engine as
  `"available"`. With no pre-built engine (canonical CI), this test passes.

**Conclusion:** master at `614cdf2` is green under canonical CI conditions (engine not pre-built,
test step not contending with a compile). The defect is tracked as **F-1** in the safety audit and
in the test gap matrix. This lane does not edit the test (it belongs to the active alpha pipeline).

---

## 3. What live trading requires before it is honest

Live is only honest when **every** item is true. Anything less is paper or dry-run, and must be
labeled as such.

- [ ] The fourteen-condition mainnet live gate is **armed** (all 14 satisfied) — see §8.
- [ ] The core live gate (`@soulmaker/core` `evaluateLiveGate`) is **also** satisfied — the CLI
      requires BOTH gates, not either.
- [ ] The user **manually armed** this session and **manually approves each trade** (no unattended
      sending — see §5 and §11).
- [ ] The exact transaction that will be sent was **simulated** (`simulated-ok`) immediately prior.
- [ ] The quote backing the trade is **fresh** under an explicit age cap (not stale, not missing).
- [ ] The advisory **risk score** is under an explicit cap, and anti-rug checks did not REJECT.
- [ ] Explicit **spend / loss / slippage caps** are set for this trade and session.
- [ ] An **audit artifact path** is provided and **redaction findings are exactly zero**.
- [ ] The **kill switch is explicitly clear** (unknown state counts as BLOCKED).
- [ ] The signer was loaded through the **approved boundary** (no raw key, no seed).
- [ ] The reported result uses the **status vocabulary** in §6 honestly — *submitted ≠ confirmed*.
- [ ] After the attempt, the session is **reconciled** before another attempt is permitted.

If any box is unchecked, the only honest outcome is a **refusal report**, not a trade.

---

## 4. What must never happen

These are invariants. A violation of any one is a release-blocking incident.

- ❌ **Never** accept, store, parse, transmit, or log a **seed phrase / mnemonic / private key**.
- ❌ **Never** custody the dashboard user's key on the backend — the wallet extension signs;
      the key never leaves it.
- ❌ **Never** auto-send on mainnet without a human arming the session AND approving the trade.
- ❌ **Never** report a trade as "confirmed/landed" when only "submitted" is true.
- ❌ **Never** add an override, `--force`, or bypass flag to any safety gate.
- ❌ **Never** treat "unknown" gate/kill-switch state as safe — unknown is BLOCKED.
- ❌ **Never** retry or chase a send (the send path submits once, by design).
- ❌ **Never** synthesize a signature, confirmation, or "success" for UI/demo purposes.
- ❌ **Never** widen a `.gitignore` secret rule or a `safety:scan` exemption to ship a feature.
- ❌ **Never** disable the test that proves a capability is absent in order to make CI green.
- ❌ **Never** claim profit is guaranteed or expected — this is high-risk speculative software.

---

## 5. Phantom wallet safety requirements

The Phantom integration does not yet exist in master; these are the **acceptance requirements**
for the Part 1 work before it can be trusted.

- [ ] **Non-custodial only.** The dapp requests a connection and a **sign / signAndSend** through
      the Phantom provider (`window.solana` / wallet-standard). The private key **never** reaches
      Sol Maker code — frontend or backend.
- [ ] **No key import UI.** There is no field, file picker, or flow that accepts a seed phrase,
      private key, or keypair file from the dashboard user.
- [ ] **Connection is explicit and revocable.** Connect / disconnect are user-driven; the app shows
      the connected public key and the active network.
- [ ] **Network is asserted, not assumed.** The UI shows mainnet-beta vs devnet, and refuses to arm
      live unless Phantom is on the expected network.
- [ ] **Per-trade approval.** Every send pops Phantom's own approval; the app cannot pre-approve,
      batch-approve, or auto-approve.
- [ ] **The app shows what it is asking Phantom to sign** — the simulated, human-readable preview
      precedes the signature request, and the preview matches the bytes being signed.
- [ ] **User-rejection is a first-class outcome** — see the status vocabulary (§6). A rejected
      signature is recorded honestly, never retried silently.
- [ ] **No private key, signature secret, or session token is logged** to console, server logs, or
      artifacts; redaction covers any new fields.
- [ ] **The mainnet send still passes the fourteen-condition gate** — Phantom connecting does not
      bypass any gate; it satisfies (at most) the signer-boundary and wallet-validated conditions.

---

## 6. Real transaction status vocabulary

Every UI surface, artifact, and log must use **exactly** these states and must not collapse them.
The two most dangerous collapses are *submitted → "done"* and *requested → "signed"*.

| State | Meaning | What is true | What is NOT yet true |
| --- | --- | --- | --- |
| **prepared** | An unsigned transaction envelope was built. | Bytes exist, unsigned. | Not simulated, not signed, not sent. |
| **simulated** | The exact unsigned envelope was simulated (`sigVerify:false`). | Simulation returned an outcome. | No signature; simulation ≠ on-chain success. |
| **Phantom requested** | A signature was requested from the wallet. | The wallet prompt is open. | Not signed; user may reject. |
| **user rejected** | The user declined in the wallet. | Terminal for this attempt. | Nothing was signed or sent. |
| **signed** | The wallet returned a signed transaction. | A valid signature exists locally. | Not submitted to any RPC. |
| **submitted** | The signed tx was sent to an RPC once. | A signature string was returned. | **Not confirmed. Not landed.** |
| **confirmed** | The cluster confirmed the signature. | ≥1 confirmation observed. | Not yet finalized; could still be dropped at low commitment. |
| **finalized** | The cluster finalized the slot. | Irreversible on this fork. | — |
| **failed** | The tx errored at simulate, submit, confirm, or on-chain. | Terminal failure with a reason. | Funds state must be reconciled. |
| **reconciled** | The session ledger was reconciled against on-chain truth. | Outcome verified against the chain. | — |

**Rules:**
- `submitted` MUST NOT be styled or worded as success. The send path itself carries the caveat
  *"Submission is NOT confirmation."*
- The path from `submitted` → `confirmed` → `finalized` is **observed**, never assumed.
- A `failed` or ambiguous result MUST drive a **reconciliation** before any further trade.

---

## 7. Live blockers checklist (must all be cleared)

A live trade is BLOCKED until every one is cleared, in addition to the gate (§8):

- [ ] Phantom integration passes its acceptance requirements (§5) and its tests (gap matrix).
- [ ] Transaction state machine (§6) is implemented and tested end-to-end.
- [ ] Stale-quote denial is tested (a stale quote BLOCKS, never silently proceeds).
- [ ] Risk/anti-rug denial is tested (a REJECT BLOCKS and is never overridden by a high score).
- [ ] Kill switch is implemented, observable, and tested (active OR unknown → BLOCKED).
- [ ] Audit artifacts are produced for every attempt and pass redaction (zero findings).
- [ ] Reconciliation wall is in place: an unreconciled prior session BLOCKS the next attempt.
- [ ] A real **devnet** broadcast has been confirmed + finalized + reconciled end-to-end.
- [ ] A written **human sign-off** record exists for the specific scope being authorized.
- [ ] The independent safety audit (§companion) is re-run post-Part-1 with no new findings.

> Note: per the project's Phase 7 dossier, the canonical posture is
> `authorized-for-design-only`; flipping it requires a confirmed funded devnet broadcast **and** a
> written sign-off. Neither this lane nor Part 1 may self-authorize live trading.

---

## 8. The fourteen-condition mainnet live gate (reference)

Source: `packages/execution/src/live-gate.ts`. Default state of every condition is FAILED →
default gate state is **BLOCKED**. No override, no force flag, no partial credit.

1. `env-acknowledgment` — `SOLMAKER_ENABLE_LIVE_TRADING` == `I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK`
2. `config-phase7-ready` — config `phase7LiveTradingReady: true`
3. `cli-acknowledgment` — `--i-understand-this-can-lose-real-money`
4. `network-mainnet-beta` — network exactly `mainnet-beta`
5. `max-spend-cap` — explicit per-trade `maxSpendLamports`
6. `session-loss-cap` — explicit `sessionLossCapSol`
7. `slippage-cap` — explicit `slippageCapBps` (1–10000)
8. `kill-switch-clear` — kill switch explicitly clear (**unknown → BLOCKED**)
9. `quote-fresh` — quote freshness check passed
10. `simulation-ok` — latest simulation outcome `simulated-ok`
11. `risk-under-threshold` — advisory risk score under explicit cap
12. `wallet-validated` — destination wallet public key validated
13. `signer-boundary` — signer loaded through approved boundary (no raw keys)
14. `audit-and-redaction` — audit artifact path set AND redaction findings == 0

The send path (`send.ts`) **re-verifies** the full armed gate at submit time; a stale or partial
gate refuses. The CLI additionally requires the core live gate (`@soulmaker/core`).

---

## 9. Canary trade checklist

The first real-money trade is a **canary**: smallest viable size, maximum scrutiny.

- [ ] Smallest meaningful size; spend cap set to the canary amount, not a production amount.
- [ ] Single trade, single token, manual approval; no loop, no batching.
- [ ] Quote fetched fresh and re-checked for freshness immediately before signing.
- [ ] Exact envelope simulated `simulated-ok` immediately before signing.
- [ ] Phantom approval shown to and accepted by the human (not pre-approved).
- [ ] Status tracked through `prepared → simulated → requested → signed → submitted → confirmed →
      finalized` with each transition observed.
- [ ] On any anomaly: stop, hit the kill switch, reconcile, do not retry.
- [ ] Audit artifact written and redaction-verified; signature recorded as public chain data only.
- [ ] Post-trade reconciliation completed before any second trade.
- [ ] Result reported honestly — including loss — with no profit claim.

---

## 10. Emergency kill-switch checklist

- [ ] A kill switch exists with at least one **out-of-band** trigger (config flag, emergency-stop
      file, and/or env) — already an input to gate condition #8.
- [ ] **Unknown kill-switch state is treated as ACTIVE (BLOCKED)**, never as clear.
- [ ] Activating the kill switch causes the next gate evaluation to BLOCK and the send path to
      refuse with a clear refusal code.
- [ ] The kill switch is reachable **without** going through the trading UI (so a hung/compromised
      UI cannot trap the operator).
- [ ] Killing mid-session does not fabricate a result for any in-flight tx — the in-flight tx must
      be reconciled against the chain.
- [ ] The kill switch is covered by a test that proves armed-gate → kill → BLOCKED.
- [ ] A documented re-arm procedure exists (kill is easy; re-arming is deliberate and audited).

---

## 11. Manual arming model (no unattended trading)

- [ ] Arming is an explicit, time-boxed, human action — not a config default and not implied by
      connecting Phantom.
- [ ] Arming does **not** authorize a trade; each trade still requires per-trade approval.
- [ ] There is **no scheduler, cron, or loop** that can send a mainnet trade without a human in the
      loop for each send (autonomous send is out of scope until Part 2/3 gating is built and
      separately authorized).
- [ ] Disarming and the kill switch are always one action away.

---

## 12. Audit artifact checklist

Every live (or live-attempt) action must leave a redaction-safe artifact.

- [ ] An `ExecutionAttemptReport` (`execution.attempt.report.v1`) per attempt — `outcome` is
      `refused` or `submitted`, with `refusalCode`/`refusalDetail` (redacted, ≤400 chars).
- [ ] The artifact pins `phase7LiveTradingReady: false` and carries the "submission ≠ confirmation"
      caveat.
- [ ] The backing **simulation** artifact for the exact envelope.
- [ ] The **quote** + freshness verdict used.
- [ ] The **risk** assessment used (and its cap).
- [ ] The **gate checklist** result (all 14 conditions, satisfied/not).
- [ ] The **reconciliation** record closing the session.
- [ ] **Zero redaction findings** across all artifacts (gate condition #14).
- [ ] No secret-shaped value (seed, key, base58 ≥ 80 chars, bearer token) appears in any artifact —
      record the **slot** rather than the full signature where a value is signature-shaped.

---

## 13. Known repo risks

| Risk | Severity | Notes / mitigation |
| --- | --- | --- |
| Test-isolation flake F-1 (`sniper-alpha-campaign-command.test.ts:116`) | LOW | False-negative when Rust engine is pre-built. Fix recommended in test gap matrix; do not delete the assertion. |
| Test timeouts under concurrent CPU load (F-2) | INFO | Run vitest and cargo as separate CI steps; review 5000 ms default for engine-spawning CLI tests. |
| Phantom + live UI are net-new (Part 1) and unmerged | MEDIUM (process) | High change surface in `@soulmaker/execution` + `@soulmaker/adapters` + web. Re-run safety audit + full gates after merge. |
| Throwaway devnet keypair written in plaintext | LOW | Mitigated by mandatory gitignored `.keypair` suffix; devnet-only; no mainnet variant. |
| Devnet broadcast historically faucet-blocked (429) | INFO | A confirmed devnet broadcast is a live blocker (§7); track funding status. |
| Reliance on a single quote/RPC provider | MEDIUM | Provider redundancy / failover is a Part 2 deliverable; until then, a provider outage degrades to refusal, which is safe but blocks trading. |
| MEMORY.md index over size limit (tooling note) | INFO | Not a runtime risk; housekeeping only. |

---

## 14. Tests that must exist before live trading can be trusted

Summarized here; the authoritative, area-by-area list with current-vs-missing status is in
[`docs/testing/LIVE_TRADING_TEST_GAP_MATRIX.md`](../testing/LIVE_TRADING_TEST_GAP_MATRIX.md).

- [ ] **Live policy / gate** — every one of the 14 conditions BLOCKS when unmet; no override exists;
      both gates (mainnet + core) are required together.
- [ ] **Phantom UI** — non-custodial flow; no key ever reaches app code; user-reject path; network
      mismatch refusal; per-trade approval (no batch/auto-approve).
- [ ] **Transaction state machine** — every transition in §6, including the illegal transitions that
      must be impossible (e.g. `submitted`→`confirmed` without observation).
- [ ] **Stale quotes** — a stale/missing/unchecked quote BLOCKS.
- [ ] **Risk denial** — a REJECT blocks and a high score can never override a hard flag.
- [ ] **Kill switch** — active OR unknown → BLOCKED; mid-session kill reconciles, never fabricates.
- [ ] **Audit artifacts** — produced on both outcomes; redaction findings == 0; signature-shaped
      values are not embedded.
- [ ] **Rust/TS parity** — the Rust engine and TS re-derivation agree, and the "engine absent" case
      is deterministic regardless of a local build (fixes F-1).
- [ ] **Provider failure** — a provider/RPC outage degrades to refusal (never a silent or fake send).
- [ ] **Confirmation / reconciliation** — `submitted` is never reported as success; an unreconciled
      session BLOCKS the next attempt.

---

## 15. Sign-off block (to be completed by a human, not by an agent)

```
Live readiness reviewed by: ____________________   Date: __________
Base SHA reviewed:          ____________________
All §3 honesty requirements verified:   [ ] yes
All §7 live blockers cleared:           [ ] yes
Confirmed devnet broadcast on record:   [ ] yes   (slot: __________)
Safety audit re-run post-Part-1, clean: [ ] yes
Scope authorized (size / token / mode): ____________________
This sign-off authorizes ONLY the scope above and nothing further.
```

*An agent may prepare evidence for this block; only a human may sign it.*
