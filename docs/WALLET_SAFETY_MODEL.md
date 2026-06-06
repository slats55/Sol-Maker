# Soulmaker Wallet Safety Model

This document defines how Soulmaker handles (and mostly *refuses to handle*) keys
and funds. It implements the rules in [`SECURITY.md`](../SECURITY.md).

## Core principles

1. **Default to no custody.** `PAPER` and `WATCH_ONLY` need **no** private key at
   all. The vast majority of the bot's life is spent here.
2. **Public keys are not secrets.** Watching addresses, balances, and pools needs
   only public keys — never a private key or seed.
3. **Seeds never exist in Soulmaker.** There is no code path that accepts a
   mnemonic / recovery phrase, and there must never be one. (Reference bots that
   import seeds via `bip39`/`ed25519-hd-key` are explicitly *not* a model to copy
   — see [`REFERENCE_REPO_AUDIT.md`](REFERENCE_REPO_AUDIT.md).)
4. **Live = burner only, tiny funds, hard caps.** A full compromise must cost
   only what is in a throwaway burner.

## Modes (safest → most dangerous)

| Mode | Needs a key? | Reads chain | Builds tx | Simulates | **Sends** |
| --- | --- | --- | --- | --- | --- |
| `PAPER` (default) | no | no | no | no | no |
| `WATCH_ONLY` | no (pubkeys) | yes | no | no | no |
| `SIMULATION` | no | yes | yes | yes | **no** |
| `DANGEROUS_BURNER_LIVE` | burner secret | yes | yes | yes | **yes** |

Capabilities are defined in `packages/core/src/modes.ts`. Only
`DANGEROUS_BURNER_LIVE` has `canSend: true`.

## The live-mode gate (fail-closed)

Before *any* future signing/sending code runs, it must pass
`assertLiveModeAllowed(config, env)` (`packages/core/src/live-gate.ts`). The gate
returns the **complete list** of failing reasons and refuses unless **all** hold:

1. `mode === "DANGEROUS_BURNER_LIVE"`.
2. `killSwitch === false`.
3. `live.acknowledgeBurnerRisk === true` — operator acknowledges total-loss risk.
4. `live.confirmFreshBurner === true` — operator confirms a fresh throwaway
   wallet.
5. `live.burnerKeyEnvVar` is set **and** that environment variable is present.
6. Out-of-band env flag `SOULMAKER_I_UNDERSTAND_BURNER_RISK === "true"`.
7. Caps within the hard limits (`HARD_LIMITS`).

