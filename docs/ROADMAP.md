# Soulmaker Roadmap

Phased, safety-gated plan. Each phase must be **tested and green** before the
next begins. Live trading does not appear until Phase 6, behind every gate in
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

## Phase 4 — Paper trading engine ⬜

- ⬜ Simulated buy/sell.
- ⬜ TP/SL.
- ⬜ Trade journal (append-only).
- ⬜ PnL report.
- ⬜ Snipe-list input.
- ⬜ Deterministic, offline tests.

## Phase 5 — Transaction planning & simulation ⬜

- ⬜ Transaction **plan** object (explicit destinations, amounts, fees).
- ⬜ Human-readable preview (no blind signing).
- ⬜ Simulation interface (`simulateTransaction`).
- ⬜ **Still no sending.** Tests prove unsafe plans are rejected.

## Phase 6 — Burner-wallet live mode ⬜

- ⬜ Only after Phases 0–5 are green.
- ⬜ Live sending behind explicit `DANGEROUS_BURNER_LIVE`.
- ⬜ Requires a **fresh burner** secret; refuses main-wallet-style config.
- ⬜ Enforce caps **before** building/sending.
- ⬜ Simulate before send; log signatures + risk flags (redacted).

## Phase 7 — Web dashboard ⬜

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
