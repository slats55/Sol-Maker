# apps/web — Soulmaker dashboard (Phase 8, not yet implemented)

This directory is a placeholder for the local web dashboard.

Planned (Phase 8):

- Local-only Next.js dashboard.
- Connect Phantom via **Solana Wallet Adapter** for a **watch-only** view.
- Show balances, open positions, logs, risk flags, and the human-readable
  transaction preview.
- **Manual approve flow** is strongly preferred over the dashboard ever holding
  a raw private key.

Intentionally has **no `package.json` yet** so the pnpm workspace does not try to
build a web app before Phases 0–7 are complete. It will be initialized as a real
workspace package when Phase 8 begins.
