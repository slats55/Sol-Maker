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

## The V2/spec surface (Sprints 46–59) — additions to the same boundary

The V2 wave added a substantial machine-readable layer; **every** addition lives inside the same
boundary above and ships its own `*-safety.test.ts`. Additional invariants worth naming:

| # | Invariant | Enforced by |
| --- | --- | --- |
| 11 | Reason codes are emitted by the SAME branches that produce decisions — free-text `reasons` strings are NEVER parsed as logic (the v1→v2 adapters use structured fields only). | `paper-decision-v2.test.ts` (no-free-text-parsing proof), `run-report-v2.test.ts` |
| 12 | Policy v2 is tighten-only and fail-closed: mode contradictions are refused, and a v2-shaped policy on a v1 pipeline path is refused rather than silently weakened. | `policy-config-v2*.test.ts`, `commands.test.ts` |
| 13 | Safety gates v2 take allowances ONLY from the governing policy artifact; `neverAuthorizesPhase6` is a literal true the validator refuses to see weakened, and the boundary gate can only be `skip`. | `safety-gates-v2*.test.ts` |
| 14 | The Phase-6 tracker v2's hard invariants (`phase6ImplementationStarted=false`, `requiresExplicitHumanApproval=true`, `phase7LiveTradingReady=false`, `neverAuthorizesLiveTrading=true`) are validated at runtime AND literal-locked at the source level. | `phase6-prereqs-v2*.test.ts` |
| 15 | The kill-switch spec performs NO process control (its safety test additionally forbids `process.kill/exit/abort`, `child_process`, `SIG*` tokens) and its live mode is permanently `placeholder-disabled`. | `kill-switch-spec*.test.ts` |
| 16 | The secrets policy stores NO secret: secret-bearing keys and key-shaped values (64+ base58/hex, BIP39-shaped phrases) are refused without ever being echoed — at build time AND when re-validating a stored artifact. Its six core rules are literal-true constants. | `secrets-policy*.test.ts` |
| 17 | The burner isolation spec is NOT a wallet (its safety test additionally forbids `createWallet`/`importWallet`/`generateKey` tokens); loss bounds are LABELS — digits/currency markers are refused so no amount claim can ever be stored. | `burner-isolation-spec*.test.ts` |
| 18 | One NARROW, self-destructing exception exists in the package boundary scan: the single `SECRET_BEARING_KEY` detector line in `secrets-policy.ts` (which exists to REFUSE secrets) is excluded from the token scan; the exception throws if the declaration disappears. | `security-boundary.test.ts` |
| 19 | The documented command surface cannot drift: the registered `paper:sniper:*` / `paper:phase6:*` commands are pinned against a curated list and the runbook/README must cover all of them (and may not name ghost commands). | `cli-reference.test.ts` |

## The Phase 6 simulation surface (Sprints 61–70) — `@soulmaker/simulation`

Phase 6 work was explicitly authorized as **simulation only**, and it lives in a SEPARATE package
with a boundary deliberately narrower than the sniper package's. The dependency direction is
one-way (`simulation → sniper`, never the reverse), which is also why the chain audit and
readiness artifacts are named in the `phase6.*` family and live on the simulation side.

**The Phase 6 ↔ Phase 7 line, exactly:** Phase 6 may *plan previews* over validated paper
artifacts and *record* that a real dry-run is structurally impossible without transaction
material. Phase 7 (building, signing, or sending any transaction; any wallet or key handling; any
live or burner trading) is **not started, not authorized, and not reachable from this package** —
there is no code path, no adapter outcome, no artifact field, and no CLI flag that could express
it.

