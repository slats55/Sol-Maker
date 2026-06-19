# Live Trading Safety Audit — Sol Maker

> **Independent audit.** Produced in the parallel QA/release lane (branch
> `sprint-107b-live-readiness-qa-part2-part3-plan`) by a session that did **not** edit any
> wallet, signing, sending, or live-execution code. This document reports what is in
> committed `origin/master` at the SHA below. It does **not** authorize live trading.

| Field | Value |
| --- | --- |
| Audited ref | `origin/master` |
| Audited SHA | `614cdf24816bb8f6a8f9327bcbb14b596e7d8d6e` |
| Audit branch | `sprint-107b-live-readiness-qa-part2-part3-plan` (from `origin/master`) |
| Audit date | 2026-06-18 |
| Scope | Static search of tracked source + docs. No live RPC, no signing, no sending. |
| Method | `git grep` / ripgrep over `packages/`, `apps/`, `crates/`, `docs/` |
| `pnpm safety:scan` | **PASS** — 712 tracked text files, "no key/seed leaks" |
| Rust `safety_scan` integration tests | **PASS** — 5/5 |

This audit is intentionally adversarial: it hunts for the patterns that would make live trading
dishonest or unsafe, and reports exactly where they live. Most "hits" are the project's own
**guard tests** that assert the dangerous tokens never appear in production source — those are the
safety net, not violations. Real production usages are isolated and reviewed below.

---

## 1. Executive summary

The committed master is **strongly safety-hardened**. Every transaction-signing or
transaction-sending capability is confined to a single package (`@soulmaker/execution`) behind a
documented refusal-first boundary, default-blocked by a fourteen-condition mainnet live gate with
no override. There is **no seed-phrase handling anywhere**, **no mainnet send CLI surface**, and
**no logging of secret material** in production code. The repo's own `safety:scan` and a
Rust-side safety integration test both pass.

**One genuine finding** surfaced — a *test-isolation* defect (not a product/safety regression):
a CLI test asserts the Rust engine is "unavailable when absent," but it does not isolate itself
from a locally-built engine binary, so it produces a false-negative failure on any machine where
`cargo build` ran before `pnpm test`. Severity **LOW** (test-only, no runtime impact). Fix is
recommended and described below; this lane does **not** edit it to avoid conflicting with the
active Part 1 session.

No HIGH or CRITICAL findings. No fake-trading-success paths. No code change recommended to live
execution files in this lane.

---

## 2. Findings table

| # | Finding | Severity | Location | Status |
| --- | --- | --- | --- | --- |
| F-1 | Rust-engine "unavailable when absent" CLI test is not isolated from a locally-built engine binary → false-negative failure when Rust was built first | **LOW** (test hygiene) | `apps/cli/src/sniper-alpha-campaign-command.test.ts:116` | Open — fix recommended, not applied in this lane |
| F-2 | Full `pnpm test` run is susceptible to 5000 ms timeouts under heavy concurrent CPU load (e.g. running vitest while `cargo build` compiles) | **INFO** (flake risk) | `apps/cli/src/sniper-alpha-*` (10 tests observed) | Pass cleanly in isolation; recommend CI ordering + per-file timeout review |
| F-3 | Production signing capability exists (by design) | **ACCEPTED** | `packages/execution/src/signer.ts`, `send.ts` | Reviewed — boundary is sound (§4) |
| F-4 | Throwaway devnet keypair is written to disk in plaintext JSON byte array | **ACCEPTED / LOW** | `packages/execution/src/signer.ts:146` | Mitigated: mandatory `.keypair` suffix is gitignored; devnet-only; no mainnet variant |

No findings rated MEDIUM, HIGH, or CRITICAL.

---

## 3. Search commands and exact results

Each search was run from the repo root on the audited SHA. Results are summarized with the
real file:line references; full output is reproducible by re-running the command.

### 3.1 Signing / sending / secret-key tokens

