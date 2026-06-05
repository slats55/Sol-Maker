# Soulmaker

> A private, **security-first** Solana memecoin trading command center.
> **Wallet safety first. Speed second.**

Soulmaker is a personal bot + command center for watching Solana token/pool
activity, filtering risky launches, paper trading, simulating transactions, and
— only much later, behind many gates — executing tightly-capped **burner-wallet**
trades. It is built to be independently controlled, auditable, and safe from
wallet-drainer behavior.

This project exists because raw private keys handed to untrusted "sniper bots"
get drained. Soulmaker is the opposite of that: it is read-only and simulated by
default, and live sending is impossible unless a stack of explicit safety gates
all pass.

---

## ⚠️ Status: Phases 0–1 done; Phase 2 read-only core complete; Phase 3 advisory risk engine complete; Phase 4 simulated paper engine complete; Phase 5 paper-only strategy rules engine complete (Sprint 5 single-candidate + Sprint 6 batch plan pipeline + Sprint 7 journal-aware planning & richer simulated exits). No live trading. By design.

Nothing in this repository can move funds. There is **no transaction signing or
sending code anywhere in it yet** — the read-only Solana watcher (Phase 2) and
advisory risk engine (Phase 3) are read-only by construction, the Phase 4 paper
engine is **simulated-only** (injected prices, no wallet, no chain), and the
Phase 5 strategy engine is a **pure, paper-only** rules engine that only feeds the
paper engine (no chain, no wallet, no execution). Sprint 6 adds `strategy:plan`,
which turns an injected candidate **list** into a `PaperCandidate[]` an operator
passes to `paper:run` **manually**. Sprint 7 adds `strategy:plan --journal` (derive
the simulated portfolio from a **read-only** paper journal) and richer **simulated**
exits (trailing stop, partial take-profit, position-aware sizing) — still
paper-only, still no auto-run. None of this begins transaction planning (roadmap
Phase 6 remains not started). The default mode is `PAPER`. See
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Non-negotiable security rules (summary)

The full, authoritative list is in [`SECURITY.md`](SECURITY.md). The short form:

1. **Never** request, store, print, log, commit, or transmit a seed / recovery
   phrase. Ever.
2. **Never** use your main wallet for automated trading.
3. The only live mode is `DANGEROUS_BURNER_LIVE`, and only with a **fresh
   burner** holding trivial funds.
4. Default mode is `PAPER` (or read-only `WATCH_ONLY`).
5. Live sending is impossible unless **every** live-mode gate passes.
6. Hard caps: max trade size, max daily loss, max open positions, kill switch.
7. All secrets are **redacted** from logs (keys, seeds, RPC/API keys, bearer
   tokens, cookies, session tokens).
8. No hidden fees, transfers, referral skims, or unreviewed destination
   accounts.
9. Every transaction is **simulated** and rendered as a **human-readable plan**
   before any signing/sending (later phases).
10. No "auto-approve everything" behavior.

## Repository layout

```
soulmaker/
  apps/
    cli/        # @soulmaker/cli  — read-only CLI (doctor, config:check, mode, paper:status,
                #                    solana:doctor, wallet:watch, token:inspect/accounts/risk,
                #                    paper:run/journal, strategy:evaluate, strategy:plan)
    web/        # Phase 8 dashboard (placeholder)
  packages/
    core/       # @soulmaker/core      — config schema, modes, risk caps, LIVE GATE
    security/   # @soulmaker/security  — secret redaction + redacting logger
    solana/     # Phase 2 — read-only RPC watcher (public-key/mint reads only)
    risk/       # Phase 3 — read-only advisory token risk flags + scoring
    paper/      # Phase 4 — deterministic, simulated-only paper trading engine
    strategy/   # Phase 5 — deterministic, paper-only strategy rules engine (feeds paper);
                #            Sprint 6 adds the batch plan pipeline → PaperCandidate[];
                #            Sprint 7 adds journal-aware planning + richer simulated exits
    adapters/   # Phase 6+ — audited external integrations (placeholder)
  docs/         # ARCHITECTURE, ROADMAP, WALLET_SAFETY_MODEL, RISK_MODEL, REFERENCE_REPO_AUDIT
  scripts/      # thin operational scripts
  tests/        # cross-package integration tests (unit tests live beside code)
  references/   # study-only clones (gitignored, never committed, never run with funds)
```

