# Phase 6 dry-run transaction boundary — DESIGN ONLY (Sprint 79)

> **Status: design document. No implementation is authorized by this document.**
> Every dangerous term below (`simulateTransaction`, signing, sending, key material) appears in
> DESIGN/REFUSAL context only. Nothing in this document changes the simulation package's
> boundary, weakens a validator, or authorizes Phase 7.

## Why this document exists

The Phase 6 simulation stack ends, deliberately, at an honest wall: the canonical dry-run
adapter (`UNAVAILABLE_DRY_RUN_ADAPTER` in `packages/simulation/src/adapter.ts`) reports every
attempt as `unavailable`, because a REAL on-chain dry-run needs transaction material that
`@soulmaker/simulation` is structurally forbidden from producing. The "real completed dry-run"
path today exists only through test adapters that exercise the contract with fictional outcomes.

This document is the separately-reviewed DESIGN for what crossing that wall would require —
written so a future, explicitly-authorized session can implement it without guessing, and so the
current session cannot be misread as having implemented it.

## What exists today (verified against the source)

| Layer | Capability | Hard limits (enforced by tests) |
| --- | --- | --- |
| `@soulmaker/simulation` adapter contract | `attemptDryRun(request)` over LABEL-ONLY previews; closed outcomes `unavailable` / `failed-safely` / `completed-safely` | no key/signer/transaction/config field exists in the request or adapter shape; sensitive-named adapter properties refused; outcomes normalized — no "sent/signed/live" outcome exists to claim |
| `simulation.intent.plan.v2` previews | per-candidate destination/amount/fee previews | destination and fee are ALWAYS `unresolved` (no validated route data exists in the paper chain); amounts resolve only as operator paper-unit LABELS |
| `@soulmaker/solana` read-only client | `getRpcHealth`, `getVersion`, `getSolBalance`, `getTokenAccounts`, `getTokenMintInfo` | frozen literal of read-only methods; no sign/send/airdrop method exists; no blockhash fetch, no account-keyed instruction builder |
| Import allowlist | `@soulmaker/simulation` may import ONLY `@soulmaker/sniper` + `@soulmaker/security` | every network/chain capability module (including `@solana/*` and `@soulmaker/solana`) is refused by default |

## What a REAL dry-run (`simulateTransaction`) actually needs

A Solana `simulateTransaction` RPC call simulates a **transaction message** against current
chain state. To construct that message you need, at minimum:

