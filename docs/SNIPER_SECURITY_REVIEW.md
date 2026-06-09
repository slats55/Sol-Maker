# Sniper Security Review (PAPER-only boundary)

This is a focused security review of the `@soulmaker/sniper` decision-support pipeline and its CLI. It
documents the **current safety boundary**, the invariants that hold it, and the automated **backstops**
that fail loudly if any of them is ever weakened. It complements the repo-wide [`SECURITY.md`](../SECURITY.md),
the [`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md), and the Phase 6 contract in
[`PHASE_6_SIMULATION_BOUNDARY.md`](PHASE_6_SIMULATION_BOUNDARY.md).

> **Scope:** everything in `@soulmaker/sniper` + the `paper:sniper:*` / `paper:phase6:*` CLI commands is
> **PAPER-only and offline**. Phase 6 (transaction planning / simulation) and Phase 7 (burner / live
> trading) are **NOT started**. A `paper-enter` is a **simulated classification**, never an order.

## The boundary, in one paragraph

The sniper package is a **pure, offline, key-free** decision-support layer. It validates operator-supplied
candidate mints, summarizes already-loaded read-only inspection/risk data into a preflight, folds that
into simulated paper decisions under an explicit policy, and bundles / diffs / audits / gates the result.
It **holds no wallet, key, seed phrase, signer, or keypair**; it **builds, signs, simulates, and sends no
transaction**; it makes **no network/RPC call** and reads **no file** (the CLI owns all I/O). Even its one
Phase-6-boundary module (`simulation-intent.ts`) is **inert data only** — `executable` is hard-wired
`false` and every required approval is `satisfied: false`.

## Invariants (and what enforces them)

| # | Invariant | Enforced by |
| --- | --- | --- |
| 1 | The package imports **no** `@solana/web3.js`, `@solana/*`, or `@soulmaker/solana` (no chain capability). | `no-forbidden-imports.test.ts`, `security-boundary.test.ts` |
| 2 | No source module references a wallet/key/signer/transaction token (`privateKey`, `secretKey`, `mnemonic`, `Keypair`, `signTransaction`, `sendTransaction`, `VersionedTransaction`, `TransactionInstruction`, `new Connection`, …). | per-module `*-safety.test.ts` + package-wide `security-boundary.test.ts` |
| 3 | No source module does I/O or networking (`fs`/`path`/`http`/`https`/`net`/`child_process`/`fetch`/`axios`/`ws`). | `no-forbidden-imports.test.ts`, `security-boundary.test.ts` |
| 4 | Every builder is **deterministic** — no `Date.now`, no `new Date`, no `Math.random`; byte-stable output, no wall-clock time. | per-module `*-safety.test.ts`, `no-forbidden-imports.test.ts` |
| 5 | Mints are validated as **32-byte public keys**; secret-length / private-key-shaped input is **refused** and never echoed. | `mint-address.test.ts`, `candidate-list*.test.ts`, `sniper-security.test.ts` |
| 6 | No command accepts a private key; unknown `privateKey`/`secretKey` fields are **dropped**, not carried through. | `sniper-security.test.ts` |
| 7 | All human / JSON output is passed through the shared **redactor**, so a seed-phrase-shaped or secret-length value is scrubbed. | every module's formatter test + `sniper-security.test.ts` |
| 8 | The Phase-6 prerequisite tracker and the inert intent plan can **never authorize Phase 6 / execution**: `phase6ImplementationStarted` is always `false`, `executable` is always `false`, approvals are always `satisfied: false` (validators enforce these as HARD invariants). | `phase6-prereqs*.test.ts`, `simulation-intent*.test.ts` |
| 9 | Every shipped `examples/sniper/*.json` is labeled a fictional / deterministic fixture and contains no key/seed field and no secret-length blob. | `sniper-security.test.ts` |
| 10 | The package depends only on the pure `@soulmaker/risk` + `@soulmaker/security` packages. | `security-boundary.test.ts` |

## Backstop tests (where to look)

- **`packages/sniper/src/security-boundary.test.ts`** — package-wide source scan over **every** non-test
  module (auto-discovered), asserting no capability token, no chain/IO/network import, and a chain-free
  dependency set. This is the test that fails the day a new module forgets its own safety test.
- **`packages/sniper/src/no-forbidden-imports.test.ts`** — import-specifier scan + `Date.now`/`Math.random`
  ban; also asserts the known module list is non-empty.
- **`packages/sniper/src/*-safety.test.ts`** — per-module capability-token + import + BOM/control-char /
  conflict-marker scan (comments stripped).
- **`apps/cli/src/sniper-security.test.ts`** — behavioral CLI/examples backstops (private-key refusal,
  mnemonic redaction, example-fixture labeling + no-secret).
- **`apps/cli/src/sniper-cohesion.test.ts`** — every command refuses a missing required arg, writes nothing
  by default, and emits parseable, deterministic, secret-free JSON.

## What this review does NOT cover (out of scope by design)

- **No live trading, no order placement, no transaction build/sign/send** — none exists; Phase 6/7 are not
  started. The live gate (`evaluateLiveGate`) lives in `@soulmaker/core` and the sniper package never
  touches it.
- **No live snipe-list source** — candidates are operator-authored local JSON; there is no scraper or
  network fetch.
- **No real on-chain facts about real mints are shipped** — the example preflight inputs use invented
  (fictional) mints + invented inspection/risk values; the operator generates real inputs from their own
  read-only `token:inspect` / `token:risk` output.

## If you are about to weaken any invariant

Stop. Any change that would let the sniper package import a chain module, hold a key, build/sign/send a
transaction, or make a network call must instead go through the Phase 6 / Phase 7 process in
[`PHASE_6_SIMULATION_BOUNDARY.md`](PHASE_6_SIMULATION_BOUNDARY.md) — behind an explicit human decision, a
structurally-separated signer, dry-run-by-default, and the full prerequisite set. The backstop tests above
exist to make such a change fail loudly in CI rather than slip in quietly.