```
rg -nE 'fromSecretKey|\.secretKey|signTransaction|signAllTransactions|signAndSendTransaction|sendRawTransaction|sendTransaction|sendAndConfirm' \
  packages apps crates --glob '*.ts' --glob '*.tsx' --glob '*.rs'
```

**Production (non-test) hits — the complete list:**

| File:line | What it is | Verdict |
| --- | --- | --- |
| `packages/execution/src/signer.ts:60` | `Keypair.fromSecretKey(...)` inside the single signer boundary | Boundary, reviewed (§4) |
| `packages/execution/src/signer.ts:146` | writes throwaway **devnet** keypair to a `.keypair` (gitignored) file | Devnet-only, gitignored suffix enforced |
| `packages/execution/src/signer.ts:30,99,155,200` | `signTransactionInPlace` boundary method (closes over key; never returns bytes) | Boundary, reviewed |
| `packages/execution/src/send.ts:42,69,70,187,188` | the only `sendRawTransaction` call site, behind 5 sequential walls | Refusal-first path, reviewed (§4) |
| `packages/solana/src/rpc-client.ts:5` | **comment** documenting "deliberately no `sendTransaction`, `signTransaction`…" | Protective — read-only RPC client |
| `packages/solana/src/index.ts:8` | **comment** "There is no signer and no `sendTransaction`." | Protective |

Every other hit (dozens) is inside a `*-safety.test.ts`, `package-safety.test.ts`,
`no-forbidden-imports.test.ts`, or `*.test.ts` mock — i.e. the project's own assertions that
those tokens are **absent** from production source, or mocked RPC objects inside execution tests.
That is the intended safety architecture, not a leak.

### 3.2 Seed phrases / mnemonics / "import wallet"

```
rg -niE 'seed phrase|mnemonic|import.{0,12}(seed|wallet|private key)|paste.{0,12}(seed|key)' docs README.md apps/web/README.md
```

**Result: every hit is a PROHIBITION.** Representative lines:

- `docs/PHASE7_LIVE_EXECUTION_GATE.md:69` — "handles **no seed phrases** — only the standard `solana-keygen` 64-byte JSON array".
- `docs/PHASE7_LIVE_SEND_DESIGN_REVIEW.md:23` — "**No seed phrases, ever.**"
- `docs/PHASE_6_SIMULATION_BOUNDARY.md:35` — "**No seed phrases / mnemonics.** Never accepted or generated."
- `docs/S104_CONTROLLED_MICROTRADE_PLAN.md:120-121,234` — "**No seed phrases, ever** … No mnemonic/seed import is added or accepted."

**No document instructs the user to import, paste, or type a seed phrase or private key.**
This is the single most important negative result in the audit, and it is clean.

### 3.3 Logging of secret material (production source)

```
rg -niE 'console\.(log|error|warn|info|debug).*(secret|seed|private|keypair|mnemonic)' \
  packages apps --glob '*.ts' --glob '*.tsx'   # excluding *.test.* / safety
```

**Result: zero hits in production source.** The signer boundary's `toJSON()` returns a fixed
redaction marker (`[signer-boundary: redacted]`), and the object is `Object.freeze`d so the
serializer cannot be replaced. The send path redacts `refusalDetail` via
`redactString(...).slice(0, 400)` before it is ever placed in a report.

### 3.4 Mainnet send CLI surface

```
rg -noE '"(paper|execution|engine):[a-z:-]+"' apps/cli/src/commands.ts | rg -i 'execution|send|live|mainnet|devnet'
```

**Result — the only execution send/session commands:**

- `execution:devnet:send` (devnet-only; behind `SOLMAKER_ENABLE_DEVNET_EXECUTION=devnet-only` + `--acknowledge-devnet-execution`)
- `execution:devnet:rehearse`
- `execution:session:reconcile`
- `execution:session:acknowledge`

**There is no `execution:mainnet:*`, no `:live` send command — mainnet sending has no CLI
surface at all.** This is deliberate and matches `docs/PHASE7_LIVE_EXECUTION_GATE.md`.