| # | Invariant | Enforced by |
| --- | --- | --- |
| 20 | The simulation package's imports are an ALLOWLIST: relative siblings, `@soulmaker/sniper`, `@soulmaker/security` — nothing else (no node builtins, no network, no `@solana/*`). A new capability module is refused by default. | `packages/simulation/src/no-forbidden-imports.test.ts` |
| 21 | No production source contains a signing/sending/key/secret token (`Keypair`, `Signer`, `secretKey`, `privateKey`, `mnemonic`, `sendTransaction`, `signTransaction`, `signAllTransactions`, `partialSign`, `sendRawTransaction`, `DANGEROUS_BURNER_LIVE`, `process.env`) — comments stripped, so the tokens exist ONLY in the refusal test. | `no-forbidden-imports.test.ts` |
| 22 | No production source contains a nondeterminism token (`Date.now`, `new Date`, `Math.random`, `randomUUID`, `randomBytes`); the e2e suite additionally proves two full runs are byte-identical. | `no-forbidden-imports.test.ts`, `apps/cli/src/simulation-e2e.test.ts` |
| 23 | The package manifest's dependency set is pinned to exactly `@soulmaker/sniper` + `@soulmaker/security` (`workspace:*`); any new dependency fails the boundary test. | `package-boundary.test.ts` |
| 24 | Every simulation artifact carries the four LITERAL safety locks — `neverAuthorizesLiveTrading` / `neverSigns` / `neverSends` / `dryRunOnly`, all `true` — from one frozen shared source, and every validator refuses a flipped or missing lock. | `package-boundary.test.ts` + every artifact's validator tests |
| 25 | The intent plan v2 is FAIL-CLOSED: a missing/invalid/v1 input, NOT-ready gates v2, unmet prereqs v2, a non-adopted spec, or a declared stop-simulation kill switch produces a BLOCKED plan with stable reason codes and ZERO entries (the validator refuses entries on a blocked plan). | `intent-plan.test.ts` |
| 26 | Previews NEVER invent values: destination/fee are always UNRESOLVED (`label: null` enforced by the validator), and an amount resolves only as an operator paper-unit LABEL — never currency, never route data. | `intent-plan.test.ts` ("never invents" suite) |
| 27 | The ONE narrow readiness override (`operatorAcknowledgedPaperEnterReview`) applies only when the single unmet prereq id is `NO_OPERATOR_BLOCKING` (a structured id, never prose), the decision actually has paper-enters, and zero unresolved unknowns exist — and an applied acknowledgment is loudly surfaced as a warning code the validator pairs with its field. | `intent-plan.test.ts` (refusal + coupling tests) |
| 28 | The dry-run adapter contract has NO sent/signed/live outcome to claim: outcomes are a closed 3-kind set, and anything else an adapter returns or throws (including a malicious "sent-live" claim) is NORMALIZED to a safe, redacted failure. | `result.test.ts` (malicious/throwing adapter tests) |
| 29 | An adapter is refused at runtime when its `neverSigns`/`neverSends` locks are missing/flipped or when ANY own property name is sensitive-shaped (key material cannot ride along on an adapter object). | `result.test.ts`, `adapter` validator tests |
| 30 | Nothing is ever simulated from unresolved previews: a result entry with unresolved fields can only be `skipped_unresolved` (validator-enforced), and the package default adapter reports a real dry-run honestly UNAVAILABLE — never faked. | `result.test.ts` |
| 31 | The kill switch blocks at BOTH layers: a declared stop-simulation state blocks the plan, and blocks again at result time even over a previously-clean plan. | `intent-plan.test.ts`, `result.test.ts`, e2e negatives |
| 32 | The chain audit validates all nine artifacts in place and cross-checks STRUCTURED references only (labels/counts/blocked states — never prose); v1 stand-ins and ref mismatches FAIL it, and it surfaces the chain's own conditions VERBATIM without ever waiving them. | `chain-audit.test.ts` |
| 33 | The readiness report's `phase7LiveTradingReady` is a LITERAL false — the validator refuses anything else, so this artifact is structurally incapable of claiming live-trading readiness; its evidence references are recorded as DECLARATIONS, never as verified claims. | `readiness.test.ts` |
| 34 | The simulation CLI cannot grow a hidden dangerous flag: every registered `paper:simulation:*` option name is scanned against a forbidden-token list (`--live`, `--send`, `--sign`, `--private`, `--mnemonic`, `--seed`, `--wallet`, `--dangerous`, `--bypass`, `--unsafe`, `--execute`). | `apps/cli/src/simulation-security.test.ts` |
| 35 | No simulation command echoes a secret: mnemonic-shaped and key-shaped values flowing through any command (labels, injected artifact fields, refusal messages) come out redacted or dropped. | `simulation-security.test.ts` |
| 36 | No simulation command writes by default; only `--out` writes, only the named file, overwrite refused without `--force`. | `simulation-commands.test.ts`, `simulation-e2e.test.ts` |
| 37 | The `paper:simulation:*` command surface is pinned against the curated reference list and must be documented in the runbook + README (no ghost commands). | `cli-reference.test.ts` |
| 38 | The fictional fixture chains are built ONLY through production sniper builders (they cannot drift from the code) and carry no secret-shaped key or value — verified by walking every key and string of every fixture and generated artifact. | `simulation-e2e.test.ts` (secret-hygiene suite) |

