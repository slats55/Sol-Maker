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
  plus a strictly-validated route-resolution artifact (designed and shipped as
  `simulation.route.resolution.v1` in Sprint 85 — see the section below; it carries its own
  provenance and validation, never operator-typed addresses accepted silently).
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

## The route-resolution artifact (Sprint 85) — the provenance layer, now designed and shipped

The first prerequisite above — "a separately-designed, validated route-resolution layer" — now
has its ARTIFACT layer: `simulation.route.resolution.v1`
(`packages/simulation/src/route-resolution.ts`). It is the schema/validator/formatter slice ONLY;
no resolver capability was built, on purpose:

- **What it records:** per intent-plan entry, whether a route / destination / fee fact exists
  (`resolved-as-label`) or is honestly `unresolved` — the exact facts the boundary diagram's
  "resolved plan entry" input needs to honestly exist before anything can be simulated.
- **What the canonical builder emits today:** every entry UNAVAILABLE under the fixed
  `unavailable-no-route-resolver` id, because no route-resolution capability exists inside the
  simulation boundary (and the import allowlist keeps it that way). Nothing is invented.
- **How a future resolver plugs in:** a separately-reviewed, separately-authorized resolution
  layer (it belongs with the `@soulmaker/txpreview` work, NOT in `@soulmaker/simulation`) would
  emit artifacts that pass the SAME strict validator with label-resolved facts. The validator then
  REQUIRES the explicit `liveStateCaveat` (plus its surfaced warning code), because real route
  facts can only come from live chain state — the determinism caveat above is now a validated
  schema fact, not just a design note.
- **Fail-closed invariants (all recomputed, never trusted):** `resolved` is refused while any
  required fact is missing; zero blocking codes over a blocking source state (missing / invalid /
  blocked plan, tripped stop switch) are refused; the v1 schema is CLOSED — unknown,
  sensitive-named, or execution-shaped fields are refused outright; the no-resolver id can never
  claim an attempt; an unattempted resolution can never carry resolved facts; and the artifact
  carries the four literal locks plus an always-false `phase7LiveTradingReady`.

What this changes about the boundary: nothing in capability, everything in honesty. The dry-run
boundary can now CONSUME a validated statement of what route state exists instead of guessing —
and today that statement is honestly "unavailable, everywhere". Implementing an actual resolver
remains unauthorized by this document.

### Sprint 86 — the artifact is now part of the operator path and the readiness bar

Two integration facts a future implementing session must account for (still no new capability):

- **Operators generate the artifact with `paper:simulation:route`** (from a validated
  `simulation.intent.plan.v2`; the CLI calls the canonical builder and can therefore only ever
  emit the all-UNAVAILABLE record — a blocked/invalid plan or a tripped stop switch yields a
  BLOCKED artifact). A future dry-run boundary must consume THIS artifact — strictly re-validated,
  with per-entry status checked — as its route-state input; it must never accept route facts from
  anywhere else, and an `unavailable`/`unresolved` entry means there is nothing truthful to
  simulate for it.
- **The Phase 6 readiness evidence bar now REQUIRES `route-resolution-tests`** (eleventh area,
  fail-closed: ten-area artifacts re-validate as INVALID). Declaring that evidence claims only
  that the route-resolution ARTIFACT layer is tested. It does NOT claim a resolver exists, and
  readiness stays structurally incapable of claiming live-trading readiness either way.

### Sprint 87 — the artifact is now an audited and handed-off chain role

Still no new capability — the route artifact in every audited/handed-off chain remains the honest
all-UNAVAILABLE record until a separately-authorized resolver exists:

- **`phase6.audit.report.v1` audits the route as its TENTH role** (S85 validator in place; a
  missing route is a warning, an invalid/tampered route fails the audit, a blocked route's
  reasons surface verbatim as chain conditions) and cross-checks the route's `sourcePlanRef`
  against the audited plan — a route built from a different plan is a blocking mismatch.
- **`phase6.simulation.handoff.pack.v1` hands the route off as its TWELFTH role** with a
  verbatim structured summary; a blocked route's codes carry into the pack's blocking conditions.
- Both bumps are CONSCIOUS fail-closed breaks: pre-S87 nine-role audits and eleven-role packs
  re-validate as INVALID and must be rebuilt over the current chain.
