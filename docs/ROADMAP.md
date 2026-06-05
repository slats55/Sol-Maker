# Soulmaker Roadmap

Phased, safety-gated plan. Each phase must be **tested and green** before the
next begins. Live trading does not appear until Phase 7, behind every gate in
[`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md).

Legend: ✅ done · 🟡 in progress · ⬜ not started

---

## Phase 0 — Repository foundation & audit ✅

- ✅ Strict TypeScript pnpm monorepo.
- ✅ Core docs: `README.md`, `SECURITY.md`, `docs/ROADMAP.md`,
  `docs/ARCHITECTURE.md`, `docs/WALLET_SAFETY_MODEL.md`, `docs/RISK_MODEL.md`,
  `docs/REFERENCE_REPO_AUDIT.md`.
- ✅ `.env.example`, `.gitignore`, example config.
- ✅ `test` / `lint` / `typecheck` scripts.
- ✅ Secret redaction utility (`@soulmaker/security`).
- ✅ Config schema (`@soulmaker/core`, Zod).
- ✅ Initial CLI skeleton (`@soulmaker/cli`).
- ✅ No live trading.

## Phase 1 — Safety foundation ✅

- ✅ Config loader with Zod (`loadConfig`).
- ✅ Mode system: `PAPER`, `WATCH_ONLY`, `SIMULATION`, `DANGEROUS_BURNER_LIVE`.
- ✅ Live-mode gate (`evaluateLiveGate` / `assertLiveModeAllowed`, fail-closed).
- ✅ Max trade size, daily loss cap, max open positions, kill switch (schema).
- ✅ Redacted logger.
- ✅ Tests: secrets are redacted; live mode refuses unsafe config; schema
  rejects missing/unsafe live config.

> Phases 0 and 1 are implemented in this commit. Everything below is planned.

## Phase 2 — Solana read-only watcher 🟡 (read-only core complete)

Implemented in `@soulmaker/solana` + the CLI (Sprint 2):

- ✅ Read-only RPC abstraction over `@solana/web3.js`: health, version, SOL
  balance, SPL token accounts (classic + Token-2022), token mint info.
- ✅ Read-only wallet / public-key monitor (`wallet:watch`, `token:accounts`).
- ✅ Token mint inspection (`token:inspect`): decimals, supply, mint authority
  present, freeze authority present, initialized — feeds Phase 3.
- ✅ Public-key validation that **refuses secret-length input** (no private keys).
- ✅ CLI: `solana:doctor`, `wallet:watch`, `token:inspect`, `token:accounts`,
  PAPER-gated with an explicit `--allow-paper-read` override.
- ✅ Deterministic, offline (mocked-RPC) tests; optional live mainnet smoke
  verified manually (read-only).
- ✅ **No live sends. No signer. No key custody.** The client exposes only read
  methods and is a frozen object (a send method cannot be bolted on).
- ⬜ WebSocket streaming + live pool/token-launch **event** abstraction
  (deferred to a later read-only sprint / folded into Phase 3 inputs).

## Phase 3 — Filter & risk engine 🟡 (read-only advisory engine complete)

Implemented in `@soulmaker/risk` + the CLI (Sprint 3):

- ✅ Read-only, advisory **risk flags** from `@soulmaker/solana` mint facts:
  denylisted mint, mint not initialized, freeze authority present (critical);
  mint authority present, unknown token program, suspicious decimals (high);
  supply unparsable, zero supply, previously-traded mint (medium); unknown
  authority/initialization (low); allowlisted, renounced authorities, standard
  SPL / Token-2022 program (info). Deterministic, fully offline-tested.
- ✅ **Allowlist / denylist / previously-traded** support: pure list parser
  (ignores blanks + `# comments`, case-preserving, dedupes); CLI file options.
- ✅ **Advisory score** (0–100, clamped) + decision
  (`REJECT` / `CAUTION` / `PASS_FOR_PAPER_EVALUATION`) with documented weights and
  thresholds. `PASS_FOR_PAPER_EVALUATION` is **not** a live-trading judgment.
- ✅ CLI: `token:risk <mint>` (`--allow-paper-read`, `--allowlist`, `--denylist`,
  `--previously-traded`, `--json`). Read-only; advisory; not a buy recommendation.
- ✅ **No tx build/sign/send. No key custody. No execution SDKs.** Every flag is
  explained; output is redacted as a backstop.
- ⬜ Off-chain / pool-derived flags (metadata mutable, socials, pool size, LP
  burn/lock, deployer denylist) — deferred (need data not available read-only yet).

## Phase 4 — Paper trading engine 🟡 (deterministic simulated engine complete)

Implemented in `@soulmaker/paper` + the CLI (Sprint 4):

- ✅ Simulated buy/sell against **injected** prices (weighted-average positions,
  realized + unrealized PnL). No chain, no wallet, no transaction.
- ✅ TP/SL: percent thresholds over the injected price series; trigger event
  always precedes the simulated sell fill.
- ✅ Append-only JSONL **trade journal** (malformed lines skipped + counted;
  state reconstructable via `reduceJournal`).
- ✅ PnL report (realized/unrealized/total, open/closed counts, rejections,
  simulated notional) — human + stable JSON, redacted, always "PAPER ONLY".
- ✅ Risk integration: only `PASS_FOR_PAPER_EVALUATION` may enter a paper buy;
  `CAUTION` blocked by default; missing report ⇒ treated as `REJECT`.
- ✅ Caps + kill switch enforced **before** every simulated action (CLI
  `--kill-switch` OR-ed with the core config kill switch).
- ✅ CLI: `paper:run`, `paper:journal`, `paper:status` (real, replacing the stub).
- ✅ Deterministic (seeded ids + injected clock), fully offline tests.
- ⬜ Snipe-list **ingestion** wiring (candidates are supplied as fixtures today;
  a live snipe-list source is a later sprint). Still **no real sends**.

## Phase 5 — Strategy rules engine 🟡 (deterministic, paper-only — complete)

Implemented in `@soulmaker/strategy` + the CLI (Sprint 5):

- ✅ Deterministic, **paper-only** rules engine: turns an advisory
  `@soulmaker/risk` report + injected, read-only metrics into a single decision —
  `SKIP` / `WATCH` / `PAPER_BUY_CANDIDATE` / `PAPER_SELL_CANDIDATE` — that feeds
  `@soulmaker/paper` **only**.
- ✅ **Risk gate:** `REJECT` ⇒ always `SKIP`; `CAUTION` ⇒ `SKIP` unless
  `allowCaution`; risk score above `maxRiskScore` ⇒ `SKIP` (never bypassable).
- ✅ **Metric gates** (when configured): liquidity / volume minimums and a max
  absolute price-change band; a configured-but-missing metric is a disqualifier.
- ✅ **Cooldowns:** post-loss ⇒ `SKIP`; post-trade ⇒ capped to `WATCH`.
- ✅ **Position awareness:** `maxOpenPositions` and `maxPositionConcentrationPct`
  block a new paper buy (cap to `WATCH`); held positions run take-profit /
  stop-loss exit rules (`PAPER_SELL_CANDIDATE`).
- ✅ **Score** (0–100, clamped) with documented constants; **disqualifiers always
  override the score** — a high score can never bypass a hard disqualifier.
- ✅ Stable reason/disqualifier ids; injected clock + seeded id ⇒ deterministic,
  no-mutation; fully offline tests.
- ✅ CLI: `strategy:evaluate` (`--candidate`, `--config`, `--paper-state`,
  `--json`). Reads injected local JSON only; refuses missing/malformed input
  cleanly; redacted output; PAPER-ONLY / not-advice disclaimers.
- ✅ **No tx build/sign/simulate/send. No wallet, RPC, network, or execution SDK.
  No `Date.now` / `Math.random`.** Output is not advice and makes no profitability
  claim.
- ⬜ Live snipe-list ingestion + richer position management (deferred).

## Phase 6 — Transaction planning & simulation ⬜

- ⬜ Transaction **plan** object (explicit destinations, amounts, fees).
- ⬜ Human-readable preview (no blind signing).
- ⬜ Simulation interface (`simulateTransaction`).
- ⬜ **Still no sending.** Tests prove unsafe plans are rejected.

## Phase 7 — Burner-wallet live mode ⬜

- ⬜ Only after Phases 0–6 are green.
- ⬜ Live sending behind explicit `DANGEROUS_BURNER_LIVE`.
- ⬜ Requires a **fresh burner** secret; refuses main-wallet-style config.
- ⬜ Enforce caps **before** building/sending.
- ⬜ Simulate before send; log signatures + risk flags (redacted).

## Phase 8 — Web dashboard ⬜

- ⬜ Local web UI (`apps/web`).
- ⬜ Phantom via Solana Wallet Adapter — **watch-only** first.
- ⬜ Balances, positions, logs, risk flags, transaction preview.
- ⬜ **Manual approve** flow preferred over raw key custody.

---

## Definition of done (every phase)

1. `pnpm check` (typecheck + lint + test) is green.
2. New safety behavior has explicit tests, including negative tests.
3. Docs updated (this file + any model docs the phase touches).
4. No secret can reach a log or a committed file.
5. Small, reviewable commit(s).
