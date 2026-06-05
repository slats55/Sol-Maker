# Soulmaker Risk Model

Two layers of risk control:

1. **Account/portfolio risk** — caps and kill switch that bound how much can be
   lost regardless of strategy. Enforced today in the config schema.
2. **Token/launch risk** — per-token flags and scoring that decide whether a
   given memecoin is even a candidate. Designed here; implemented in Phase 3.

---

## 1. Account & portfolio risk (enforced now)

Defined in `packages/core/src/config/schema.ts` and re-checked by the live gate.

| Control | Config field | Default | Hard ceiling (`HARD_LIMITS`) |
| --- | --- | --- | --- |
| Max SOL per trade | `caps.maxTradeSizeSol` | 0.05 | **1.0** |
| Max cumulative daily loss | `caps.maxDailyLossSol` | 0.25 | **5.0** |
| Max simultaneous open positions | `caps.maxOpenPositions` | 3 | **20** |
| Global kill switch | `killSwitch` | `false` (off) | — |

- The **hard ceilings are baked into the schema** via Zod `.max()`. A hand-edited
  config that exceeds them fails validation — you cannot accidentally arm a large
  size. The defaults are deliberately tiny.
- The **kill switch** (`killSwitch: true`) makes the live gate refuse regardless
  of mode — a one-flag emergency stop.
- Enforcement of *runtime* accounting (tracking daily realized loss, counting
  open positions) lands with the paper engine (Phase 4) and execution (Phase 6).
  The caps object is the contract those phases must honor **before** building or
  sending anything.

## 2. Token / launch risk flags (Phase 3 design)

Each candidate mint will be evaluated against flags. Several mirror well-trodden
Solana sniper checks (validated by what real reference bots check — see
[`REFERENCE_REPO_AUDIT.md`](REFERENCE_REPO_AUDIT.md)), re-implemented cleanly:

| Flag | Meaning | Why it matters |
| --- | --- | --- |
| `mintAuthorityPresent` | Mint authority not renounced | Dev can mint infinite supply → dilute/rug |
| `freezeAuthorityPresent` | Freeze authority not renounced | Dev can freeze your token → can't sell |
| `metadataMutable` | Token metadata still mutable | Name/socials can be swapped post-buy |
| `missingSocials` | No detectable socials/links | Weak signal of low legitimacy |
| `suspiciousPoolSize` | Pool below/above sane bounds | Tiny pool = illiquid/rug-prone |
| `denylistedMint` | On operator denylist | Known-bad or already-rugged |
| `previouslyTradedMint` | Seen/traded before | Avoid re-entry / double exposure |
| `liquidityBurnStatus` | LP burned/locked or not | Unburned LP can be pulled (rug) |

### Allowlist / denylist

- **Denylist** (mints, deployers): hard reject regardless of score.
- **Allowlist**: explicit opt-in mints that may bypass some soft flags (never the
  account-level caps or the live gate).

### Scoring (advisory only)

- The engine outputs a **score + the list of triggered flags**, not a buy
  decision. Strategy (Phase 4+) consumes it. A high-risk score can *block* a
  candidate but a low-risk score never *forces* a trade.
- Reliability matters: a flag that can't be determined reliably (e.g. socials,
  burn status on some launches) is reported as **unknown**, not assumed safe.

## Interaction with the live gate

Token risk is **advisory input**; the account-level caps + live gate are
**hard constraints**. Even a perfectly "clean" token cannot cause a send unless
the full live gate passes, and never above the per-trade cap. Risk scoring can
only make the system *more* conservative, never less.

## Limitations (be honest)

- On-chain flags (mint/freeze authority) are reliable; **off-chain** signals
  (socials, "is this a rug") are heuristic and gameable. Treat scores as filters
  against obvious traps, **not** as profitability or safety guarantees.
- None of the Phase 3 logic exists yet — this section is the spec it must meet,
  with deterministic tests, when built.