1. **A resolved destination/route** — the program(s) to invoke and their account lists (e.g. a
   pool/market address and the swap program's instruction accounts). The paper chain has NO
   validated route data: `destinationPreview` is permanently unresolved by design.
2. **A real amount in base units** — the paper chain carries paper-unit LABELS, never currency.
   No label-to-lamports conversion exists, on purpose.
3. **A fee payer public key** — an ADDRESS (public information), not a private key.
4. **A recent blockhash** — fetched from RPC, or sidestepped (see below).
5. **Instruction-building capability** — code that assembles the above into a transaction
   message (e.g. `@solana/web3.js` `TransactionMessage`). This capability does not exist
   anywhere in this repo today and is refused by the simulation package's import allowlist.

## The honest technical finding: signing is NOT the barrier

Solana's `simulateTransaction` accepts `sigVerify: false` and `replaceRecentBlockhash: true`,
which means an **unsigned** transaction message can be simulated without any signer, private
key, or seed phrase ever existing. A correctly-designed dry-run boundary therefore NEVER needs
key material — the fee payer is a public address, signature verification is disabled, and the
blockhash is replaced server-side.

What actually blocks a real dry-run today is, in order:

1. **Unresolved inputs** — destination, route, and real amounts do not exist in the paper chain
   and the pipeline never invents them. Until a separately-designed, validated route-resolution
   layer exists (itself a major reviewed slice), there is nothing truthful to simulate.
2. **Transaction construction** — building instructions is a new capability class. It must NOT
   be bolted onto `@soulmaker/simulation` (whose boundary proves it cannot construct
   transactions) and must live in a new, separately-reviewed package.
3. **Network access** — the simulation package is offline by design. The construction/simulation
   boundary needs read-only RPC access, which belongs next to (or behind) `@soulmaker/solana`.

## The designed boundary (for a FUTURE authorized session)

A new package — working name `@soulmaker/txpreview` — implementing exactly one flow:

```
resolved plan entry (validated)            ──┐
fee-payer PUBLIC address (config, pubkey) ──┼─→ build UNSIGNED message → simulateTransaction
read-only RPC endpoint                     ──┘    (sigVerify: false, replaceRecentBlockhash: true)
                                                       │
                                                       ▼
                              closed outcome mapped into the EXISTING adapter contract
                              (completed-safely / failed-safely / unavailable — nothing else)
```

Hard requirements, none of which may be weakened during implementation:

- **Input artifacts:** a strictly-validated `simulation.intent.plan.v2` whose entry is FULLY
  resolved (the existing result builder already skips unresolved entries; that behavior stands),
  plus a strictly-validated route-resolution artifact (schema to be designed; it must carry its
  own provenance and validation, never operator-typed addresses accepted silently).
- **What must NEVER enter the boundary:** `Keypair`/signer types, secret keys, seed phrases,
  mnemonics, wallet import/export, `signTransaction`/`signAllTransactions`/`partialSign`,
  `sendTransaction`/`sendRawTransaction`, any RPC write method, env-var key material, main-wallet
  configuration, or any bypass/override flag. The package's own forbidden-token and
  import-allowlist scans must enforce this from the FIRST commit (copy the pattern from
  `packages/simulation/src/no-forbidden-imports.test.ts`).
- **Adapter integration:** the boundary plugs in ONLY as a `SimulationDryRunAdapter`. The
  existing contract already guarantees outcome normalization, lock validation, and
  sensitive-property refusal; the new package gets no wider interface.
- **Kill switch:** the operator stop-simulation switch must gate the adapter — a tripped switch
  means `attemptDryRun` is never invoked (the result builder already blocks the whole result; the
  adapter must ALSO refuse independently, fail-closed at both layers).
- **Secrets policy:** every RPC error/detail string passes through `redactString`; the adapter
  object carries no sensitive-named property (already refused by the contract validator).
- **Burner isolation:** remains a SPEC. If a fee-payer address is configured it is a PUBLIC
  burner address; configuring it creates no wallet, imports no key, and grants no spend
  capability. `simulateTransaction` with `sigVerify: false` cannot move funds.
- **Determinism caveat (design decision):** a real dry-run reads LIVE chain state, so byte-for-
  byte determinism cannot hold across runs. The result artifact must carry an explicit
  `liveStateCaveat` marker (schema addition, validated) so no downstream consumer mistakes a
  live-state simulation for a deterministic fixture. The deterministic test path stays the
  default everywhere.

## Required tests BEFORE any implementation lands

1. Import-allowlist + forbidden-token + determinism scans for the new package (day one).
2. Contract tests: the adapter refuses to run when the kill switch is declared tripped.
3. Refusal tests: secret-shaped config, signer-shaped objects, and write-method-bearing RPC
   doubles are all refused by name.
4. Outcome tests: every RPC failure mode maps into the closed outcome set; no new outcome kinds.
5. Redaction tests: RPC errors containing key/api-key-shaped content never reach output.
6. e2e against a FAKE RPC double only — no live RPC in CI, ever.
7. The full existing simulation suite stays green with the new adapter ABSENT (the honest
   UNAVAILABLE default remains the package default).

## What this document does NOT authorize

- It does not authorize implementing `@soulmaker/txpreview` or any transaction construction.
- It does not authorize route resolution, live amounts, or any change to the unresolved-preview
  design of `simulation.intent.plan.v2`.
- It does not authorize Phase 7 (live/burner trading) in any form. Phase 7 requires: full Phase 6
  green, explicit human approval recorded in a future prompt, a separately-reviewed live package,
  a REAL kill switch implementation, real burner isolation (implementation, not spec), and the
  `DANGEROUS_BURNER_LIVE` opt-in flow — none of which exist. The readiness artifact's
  `phase7LiveTradingReady` literal stays `false` and its validator keeps refusing anything else.

## Decision record

- **Decision (S79):** design only. The existing adapter contract is already the correct seam; no
  production code change is needed or made for this sprint. The "clearly safe improvement inside
  the existing adapter contract" escape hatch was considered and declined: any change that makes
  the default adapter report anything other than honest UNAVAILABLE would misrepresent
  capability, and the contract itself needed no hardening (its tests already refuse hostile
  adapters).
