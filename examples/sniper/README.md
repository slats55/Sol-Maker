# Sniper examples (PAPER-only, deterministic fixtures)

> **These are deterministic FIXTURES — NOT live data, NOT trading results, NOT financial advice.**
> The mints in `candidates.example.json` are real, well-known public token mints used purely as
> offline, copyable examples. Every liquidity / market-cap / volume / observed value is a made-up
> operator-supplied number and is **NOT verified on-chain**. Nothing here builds, signs, simulates, or
> sends a transaction; nothing here is a trade signal.

## Candidate intake (Sprint 25)

A sniper bot needs a safe, validated INTAKE layer before it can score, paper-simulate, or (much later,
behind heavy safety work) act on a token. `candidates.example.json` is an operator-authored candidate
list. Validate + normalize it with:

```bash
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json
# JSON (the normalized canonical sniper.candidate.list.v1):
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json --json
# Treat any warning (e.g. a duplicate mint) as a CI failure:
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json --fail-on-warning
```

The command validates every `mint` as a 32-byte Solana **public** key — secret-length /
private-key-like input is **refused** — requires unique `candidateId`s, and surfaces duplicate mints
as warnings. It reads the named file only and **writes nothing**. The list's optional context fields
(`symbol`, `name`, `sourceTag`, `observedLiquidityUsd`, …) are operator-supplied and are **not**
verified on-chain by this step — a later read-only preflight does that.

### Candidate list shape (operator-friendly raw input)

```json
{
  "sourceLabel": "my-watchlist",
  "candidates": [
    { "candidateId": "c1", "mint": "<32-byte base58 mint>", "symbol": "ABC", "sourceTag": "manual" }
  ]
}
```

Only `candidateId` and `mint` are required per candidate. A `schemaVersion`, if present, must be
`sniper.candidate.list.v1`.

## Token preflight (Sprint 26)

The preflight combines each candidate's mint validity with **already-loaded** read-only inspection and
advisory risk data into a `pass` / `warn` / `fail` / `unknown` status. It performs **no on-chain reads
itself** — you produce the inputs with the existing read-only commands and feed them in as local files
(this repo ships no fabricated on-chain facts about real mints):

```bash
# 1) Produce the read-only inputs per candidate (operator-run; token:inspect uses read-only RPC):
pnpm soulmaker token:inspect <mint> --json > example-usdc.inspect.json
pnpm soulmaker token:risk <mint> --json > example-usdc.risk.json

# 2) Preflight the candidate list against those local files (--inspection/--risk are candidateId=path):
pnpm soulmaker paper:sniper:preflight \
  --candidates candidates.example.json \
  --inspection example-usdc=example-usdc.inspect.json \
  --risk example-usdc=example-usdc.risk.json

# JSON / write / CI gates:
pnpm soulmaker paper:sniper:preflight --candidates candidates.example.json --risk example-usdc=example-usdc.risk.json --json
pnpm soulmaker paper:sniper:preflight --candidates candidates.example.json --risk example-usdc=example-usdc.risk.json --out preflight.json
pnpm soulmaker paper:sniper:preflight --candidates candidates.example.json --risk example-usdc=example-usdc.risk.json --fail-on-fail
```

A candidate with no `--inspection` and no `--risk` is reported as `unknown` (it could not be assessed).
A risk `REJECT` or a critical flag is a `fail`; a `CAUTION`, a freeze/mint authority, or a high-severity
flag is a `warn`. The preflight reads the named files only and **writes nothing** unless `--out` is
given. A `pass` means "no preflight concern was found in the supplied data" — it is **not** a "safe to
trade" judgment and **not** a trade signal.