Why a separate out-of-band env flag (#6) **and** config flags (#3–#5)? So that
arming live mode requires editing **two different surfaces** (a committed-style
config *and* the live environment). Neither alone is enough. A leaked or
copy-pasted config cannot, by itself, enable sending.

## Phase 2: read-only access uses PUBLIC KEYS ONLY

The Phase 2 Solana layer (`@soulmaker/solana`) reads public chain state and
**never touches secret material**:

- Every key it accepts is a **public** key. `parsePublicKey` validates 32-byte
  public keys and **refuses secret-length input** — anything longer than a
  44-char public key (e.g. an ~88-char base58 secret key) is rejected with
  "Refusing (never paste a private key or seed phrase)". You cannot paste a
  private key into `wallet:watch` / `token:inspect` / `token:accounts` and have
  it silently accepted.
- The read-only client is a **frozen** object exposing only read methods. There
  is no `sendTransaction`, `signTransaction`, `requestAirdrop`, or signer on it
  (asserted by tests). No secret key is ever held, logged, or required.
- These commands require **no** burner/live environment variables. They are
  gated on `capabilitiesFor(mode).canReadChain` and refuse in `PAPER` mode unless
  the operator passes `--allow-paper-read` (an explicit, documented opt-in to
  read chain while otherwise fully simulated).
- RPC endpoints are shown as **host only**; any `?api-key=` is dropped and output
  is redacted as a backstop. An RPC URL is config, not a wallet secret.

## Phase 3 (Sprint 3): the risk engine is read-only and mint-only

The Phase 3 risk engine (`@soulmaker/risk` + the `token:risk` command) stays
fully within the read-only model:

- It consumes only **public** data: a token **mint** public key and the read-only
  facts `@soulmaker/solana` already collects (decimals, supply, authorities
  present/absent, program, initialized), plus operator allow/deny/previously-
  traded **lists of public mints**. **No wallet secret is needed or accepted.**
- The mint argument is validated by the same `parsePublicKey` that **refuses
  secret-length input**, so a private key or seed cannot be pasted into
  `token:risk` and silently accepted.
- `@soulmaker/risk` is a **pure** package: no signer, no keypair, no transaction
  building/signing/sending, no file I/O, no network. The CLI reads any list files
  and hands their text to the pure parser.
- `token:risk` is gated exactly like the other read commands
  (`capabilitiesFor(mode).canReadChain`, `--allow-paper-read` for PAPER) and
  requires **no** burner/live environment variable. Output is redacted as a
  backstop (human and `--json`), so an RPC `?api-key=` can never leak.
- The report is **advisory only**. `PASS_FOR_PAPER_EVALUATION` permits only
  *paper-trading* evaluation later — it is never a live-trading judgment and
  never authorizes a send.

## Phase 4 (Sprint 4): paper trading is simulated and key-free

The Phase 4 paper engine (`@soulmaker/paper` + the `paper:*` commands) stays
entirely within the no-custody model:

- It is **simulated only**. No transaction is built, signed, simulated, or sent;
  nothing is wired to execution. Paper trading does **not** imply live-trading
  readiness.
- It accepts **no** private key, seed, or wallet secret — and there is no code
  path that could. `@soulmaker/paper` is a **pure** package: no signer, no
  `Keypair`, no `@solana/web3.js`, no RPC, no network, no filesystem, no
  DEX/execution SDK.
- Inputs are local, **injected** fixtures (candidate + price JSON) and an
  append-only JSONL journal. Prices are simulated; **paper PnL is not real market
  performance.**
- The CLI owns file I/O and redacts all output (human and `--json`), so an RPC
  `?api-key=` in a config can never leak into a paper report.
- The `--kill-switch` flag is OR-ed with the core config `killSwitch`, so the
  global emergency stop also halts simulated trading.
- A risk `PASS_FOR_PAPER_EVALUATION` only makes a token **eligible for paper
  evaluation** — never "safe", "approved for live trading", "profitable", or a
  reason to send anything.

## Phase 5 (Sprints 5–10): the strategy engine is paper-only and key-free

The Phase 5 strategy engine (`@soulmaker/strategy` + the `strategy:evaluate` and
`strategy:plan` commands) stays entirely within the no-custody model:

- It only **decides** whether a candidate becomes a *simulated* paper buy/sell
  candidate, and its output **only feeds `@soulmaker/paper`.** It performs no
  simulated fill, and it **does not** build, sign, simulate, or send a
  transaction; nothing is wired to execution.
- It accepts **no** private key, seed, or wallet secret — and there is no code
  path that could. `@soulmaker/strategy` is a **pure** package: no signer, no
  `Keypair`, no `@solana/web3.js`, no RPC, no network, no filesystem, no
  `Date.now`, no `Math.random`. A **forbidden-import regression test** enforces
  this at the source level.
- Inputs are local, **injected** JSON (candidate(s) + config, optional
  paper-state). The CLI owns file I/O and redacts all output (human, `--json`,
  and the `strategy:plan --out` file), so an injected secret-looking value can
  never leak.
- **Sprint 6 — batch planning (`strategy:plan`)** stays inside the same model: it
  turns an injected candidate **list** into a `PaperCandidate[]` an operator may
  **manually** hand to `paper:run`. It produces a **plan only** — it never
  auto-runs paper trades, never creates fills, and never writes a journal — and
  it remains key-free, offline, and injected-data-only. It does **not** begin
  transaction planning/simulation (roadmap Phase 6), which is **not started**.
- **Sprint 7 — journal-aware planning + richer exits** stays inside the same
  model. `strategy:plan --journal <path>` reads a paper journal **read-only** to
  derive the simulated portfolio: it **never writes, truncates, or mutates** the
  journal, never creates fills, and never runs `paper:run`. The richer exit rules
  (trailing stop, partial take-profit, position-aware sizing) act on **injected**
  metrics and a simulated position size only; they produce **simulated paper**
  sell candidates, never a real order, signer, or send. Still no key, seed,
  wallet, RPC, network, or transaction.
- **Sprint 8 — journal-continuing runs + deterministic backtest** stays inside the
  same model. `paper:run --journal` continuing from an existing journal, and the
  new `@soulmaker/backtest` / `paper:backtest` replay, both read **injected local
  data only** and only ever drive the **simulated** paper engine. They hold **no**
  key, seed, wallet, signer, `Keypair`, RPC, or network, and build/sign/simulate/
  send **no** transaction; `@soulmaker/backtest` is a **pure** package with its own
  forbidden-import regression test. The backtest report uses injected historical
  data only and is explicitly **not a live result, not a profitability claim, and
  not advice**. None of this begins transaction planning/simulation (roadmap Phase
  6) or live sending (Phase 7), which remain **not started**.
- **Sprint 9 — scenario linting, examples, report stability + BOM-tolerant JSON**
  stays inside the same model. The new scenario validator/linter
  (`validateBacktestScenario` / `lintBacktestScenario`, CLI `paper:backtest:lint`)
  is a **pure** inspector that **never runs** the backtest, never mutates input,
  and holds no key/seed/wallet/signer/RPC/network. The richer report fields
  (`schemaVersion`, `scenarioDigest`, `equityCurve`, `perMint`, `warnings`) are
  bookkeeping over **injected** prices — the `scenarioDigest` is a non-cryptographic
  reproducibility hash, **not** a security/anti-tamper guarantee. `paper:backtest
  --seed-journal <path>` only **reads** an external JSONL journal (never writes it)
  and never modifies the scenario file. BOM tolerance strips at most one leading
  UTF-8 BOM before parsing — it does not relax validation. The
  [`examples/backtest/`](../examples/backtest/) scenarios are **injected fixtures**,
  not real market data, and carry no key/secret/real wallet. None of this begins
  transaction planning/simulation (Phase 6) or live sending (Phase 7).
- **Sprint 10 — report diffing + scenario helpers** stays inside the same model.
  `paper:backtest:diff` only **reads** two existing report JSON files (it writes
  nothing, runs no backtest, reads no scenario) and emits bookkeeping deltas over
  two **simulations** — explicitly not a prediction, profit/loss, or advice. The
  scenario builders (`paper:backtest:scenario:new`/`:matrix`) write only INJECTED
  scenario files of **fake** mints + injected prices (never a real token, key, seed,
  or wallet); the pure builders hold no key/seed/wallet/signer/RPC/network and the
  matrix patch system is config-only (no code, no `steps`/`name`/`initialJournal`).
  `@soulmaker/backtest` stays a **pure** package (its forbidden-import regression
  test covers the new modules). None of this begins transaction
  planning/simulation (Phase 6) or live sending (Phase 7), which remain **not
  started**.
- **Sprint 11 — backtest suites + suite diffing** stays inside the same model. The
  pure `@soulmaker/backtest` suite layer (`runBacktestSuite`/`buildBacktestSuiteIndex`/
  `diffBacktestSuites`) **never scans a directory or reads/writes a file** — the CLI
  (`paper:backtest:suite`, `paper:backtest:diff:suite`) owns all I/O and only reads
  injected local `*.scenario.json` files / `suite-index.json` files. A suite run
  writes **only** redacted report JSON + `suite-index.json` under an explicit
  `--out-dir` (never a journal, fills, key, seed, or wallet; preflighted so it never
  writes partial output and refuses to overwrite without `--force`); a suite diff
  writes **nothing**. Every suite total/delta is simulated bookkeeping over injected
  prices — not a live result, advice, or a profitability claim. The forbidden-import
  regression test covers the new `suite*.ts` modules, and none of this begins
  transaction planning/simulation (Phase 6) or live sending (Phase 7), which remain
  **not started**.
- The report is **paper-only** and explicitly **not** financial advice, a buy
  recommendation, or live-trading authorization; it makes no profitability claim.
  A `PAPER_BUY_CANDIDATE` means a candidate for *simulated* paper evaluation.

## Key handling rules (for when Phase 7 arrives)

- The config stores only the **name** of the env var holding the burner key
  (`live.burnerKeyEnvVar`), **never** the key. The key is read **at send time**,
  used to sign, and never persisted, returned, or logged.
- The key value is treated as radioactive: it is never put into any object that
  gets logged. The redaction layer is a backstop, not the primary defense — the
  primary defense is *not handing the key to loggable structures at all.*
- Preferred long-term storage: an **OS keychain**, not `.env`. `.env` is the
  acceptable interim for a burner with trivial funds.
- A burner key generator (later) will print **only the public key** to the
  terminal and write the secret straight to the keychain/env — never echoing it.

## Destinations & transfers

- **No hidden transfers.** Every destination account in a future transaction plan
  is explicit and shown in the human-readable preview.
- **No developer fee, referral skim, or "tip to unknown address."** If a fee or
  tip account is ever added, it is named, documented here, and visible in the
  preview before signing.
- Reference bots that contain referral/affiliate behavior are a reason to
  **reject** that code, not adopt it.

## What Soulmaker will never do

- Accept or derive from a seed phrase.
- Use the operator's main wallet.
- Auto-approve transactions or sign without a rendered plan.
- Send to an address the operator hasn't seen in the preview.
- Log, transmit, or persist a private key or seed.
- "Sweep," "migrate," or "consolidate" funds to any address on its own.