- A future implementing session inherits this shape: the dry-run boundary's route-state input is
  the strictly re-validated route artifact that the audit and handoff already carry — never a
  side channel.

### Sprint 88 — operator orchestration over the boundary; resolver assessment renewed

S88 added the operator layer ON TOP of the boundary without changing the boundary itself:

- **`paper:sniper:dry-run`** orchestrates the whole chain (candidate file → 19 artifacts +
  `RUN_SUMMARY.md`) through the existing command functions. The route step is the S85/S86
  canonical builder, so every orchestrated run records the honest all-UNAVAILABLE route artifact.
- **`phase6.operator.bundle.v1`** archives the chain (13 roles incl. the handoff pack) with the
  route status carried VERBATIM and per-file truncated `sha256-128` integrity digests.

**Resolver assessment (the S88 decision record):** Option 1 (a real read-only route/quote
resolver) was assessed and DECLINED for this sprint, on evidence:

- `@soulmaker/simulation`'s import allowlist (enforced by `no-forbidden-imports.test.ts`) admits
  only `@soulmaker/sniper` + `@soulmaker/security` — no network module can exist inside the
  boundary, by design. A resolver therefore requires a NEW, separately-scanned package and an
  explicit decision about its read-only RPC/quote surface.
- Live quotes are inherently non-deterministic; the byte-determinism bar that every simulation
  artifact and the new orchestrator meet today would need the S85 `liveStateCaveat` path
  (label-resolved facts + mandatory caveat + warning code), which EXISTS and is validated but has
  never been exercised by a real producer. That producer deserves its own sprint with the
  "required tests BEFORE any implementation lands" below, not a corner of this one.
- Option 2 is already fully real here: the adapter seam (`SimulationDryRunAdapter`,
  `UNAVAILABLE_DRY_RUN_ADAPTER`), the route artifact contract (resolved entries REQUIRE
  provenance and the caveat; nothing inventable), the operator CLI, audit/handoff/bundle
  carriage, and the orchestrator integration. The chain is resolver-ready; the route status stays
  honestly UNAVAILABLE rather than faked.

The smallest honest next step for a future authorized session: a separate read-only quote
package (no wallet, no signer, no transaction building, no send/swap/write) whose output enters
the chain ONLY as label-resolved route facts through `buildSimulationRouteResolutionV1`'s
existing resolved-entry contract, with the caveat machinery and the scans below in place on day
one.

### Sprint 89 — presentation only; the boundary is unchanged

S89 touched only how the boundary's honest states are EXPLAINED to the operator — no capability,
no schema, and no validator changed:

- The dry-run CLI and `RUN_SUMMARY.md` now phrase the route status per state: `unavailable` is
  the expected boundary outcome ("nothing was faked"), `blocked` means the plan blocked before
  resolution was attempted, `no_entries` means a watch-only plan had nothing to resolve.
- The web folder inspector renders the same per-status explanations on its dry-run landing
  overview, reading the status VERBATIM from the operator bundle.
- The shipped dress-rehearsal examples (`examples/sniper/operator-dress-rehearsal/`) document and
  test-pin all three statuses over the honest all-UNAVAILABLE builder.

The S88 resolver decision record below stands unchanged.

### Sprint 90 — input side only; the boundary is unchanged

S90 built the READ-ONLY INTELLIGENCE BRIDGE (`paper:sniper:preflight:input:prepare`) and the
Sniper Command Center UI. Both sit strictly on the INPUT and PRESENTATION sides of the boundary:

- The bridge converts already-captured `token:inspect` / `token:risk` JSON into the existing
  `sniper.preflight.input.v1` artifact — LOCAL file processing only; it adds no RPC surface, and
  the simulation boundary package still never touches a network.
- The command center renders the boundary's honest states (route boundary-only, live trading
  disabled/unauthorized) — it reads artifacts verbatim and invents nothing, including timing.
- No schema, validator, route builder, or capability changed. The route remains honestly
  all-UNAVAILABLE; the S88 resolver decision record and the S89 quote-package design stub below
  stand unchanged.

### Sprint 91 — the routequote package is now SHIPPED (Option A: operator-supplied files only)

S91 implemented the S89 stub's safe subset. What shipped, and how it maps to the stub:

