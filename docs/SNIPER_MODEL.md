# Soulmaker Sniper Model (PAPER-only, offline)

This document describes the **sniper decision-support** path: the safe, deterministic, offline layers
a Solana sniper bot needs **before** any live capability exists. It is the product direction the
research/PAPER foundation has been building toward — candidate intake → token preflight → paper-only
decisions → operator workflow → (much later, behind heavy safety work) a simulation boundary and only
then any live/burner trading.

> **Everything here is PAPER-only and offline.** Nothing in `@soulmaker/sniper` holds a wallet, key,
> seed phrase, signer, or keypair; nothing builds, signs, simulates, or sends a transaction; nothing
> places an order or trades live. A sniper "decision" (later sprints) is a **simulated/paper** decision
> only. Phase 6 (transaction planning/simulation) and Phase 7 (burner/live trading) are **not started**.

## Why a separate `@soulmaker/sniper` package

The sniper path is its own domain, distinct from the backtest/research stack. It lives in a new pure
package `@soulmaker/sniper` (deps: only `@soulmaker/security` today) so it can be reused by the CLI
without polluting the backtest package. Crucially, the package carries **no chain capability**: it does
**not** import `@solana/web3.js` or `@soulmaker/solana`. A forbidden-import regression test enforces
this. Any read-only on-chain inspection (a later preflight sprint) is done by the CLI using existing
read-only utilities and passed into the pure builders as already-loaded data — the pure modules never
do I/O, network, or RPC themselves.

## The product path

1. **Candidate intake** (Sprint 25 — implemented) — a validated local list of candidate mints.
2. **Token preflight** (Sprint 26 — planned) — a read-only safety/research summary per candidate,
   reusing existing read-only Solana inspection + advisory risk code; never a trade signal.
3. **Paper-only decisions** (Sprint 27 — planned) — candidate list + preflight/risk + strategy rules →
   a simulated `skip` / `watch` / `paper-enter` / `paper-reject` decision per candidate, with reasons.
4. **Operator workflow** (Sprint 28 — planned) — fixtures + a runbook tying the path together.
5. **Phase 6 simulation boundary** (Sprint 29 — spec only, no implementation).
6. **Simulation engine**, then **burner/live** — only after heavy, explicit safety work.

## Candidate intake (Sprint 25)

A sniper bot needs a safe, validated INTAKE layer before it can score, paper-simulate, or act on a
token. `@soulmaker/sniper` provides it as a pure, deterministic, offline module.

### Schema — `sniper.candidate.list.v1`

A candidate list carries the PAPER-ONLY banner + disclaimers, an optional `sourceLabel`, a
`candidateCount`, the `candidates` array (in input order — operator priority is data), the derived
`distinctMints` / `duplicateMints`, and `warnings` / `notes`. Each **candidate** supports:

- `candidateId` (required, unique) and `mint` (required, validated 32-byte Solana public key);
- optional `symbol`, `name`, `sourceTag`, `sourceNote`;
- optional operator-OBSERVED `observedLiquidityUsd`, `observedMarketCapUsd`, `observedVolumeUsd`
  (non-negative numbers — **operator-supplied, NOT verified on-chain here**);
- optional `socialRefs` (plain strings — **never fetched**);
- optional `observedAtLabel` / `createdLabel` (operator-supplied **strings**, never system time);
- `tags` and `operatorNotes` (string arrays).

### APIs (`@soulmaker/sniper`)

- `normalizeSniperCandidateList(input)` — build a canonical, byte-stable list from operator-friendly
  raw input (`{candidates: [...]}`, with or without a `schemaVersion`). Validates every mint, enforces
  unique candidate ids, surfaces duplicate mints as warnings, fills optional fields to explicit
  `null` / `[]`, and preserves input order. Pure, non-mutating, and **idempotent**.
- `validateSniperCandidateList(value)` — strict backstop validator for a canonical list read from disk.
- `formatSniperCandidateList(list)` — redacted, stable, human-readable rendering.
- `parseMintAddress(input)` / `isValidMintAddress(input)` — pure base58 mint validation (no
  `@solana/web3.js`), mirroring `@soulmaker/solana`'s safety semantics: a valid 32-byte public key
  base58-encodes to 32–44 chars; **anything longer is refused before decoding** (a 64-byte secret key
  base58-encodes to ~88 chars), and the too-long error never echoes the input.
- `SniperCandidateListError`, `InvalidMintAddressError`, and the schema/banner/disclaimer constants.

### Safety rules enforced

- A mint must decode to **exactly 32 bytes** of valid base58; secret-length / private-key-like input is
  **refused** (and never echoed back).
- `candidateId`s must be **unique** (a duplicate id is refused).
- Duplicate **mints** are allowed (the same mint may be observed from two sources) but surfaced as a
  **warning** (and listed in `duplicateMints`).
- An empty list is refused by default (`allowEmpty` opts in).
- Inputs are never mutated; output is deterministic and carries **no wall-clock time**.

### CLI — `paper:sniper:candidates:validate`

```bash
pnpm soulmaker paper:sniper:candidates:validate --input <candidates.json>
pnpm soulmaker paper:sniper:candidates:validate --input <candidates.json> --json
pnpm soulmaker paper:sniper:candidates:validate --input <candidates.json> --fail-on-warning
```

Reads only the named local file (BOM-tolerant). If the file carries a `schemaVersion`, it must be
`sniper.candidate.list.v1` (so the command can't be pointed at, say, a portfolio report). It validates
and normalizes, prints a human summary by default or the canonical list with `--json`, and exits 1 on
malformed JSON / wrong schema / unsafe key-like input (or on any warning with `--fail-on-warning`). It
**writes nothing**, makes no network / RPC call, and touches no wallet. A worked example lives in
[`examples/sniper/`](../examples/sniper/README.md).

## What is intentionally NOT here yet

- **No on-chain verification** of a candidate's liquidity / market cap / volume / authorities — that is
  the read-only preflight (Sprint 26).
- **No scoring or decision** — that is the paper decision pipeline (Sprint 27).
- **No transaction planning / signing / sending / wallet / burner** — Phases 6 and 7, not started.
