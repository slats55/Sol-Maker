# Phase 7 Authorization Dossier

**Status: NOT AUTHORIZED for live trading. This document does not authorize anything.**

This is the written, versioned security dossier that determines whether Sol Maker is ready to be
*considered* for a separately, explicitly approved **S104 controlled mainnet micro-trade**. It is a
companion to the machine-checked artifact `phase7.authorization.audit.v1`
(`pnpm soulmaker paper:phase7:authorization:audit`) and the safety docs
[`EXECUTION_SAFETY.md`](EXECUTION_SAFETY.md), [`MAINNET_DRY_RUN.md`](MAINNET_DRY_RUN.md),
[`PHASE7_LIVE_EXECUTION_GATE.md`](PHASE7_LIVE_EXECUTION_GATE.md), and
[`RUST_ENGINE.md`](RUST_ENGINE.md).

- **Audited baseline:** `origin/master = e607238` plus the Sprint 103 audit branch
  `sprint-103-security-audit-phase7-authorization-dossier`.
- **Audit verdict (this repo, today): `authorized-for-design-only`.** Every safety invariant is
  machine-verified; the operational micro-trade prerequisites (a confirmed devnet broadcast and a
  written human sign-off) are still open. Live execution stays unauthorized.
- Reproduce: `pnpm soulmaker paper:phase7:authorization:audit --repo-sha <sha>` (read-only; sends
  nothing; authorizes nothing).

---

## 1. What has been PROVEN

| Area | Proven | Evidence |
| --- | --- | --- |
| **No mainnet send command** | No CLI command can send on mainnet; the only send surface is `execution:devnet:send` (devnet, double opt-in). | `apps/cli/src/command-surface-audit.test.ts`, `apps/cli/src/release-candidate-safety.test.ts` |
| **No bypass / arm / force-live flag** | No command exposes an arm/force-live/bypass/enable-live/go-live/disable-gate/no-dry-run flag. | `command-surface-audit.test.ts` |
| **Fourteen-condition live gate** | Default state BLOCKED; `armed = checks.every(satisfied)`; no override, no partial credit. | `packages/execution/src/live-gate.ts` |
| **Send seam is devnet-pinned** | `attemptExecution` is the only send path; its only two non-test callers (`execution:devnet:send`, `runDevnetRehearsal`) both refuse anything but `devnet-execution`. No CLI path constructs `mainnet-live-armed`. | `packages/execution/src/send.ts`, `command-surface-audit.test.ts` |
| **Signer boundary** | A mainnet signer refuses to load without the armed fourteen-condition gate; no CLI command loads a mainnet signer; secrets never logged or serialized. | `packages/execution/src/signer.ts` |
| **Release candidate is no-send** | `sniper.mainnet_dryrun.release_candidate.v1` pins `liveSendStatus: "disabled"`; a candidate score can never override a risk/build/sim gate; a stray send-result/signature is refused. | `release-candidate-safety.test.ts` |
| **Reconciliation wall** | An unreconciled / pending-confirmation / unknown session blocks a new execution attempt; the only exits are a real reconcile or an audited acknowledgment. No bypass. | `packages/execution/src/session.ts` |
| **Artifact redaction** | The redactor strips bearer tokens, long base58/hex key blobs, and mnemonics by value and by key name; audit artifacts are redaction-safe by construction. | `packages/security/src/redact.ts` |
| **Rust boundary** | The engine depends only on `serde`/`serde_json`; the capability scan (both Rust- and TS-side) forbids signer/send/key/subprocess/network tokens and runtime env/clock reads; TypeScript parity walls re-derive every Rust claim. | `crates/solmaker-engine/tests/safety_scan.rs`, `packages/engine-bridge/src/engine-safety.test.ts` |
| **No tracked secrets** | `pnpm safety:scan` finds no tracked keypair/.env/secret file and no key/seed leak across the tree; `.gitignore` covers `runs/`, `*.keypair`, `*.key`, `*.wallet`, `.env`, `secrets/`, `burner/`. | `scripts/safety-scan.ts`, `apps/cli/src/safety-scan.test.ts` |

## 2. What has NOT been proven

- **A real mainnet trade has never been executed** — by design, and that is not in scope here.
- **A real devnet end-to-end broadcast has never landed.** The devnet faucet has been rate-limited
  (HTTP 429) across every attempt; the rehearsal honestly reports `devnet-funding-blocked` and sends
  nothing. The send/sign/confirm/reconcile path is built and unit-tested, but the *live broadcast*
  link is unverified on a real cluster.
- **No written human Phase 7 sign-off exists yet.** This document is the security review; the
  authorization is a separate, explicit human decision.

## 3. The no-send invariant (summary)

The only code that can submit a transaction is `attemptExecution` (`packages/execution/src/send.ts`).
It refuses every mode except `devnet-execution` and `mainnet-live-armed`, and re-verifies the full
fourteen-condition gate for the latter. **No shipped CLI command resolves `mainnet-live-armed` into a
send** — `execution:devnet:send` and `execution:devnet:rehearse` both hard-pin `devnet`, and mainnet
sending has no CLI surface anywhere. The `mainnet-live-armed` branch exists as a library safety net,
not a reachable path.

## 4. The fourteen-condition live gate (summary)