### 3.5 `safety:scan` and Rust safety tests

```
pnpm run safety:scan         → OK — scanned 712 tracked text files; no key/seed leaks; .gitignore covers secret paths
cargo test --workspace       → 80 tests pass, including tests/safety_scan.rs (5/5):
                                - production_source_has_no_forbidden_capability_token
                                - binary_reads_no_environment_secret_and_no_clock
                                - dependency_set_is_exactly_the_reviewed_allowlist
                                - status_artifact_pins_every_disabled_marker
                                - comment_stripping_stays_sound
```

---

## 4. Review of the one production signing/sending surface

`@soulmaker/execution` is the only package that can sign or send. Both seams were read
end-to-end during this audit (read-only).

### 4.1 Signer boundary — `packages/execution/src/signer.ts`

- **No seed phrases.** Only the standard `solana-keygen` 64-byte JSON array is accepted, and only
  via an **env-var NAME** that holds the file **PATH** — the path, file, and bytes are never
  logged, echoed, or serialized (header comment + `toJSON` redaction marker).
- **Devnet-first.** `loadLocalSignerBoundary` refuses a `mainnet-beta` signer unless the
  **armed** fourteen-check live-gate result is supplied with every check satisfied
  (`signer.ts:75-82`).
- **Throwaway devnet keys** (`createThrowawayDevnetSigner` / `loadThrowawayDevnetSigner`) must use
  a `.keypair` suffix — covered by the repo `*.keypair` gitignore rule — and have **no mainnet
  variant** by construction.
- The returned boundary is `Object.freeze`d; `toJSON()` always yields the redaction marker; the
  public key is the only readable identity.

### 4.2 Send path — `packages/execution/src/send.ts`

`attemptExecution(...)` is refusal-first and **never throws** — every failure is an honest
`ExecutionAttemptReport` with `outcome: "refused"`. Five sequential walls before a single send:

1. **Mode wall** — only `devnet-execution` or `mainnet-live-armed` can proceed; every other mode
   (`paper`, `readonly`, `mainnet-dry-run`, `mainnet-live-blocked`) refuses structurally.
2. **Mainnet re-verification** — `mainnet-live-armed` re-checks the full 14-condition gate here;
   a stale or partial gate refuses.
3. **Operator safety controls** — evaluated per trade, per session.
4. **Envelope wall** — must validate as strictly UNSIGNED; network must match both mode and signer.
5. **Submit once** — refresh blockhash, sign through the boundary, `sendRawTransaction` once.
   No retry, no chase. `phase7LiveTradingReady: false` is pinned in **both** outcomes, and the
   report states "Submission is NOT confirmation."

### 4.3 The fourteen-condition mainnet live gate — `packages/execution/src/live-gate.ts`

Default state of every condition is FAILED → default state of the gate is BLOCKED. No override,
no force flag, no partial credit. The conditions:

1. `env-acknowledgment` — `SOLMAKER_ENABLE_LIVE_TRADING` exactly `I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK`
2. `config-phase7-ready` — config `phase7LiveTradingReady: true`
3. `cli-acknowledgment` — `--i-understand-this-can-lose-real-money`
4. `network-mainnet-beta` — network exactly `mainnet-beta`
5. `max-spend-cap` — explicit per-trade `maxSpendLamports`
6. `session-loss-cap` — explicit `sessionLossCapSol`
7. `slippage-cap` — explicit `slippageCapBps` (1–10000)
8. `kill-switch-clear` — kill switch explicitly clear (**unknown = BLOCKED**)
9. `quote-fresh` — quote freshness check passed
10. `simulation-ok` — latest simulation outcome is `simulated-ok`
11. `risk-under-threshold` — advisory risk score under explicit cap
12. `wallet-validated` — destination wallet public key validated
13. `signer-boundary` — signer loaded through the approved boundary (no raw keys)
14. `audit-and-redaction` — audit artifact path set **and** redaction findings exactly zero

