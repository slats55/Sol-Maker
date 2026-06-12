# Competitive sniper reference — safe translation to Sol Maker (S90)

This document captures the lessons from reviewing production sniper / trading-terminal references
(RPC Fast's Solana sniper guidance, Dysnix's production sniper architecture, GoodCrypto-style
unified trading terminals) and maps them to **PAPER-only** Sol Maker work.

> **Boundary statement.** Nothing in this document authorizes live execution. Sol Maker's safe
> slice ends at the PAPER dry-run + operator verdict. Every "execute"-shaped lesson below is
> recorded as a **Phase 7 future-only topic** — not designed here, not implemented here, and not
> authorized. The CLI cannot build, sign, or send a transaction by construction.

## 1. The competitive stack vs. the safe Sol Maker translation

Production snipers converge on the same loop:

```text
detect → analyze → execute → exit
```

Sol Maker's safe translation keeps the *intelligence and discipline* layers and replaces the
execution layers with auditable PAPER artifacts:

```text
candidate intake → read-only inspect → risk → paper decision → route boundary
                → dry-run (simulated) → audit → handoff → operator verdict
```

| Competitive stage | What pros optimize | Sol Maker (PAPER) translation | Status |
| --- | --- | --- | --- |
| Detect | mempool/log streams, new-pool listeners | operator-authored candidate intake (`sniper.candidate.list.v1`); no scraper is shipped | shipped |
| Analyze | mint/program safety, liquidity, holders | `token:inspect` + `token:risk` (read-only RPC) → the S90 **preflight bridge** → preflight report | shipped |
| Decide | entry rules, sizing, throttles | tighten-only policy + v2 decision report with reason codes; paper-enter always demands review | shipped |
| Route | route quotes, slippage, priority fees | **read-only quote provenance** (S91): operator-supplied `routequote.observation.input.v1` → `paper:routequote:prepare` → label facts with the live-state caveat in `simulation.route.resolution.v1`; no fetcher, no resolver, nothing executable | observation only |
| Execute | tx build/sign/send, Jito bundles | **not built** — Phase 7, unauthorized | not authorized |
| Exit | TP/SL, position manager | paper engine TP/SL exists in the offline paper simulator only | paper only |
| Audit | fill logs, PnL attribution | chain audit + readiness + handoff + operator bundle with per-file digests | shipped |

## 2. Risk checks to prioritize (RPC Fast lesson: validate before you race)

Checks the risk layer covers today, and the honest gaps:

| Check | Today | Notes |
| --- | --- | --- |
| Mint validity (32-byte pubkey, secret-length refused) | ✅ | everywhere, fail-closed |
| Decimals / supply sanity | ✅ | `token:inspect` |
| Freeze authority (honeypot vector) | ✅ | critical flag → REJECT outright |
| Mint authority (dilution) | ✅ | flagged |
| Program identity (spl-token vs token-2022) | ✅ | label carried; token-2022 surfaced |
| Allowlist / denylist | ✅ | operator lists in `token:risk` |
| Mutable metadata / suspicious metadata changes | ❌ gap | needs metadata read (future read-only work) |
| Liquidity depth / LP age | ❌ gap | only operator-supplied `observed*` labels; never verified |
| Owner concentration (top holders) | ❌ gap | needs holder scan (future read-only work) |
| Transfer hooks / taxes (token-2022 extensions) | ❌ gap | program label only; extension inspection is future work |
| Honeypot / sell-blocking simulation | ❌ gap | requires a simulateTransaction engine — Phase 7 adjacent |
| Program allowlist/denylist | partial | token program label only |

Gap entries are recorded so they can become **read-only** intelligence sprints; none of them
require execution capability.

## 3. Observability to build (Dysnix lesson: every stage leaves evidence)

Already shipped: run labels, candidate ids, route status + explanations, readiness areas (11),
blocking codes carried verbatim end-to-end (`blockingTrailConsistent` cross-check), artifact
counts, per-file `sha256-128` digests, deterministic byte-identical artifacts (no wall-clock by
design — the UI says "timing unavailable" instead of inventing latency numbers).

Safe future additions (read-only): slot/RPC health metadata on inspect outputs, stage timing
labels (operator-supplied or wall-clock-optional), quote-age metadata for the S91 routequote
observations (today the observed-at value is an operator label — a read-only fetcher with
quote-age metadata remains future work per the S89 design stub).

## 4. Product / UI lessons (GoodCrypto lesson: a command center, not an artifact dump)

Applied in S90:

- **Unified dashboard** → the `/sniper` Sniper Command Center page + the same blocks on every
  `web:inspect --dir` dry-run folder.
- **Screener-like candidate table** → the candidate intelligence table (intake + preflight +
  decision joined per candidate; no prices, no PnL, no fake liquidity).
- **Risk-first terminal** → the capability strip and verdict cards lead; raw JSON stays secondary.
- **Bot-card layout** → dashboard status cards over the run's own artifacts.
- **Advanced controls hidden until authorized** → live-trading surface simply does not exist;
  the strip renders it "disabled / unauthorized" instead of pretending.

Deliberately NOT copied: fake fills, simulated PnL tickers, "ready to trade" affordances,
one-click buy buttons, and anything that makes a paper classification look like an order.

## 5. Phase 7 future-only topics (recorded, NOT authorized, NOT implemented)

- A live read-only route quote FETCHER (S91 shipped the package + operator-supplied observation
  files; the RPC/HTTP fetcher stays future per the S89 stub) and any route resolver.
- A real `simulateTransaction` dry-run engine.
- Dynamic priority-fee modeling; Jito/bundle awareness.
- Transaction construction, signing, sending; live execution and exits.
- Wallet/key management (burner isolation spec exists as a DESIGN artifact only).

Each requires explicit Phase 7 authorization, which has not been given. `phase7LiveTradingReady`
is a literal `false` in every artifact that carries it, and validators refuse anything else.