**Intentional exceptions, exactly two:** (a) the forbidden tokens are spelled out inside
`no-forbidden-imports.test.ts` itself — refusal-test context, the only place in the package allowed
to contain them; (b) `fixtures.ts` exports clearly-labeled FICTIONAL chains for tests/e2e — built
via production builders, no invented market claims, no secret-shaped values (invariant 38 scans
them on every run).

## The Phase 6 diff/handoff wave (Sprints 73–81) — additions to the same boundary

| # | Invariant | Enforced by |
| --- | --- | --- |
| 39 | The simulation diff chain (`simulation.intent.plan.diff.v2`, `simulation.result.diff.v1`) compares STRUCTURED FIELDS ONLY and refuses an invalid, tampered, or wrong-schema side outright — a flipped literal lock on either side refuses the whole diff; findings are stable `simulation-diff-*` codes whose exact emission sequence the validator recomputes. | `intent-plan-diff.test.ts`, `result-diff.test.ts` |
| 40 | The sniper run-report-v2 diff reuses the UNCHANGED v1 differ for its core (v1 semantics cannot drift), validates both sides as strict v2 (v1 artifacts refuse), and compares the v2 layers structurally — operator-blocking reasons move as VERBATIM opaque strings, never parsed. | `run-report-v2-diff.test.ts` |
| 41 | The handoff pack classifies a missing artifact as MISSING and an invalid one with its redacted error — state is never invented; the readiness verdict is carried verbatim and NULLED when the readiness artifact is invalid (a lock-flipped readiness input is never trusted); `phase7LiveTradingReady` is a validated literal false on the pack itself. | `handoff-pack.test.ts`, `simulation-e2e.test.ts` (S78) |
| 42 | Both decision-report validators (v1 + v2) RECOMPUTE the five per-decision tallies and the three verdict booleans from the verbatim entries — a corrupted `paperEnterCount` (or a hidden `hasPaperEnter`) refuses, and the corruption also fails the phase6 audit and blocks the intent plan downstream. | `decision-tally-hardening.test.ts`, `chain-audit.test.ts` (S77) |
| 43 | Every simulation formatter prints the shared operator safety line (`simulation only — does not sign; does not send; does not authorize live trading; Phase 7 … unauthorized`) from ONE constant, and a dedicated quality suite holds all seven formatters (good AND degraded states) to required/forbidden-language and no-secret-echo bars. | `operator-output-quality.test.ts` (S76) |
| 44 | The readiness bar is ten evidence areas (S80); an artifact built against the older five-area bar re-validates as INVALID and must be rebuilt — fail-closed, never silently trusted. | `readiness.test.ts` (S80 suite) |
| 45 | The dry-run boundary remains DESIGN ONLY: `docs/PHASE6_DRY_RUN_BOUNDARY.md` authorizes nothing, and a pinning test ties its claims to the code (the package default adapter stays the honest UNAVAILABLE one). | `dry-run-boundary-doc.test.ts` (S79) |
| 46 | The simulation package's production module list is PINNED — a new capability module appearing in `packages/simulation/src` fails the boundary test until consciously reviewed; the dependency allowlist stays exactly `@soulmaker/sniper` + `@soulmaker/security`. | `package-boundary.test.ts` (S81) |
| 47 | The dangerous-flag scan covers EVERY registered `paper:sniper:*` / `paper:phase6:*` / `paper:simulation:*` command (the whole paper-sniper lane), not just the simulation surface; the new diff/handoff commands carry secret-echo refusal tests of their own. (The strategy/backtest lane predates this scan and keeps its own audited surface — e.g. the paper-journal data flag `--seed-journal`, which is not key material.) | `simulation-security.test.ts` (S81) |

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