The header notes this gate **complements** (does not replace) the long-standing core live gate
(`@soulmaker/core` `evaluateLiveGate` / `DANGEROUS_BURNER_LIVE`); the CLI requires BOTH.

---

## 5. Fake-data / "looks live but isn't" paths

No production path fabricates a transaction signature, confirmation, or "submitted" result.
Specifically checked:

- Dry-run and rehearsal artifacts pin `liveSendStatus: "disabled"` / `phase7LiveTradingReady: false`.
- The simulator (`@soulmaker/txpreview`) runs with `sigVerify:false` over UNSIGNED envelopes — no
  signer or key exists in that path (`docs/MAINNET_DRY_RUN.md:56`).
- Example fixtures under `examples/` are labeled and redacted; the safety scan covers them.
- The `signature` field in `ExecutionAttemptReport` is only ever populated by a real
  `sendRawTransaction` return value (public chain data), never synthesized.

**No fake trading success was found.**

---

## 6. Broad safety-scan exemptions

`scripts/safety-scan.ts` and `.gitignore` were reviewed for over-broad allow rules that could let
a secret slip through. The gitignore secret rules are tight and value-shaped, not blanket:

```
.env / .env.*  (but !.env.example)   soulmaker.config.json
*.key  *.keypair  *.wallet           secrets/  burner/   runs/
```

No wildcard exemption (`*`, whole-directory allow) was found that would suppress secret detection.
`runs/` and `references/*/` are correctly excluded from the tree (operator output / study repos),
and the scan still covers `examples/`. **No dangerous exemption found.**

---

## 7. Recommended fixes

| Finding | Recommendation | Owner | Conflict risk |
| --- | --- | --- | --- |
| F-1 | Make the "engine absent" test deterministic regardless of a local build: force engine-absent (e.g. point the engine resolver at a non-existent path, or set the bridge's env/PATH override to empty) instead of relying on the binary not existing. | Test-hygiene follow-up after Part 1 merges | NONE (test file, not live execution) — but **not applied in this lane** to avoid touching the active alpha pipeline |
| F-2 | In CI, run `pnpm test` and `cargo build`/`cargo test` as **separate, non-overlapping** steps; review the 5000 ms default timeout for the alpha campaign/history CLI tests that may spawn the engine subprocess. | CI/release | NONE (CI config) |
| F-3/F-4 | None required — accepted by design and well-mitigated. Re-audit after Part 1 lands, since the Phantom/live path will add code to `@soulmaker/execution` and `@soulmaker/adapters`. | Re-run this audit post-Part-1 | n/a |

This lane deliberately makes **no code edits** to live execution, signing, sending, or adapter
files. F-1/F-2 are recorded as the test-hygiene backlog (see
`docs/testing/LIVE_TRADING_TEST_GAP_MATRIX.md`).

---

## 8. Re-audit checklist for after Part 1 lands

When the Phantom + live execution branch merges, re-run this audit and additionally verify:

- [ ] No new `Keypair.fromSecretKey` / `*.secretKey` outside `packages/execution/src/signer.ts`.
- [ ] The Phantom adapter **never receives, stores, or transmits** the user's private key — it must
      be a browser `signAndSend`/`signTransaction` request flow where the key never leaves the
      wallet extension (the `@soulmaker/adapters` header already commits to "the bot never custodies
      the dashboard user's key").
- [ ] No backend route accepts a private key, keypair file, or seed in a request body or query.
- [ ] `pnpm safety:scan` still passes, and no new `*.key/.keypair/.wallet` path is tracked.
- [ ] Every new live UI affordance is gated behind the existing fourteen-condition gate, with no
      new override/force flag.
- [ ] No new `console.*` of secret-shaped material; redaction still covers all new artifacts.
- [ ] The mainnet send path still has **no autonomous trigger** — manual arm + manual approve only.

---

*This audit authorizes nothing. Live trading remains gated and, on the audited SHA, structurally
default-blocked.*