Default state: **BLOCKED** (every condition fails by default). All fourteen must pass to arm:
`env-acknowledgment`, `config-phase7-ready`, `cli-acknowledgment`, `network-mainnet-beta`,
`max-spend-cap`, `session-loss-cap`, `slippage-cap`, `kill-switch-clear`, `quote-fresh`,
`simulation-ok`, `risk-under-threshold`, `wallet-validated`, `signer-boundary`,
`audit-and-redaction`. The audit cross-checks its gate set against these exact ids, so adding or
removing a condition forces this dossier to be updated.

## 5. Rust boundary (summary)

The Rust sidecar is read-only intelligence/inspection behind JSON IPC: it cannot sign, send, load
keys, read runtime env secrets, open the network, or spawn subprocesses, and its only dependencies
are `serde`/`serde_json`. TypeScript remains the orchestrator and final validator; every Rust claim
is re-derived on the TypeScript side and refused on disagreement. An absent toolchain reports
`unavailable` honestly. Rust intelligence (candidate/quote/tx/sim scoring) can never override a gate.

## 6. Devnet status

**Funding-blocked.** The throwaway-key rehearsal path works end-to-end up to the faucet; the faucet
returns 429, so the rehearsal stops at `devnet-funding-blocked` and sends nothing. To finish: fund
the throwaway public key the rehearsal prints with valueless devnet SOL, then rerun:

```
SOLMAKER_ENABLE_DEVNET_EXECUTION=devnet-only pnpm soulmaker execution:devnet:rehearse \
  --out runs/s103-devnet-rehearsal --acknowledge-devnet-execution --force
```

(Throwaway keys + run artifacts live under the gitignored `runs/` and are never committed.)

## 7. Mainnet dry-run status

**Complete and no-send.** `paper:sniper:rehearse --mode mainnet-dry-run` chains candidate scoring,
risk, quote fetch/score, unsigned build, tx inspection, real `simulateTransaction`, and readiness
into a `sniper.mainnet_dryrun.release_candidate.v1`. The best possible verdict is
`dryrun-complete-blocked-live` — dry-run evidence complete, **live still disabled**. Real mainnet
evidence (BONK build + sim, USDC auto-REJECT) has been captured with nothing sent.

## 8. Reconciliation wall

Devnet send/rehearse refuse to start a new attempt while a prior session is unreconciled
(`pending-confirmation` / `unreconciled` / `unknown`). The only exits are `execution:session:reconcile`
(real RPC accounting) or `execution:session:acknowledge` (an explicit, audited manual entry). There
is no force/bypass variant.

## 9. Controlled micro-trade prerequisites (the gap to close before S104)

The audit's `authorized-for-design-only` verdict will only become
`ready-for-separate-microtrade-authorization` once BOTH operational prerequisites are met:

1. **A real devnet end-to-end broadcast has confirmed and reconciled at least once** — proving the
   live send/sign/confirm/reconcile link on a real cluster with valueless funds.
2. **A written human Phase 7 sign-off is recorded** in this dossier.

Even then, that verdict authorizes **nothing**: it only states the repo is ready to be *considered*.

## 10. Exact conditions required before an S104 micro-trade

1. This dossier's prerequisites (§9) are met and the audit reads
   `ready-for-separate-microtrade-authorization`.
2. A **separate, explicit, written user authorization** for S104 exists (see §11).
3. The full fourteen-condition live gate is satisfiable with real evidence (fresh quote, passing
   simulation, risk under cap, validated wallet, signer boundary, audit + zero redaction findings).
4. The micro-trade safety proposal (§12) is implemented and tested as a *new, separately reviewed*
   sprint — **not** as part of this audit.

## 11. This document authorizes nothing

**This dossier is a security review, not an authorization.** It does not enable, arm, or approve any
live trade by itself. A controlled S104 mainnet micro-trade requires a **separate, explicit, written
authorization from the user**, given after reading this dossier. No agent may self-authorize S104,
and no flag, env var, or config field in this repo can substitute for that human decision.

## 12. Exact micro-trade safety proposal (for a future, separately-authorized S104)

If and only if S104 is separately authorized, the controlled micro-trade must be built and reviewed
as its own sprint, and must enforce ALL of the following:

- **Burner wallet only** — a dedicated throwaway wallet funded with a tiny, disposable amount; never
  a primary or treasury wallet.
- **Tiny max spend** — an explicit per-trade spend cap of a few dollars at most, enforced by the
  fourteen-gate `max-spend-cap` and the operator safety controls.
- **Manual confirmation** — an explicit human confirmation at send time; no automated trigger.
- **No autonomy** — no loop, no scheduler, no "let it run"; a human initiates the single attempt.
- **One trade only** — `maxTradesPerSession = 1`; the session is reconciled before any second trade
  is even possible.
- **Quote freshness required** — a live quote within an explicit age cap (`quote-fresh`).
- **Simulation required** — the exact unsigned envelope must `simulated-ok` immediately before send.
- **Risk pass required** — the candidate's advisory risk must be under an explicit cap; a REJECT or
  critical flag refuses.
- **Token-2022 blockers refused** — transfer hooks / permanent delegate / freeze authority etc.
  refuse the build.
- **Session loss cap** — an explicit `sessionLossCapSol`; breaching it halts.
- **Kill switch** — the kill switch / emergency-stop must be clear, and engaging it stops everything.
- **Post-trade reconciliation required** — the attempt is journaled, then
  `execution:session:reconcile` must account for it before the wall reopens.

---

*Generated for Sprint 103. Re-run `pnpm soulmaker paper:phase7:authorization:audit` to refresh the
machine-checked artifact. Examples: `examples/phase7/authorization-audit/`.*