- **Package:** `@soulmaker/routequote` exists (`packages/routequote/`), with its own
  forbidden-import scan (no fs/network/chain modules; `@soulmaker/simulation` explicitly
  forbidden) and capability-token scan from the same commit as the first source file. It was
  NEVER added to `@soulmaker/simulation`'s allowlist — the boundary package remains
  network-incapable, and the routequote package itself is ALSO pure (no network in v1).
- **Quote source:** Option A ONLY — operator-supplied observation files
  (`routequote.observation.input.v1`, one per candidate mint). The S89 stub's
  `resolveRouteQuote` RPC fetcher was deliberately NOT built: a live quote surface, even
  read-only, stays a future separately-authorized adapter (see the stub below, which remains the
  design of record for it). The closed outcome set shipped as
  `quote-observed | unavailable | blocked | error | unsupported` — nothing can mean executable.
- **Integration:** exactly the stub's seam. `paper:routequote:prepare` pairs observations to
  candidates BY MINT into `routequote.prepared.v1`; `paper:simulation:route --quotes` and
  `paper:sniper:dry-run --routequote` carry the validated facts into
  `buildSimulationRouteResolutionV1` as label-only facts under the
  `routequote-operator-supplied` provenance id. The `simulation.route.resolution.v1` SCHEMA IS
  UNCHANGED — the S85 validator already required exactly this shape (attempted resolver +
  label-resolved facts + the mandatory live-state caveat), so every pre-S91 artifact stays valid.
- **Honesty invariants, all test-pinned:** no quotes → the all-UNAVAILABLE default is
  byte-identical to pre-S91; a quotes file that contradicts the plan/candidates REFUSES; a
  blocked chain never applies facts (quotes can never unblock anything); destination facts stay
  null in v1 (a quote validates no destination, so a quote alone can never produce a fully
  `resolved` artifact); every observed quote carries the mandatory caveat set verbatim.
- **Determinism stance held:** quote files are operator inputs; the dry-run chain stays
  byte-deterministic for a fixed input set; CI uses fictional fixture quote files only
  (`examples/sniper/routequote-rehearsal/`).

### Sprint 89 assessment — design stub for the read-only quote FETCHER (fetcher NOT implemented)

S89 re-inspected the S88 decision record with all gates green and confirms: the smallest safe next
step remains a NEW package, and it is deliberately NOT built in a milestone-polish sprint (a live
RPC surface, even read-only, deserves its own sprint with the day-one scans below). This stub
pins the shape so a future authorized session starts from a decided design instead of a blank
page:

- **Package:** `@soulmaker/routequote` (own folder, own import-allowlist scan; NEVER added to
  `@soulmaker/simulation`'s allowlist — the boundary package must stay network-incapable).
- **Single export surface:** `resolveRouteQuote(input: RouteQuoteInput): Promise<RouteQuoteOutcome>`
  where `RouteQuoteOutcome` is a CLOSED union: `quoted` (route label, venue label, fee label,
  observed-at LABEL — no system time), `unavailable`, `refused-by-kill-switch`, `rpc-error`
  (redacted), `unsupported-pair`. No streaming, no caching, no retries in v1.
- **Capability ceiling, enforced by scans:** read-only quote/route lookup ONLY. No
  wallet/keypair/signer types, no transaction building, no `sendTransaction`/`simulateTransaction`
  call, no write RPC method anywhere in the package. The S43-style forbidden-token source scan and
  a refusal test for write-method-bearing RPC doubles land in the SAME commit as the first source
  file.
- **Integration point (already shipped):** output enters the chain ONLY as label-resolved facts
  through `buildSimulationRouteResolutionV1`'s existing resolved-entry contract — `resolved`
  entries REQUIRE provenance plus the mandatory `liveStateCaveat` and its warning code. The CLI
  seam is a new optional `--quotes <path>` input file (operator runs the quote command separately;
  the simulation boundary still never touches the network), NOT an in-process adapter injection.
- **Determinism stance:** live quotes are non-deterministic by nature, so quote output is an
  OPERATOR INPUT FILE (like `token:inspect` output is today) — the dry-run chain stays
  byte-deterministic for a fixed input set; CI uses fictional fixture quote files only.
- **Not authorized by this stub:** any CLI that reaches RPC for quotes, or any change to the
  honest all-UNAVAILABLE default. (S91 shipped the package and the operator-supplied-file path —
  see the Sprint 91 section above; the RPC FETCHER remains future work that requires a session
  explicitly taking it on with the "required tests BEFORE any implementation lands" section.)

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
