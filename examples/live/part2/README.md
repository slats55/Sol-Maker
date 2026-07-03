# Part 2 live sniper examples

Deterministic EXAMPLE artifacts for the Sprint 108 armed sniper loop. Regenerate with
`pnpm tsx scripts/gen-part2-examples.ts`. These show the SHAPE of each artifact and the green/blocked
paths. **They are examples, not live data, and make no profitability claim.**

| File | Shows |
| --- | --- |
| `escalation-policy.example.json` | a canary escalation policy (large trades disabled, manual re-arm) |
| `loop-model.example.json` | the loop modes (default `off`) + pipeline stages |
| `discovery.example.json` | one clean candidate + one malformed mint fail-closed rejection |
| `run-report.armed-green.example.json` | armed_canary GREEN path → `prepare_canary_request` (recommendation only) |
| `run-report.armed-risk-reject.example.json` | armed_canary with a risk REJECT → **no** canary (risk overrides score) |
| `paper-shadow-session.example.json` | one would_enter + one would_skip; outcome unknown |
| `reconciliation.finalized.example.json` | a finalized canary with honest **unknown** PnL |

## Real-data evidence (`real-evidence/`)

Captured live against Solana mainnet during Sprint 108. Not byte-pinned (real timestamps); these are
reproducible with a mainnet RPC.

| File | What it proves |
| --- | --- |
| `usdc-risk.real.json` | real read-only risk: USDC score 100 / REJECT, real freeze authority |
| `usdc-jupiter-observation.real.json` | a real Jupiter quote observation (0.005 SOL → USDC) |
| `usdc-quote-facts.real.json` | the quote facts derived from the real observation |
| `run-report.real-usdc-reject.json` | armed_canary run over the REAL USDC candidate → **IGNORED** (risk-rejected), 0 canary recommended |

The real evidence demonstrates the gates hold on real mainnet data: a real freeze authority stops a
real candidate even in armed mode with a fresh real quote. No real trade was signed or sent.