## Tech stack

TypeScript-first pnpm monorepo on Node.js ≥ 20. Zod for config validation,
Vitest for tests, a custom pino-compatible **redacting** logger, ESLint +
`tsc --noEmit` for quality. `@solana/web3.js` / `@solana/spl-token` arrive in
Phase 2 (read-only first).

## Getting started

```bash
pnpm install

# quality gates
pnpm typecheck      # tsc --noEmit across the monorepo
pnpm lint           # eslint
pnpm test           # vitest (one-shot)
pnpm check          # all three

# the read-only CLI
pnpm soulmaker doctor
pnpm soulmaker config:check
pnpm soulmaker mode
pnpm soulmaker paper:status

# read-only chain commands (need rpcUrl; PAPER mode needs --allow-paper-read)
pnpm soulmaker solana:doctor
pnpm soulmaker wallet:watch <publicKey>
pnpm soulmaker token:inspect <mint>
pnpm soulmaker token:accounts <ownerPublicKey>
pnpm soulmaker token:risk <mint>      # advisory risk report — NOT a buy recommendation

# simulated-only paper trading (offline; injected fixtures; PAPER ONLY)
pnpm soulmaker paper:run --candidates <candidates.json> --prices <prices.json>
pnpm soulmaker paper:journal --journal <journal.jsonl>
pnpm soulmaker paper:status   --journal <journal.jsonl>

# paper-only strategy decisioning (offline; injected JSON; feeds paper only; not advice)
pnpm soulmaker strategy:evaluate --candidate <candidate.json> --config <config.json>

# batch plan: a candidate LIST → PaperCandidate[] for a later, MANUAL paper:run
# (PAPER ONLY; does NOT auto-run paper trades; not advice)
pnpm soulmaker strategy:plan --candidates <candidates.json> --config <config.json> \
  --size 100 --out <paper-candidates.json>
# optional position-awareness from a READ-ONLY paper journal (instead of --paper-state):
pnpm soulmaker strategy:plan --candidates <candidates.json> --config <config.json> \
  --journal <journal.jsonl>
# then, by hand:
pnpm soulmaker paper:run --candidates <paper-candidates.json> --prices <prices.json>
```

Configuration comes from `soulmaker.config.json` (copy
`soulmaker.config.example.json`) and/or `SOULMAKER_*` environment variables
(copy `.env.example` → `.env`). Both `.env` and `soulmaker.config.json` are
gitignored. Defaults are safe: `PAPER` mode, kill switch off, redaction on.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design & boundaries
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased plan (0 → 7)
- [`docs/WALLET_SAFETY_MODEL.md`](docs/WALLET_SAFETY_MODEL.md) — key handling & live gate
- [`docs/RISK_MODEL.md`](docs/RISK_MODEL.md) — caps, kill switch, token risk flags
- [`docs/PAPER_TRADING_MODEL.md`](docs/PAPER_TRADING_MODEL.md) — simulated paper engine (Phase 4)
- [`docs/STRATEGY_MODEL.md`](docs/STRATEGY_MODEL.md) — paper-only strategy rules engine (Phase 5)
- [`docs/REFERENCE_REPO_AUDIT.md`](docs/REFERENCE_REPO_AUDIT.md) — audit of reference repos
- [`SECURITY.md`](SECURITY.md) — the authoritative security rules

## License

License decision is intentionally **pending** (see `SECURITY.md` →
"License & dependencies"). Until decided, Soulmaker stays original and does
**not** vendor third-party (esp. GPL) code. It is private and unpublished.
