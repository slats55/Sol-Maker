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

## 2. Token / launch risk flags (`@soulmaker/risk`, Sprint 3 — implemented)

> **Status:** implemented in `@soulmaker/risk` (Sprint 3). The engine turns the
> read-only mint facts collected by `@soulmaker/solana`'s `getTokenMintInfo`
> (`mintAuthority` present, `freezeAuthority` present, `decimals`, `supply`,
> `isInitialized`, owning token program) — plus operator allow/deny/previously-
> traded lists — into structured **risk flags** and a single **advisory score**.
> It is **read-only and advisory only**: it builds, signs, simulates, and sends
> **nothing**, and it is **not** a buy/sell recommendation engine.

### Severity levels

`info` · `low` · `medium` · `high` · `critical`. Severity is both a human label
and the score weight (below). Any **critical** flag forces a `REJECT` decision
regardless of the numeric score.

### Implemented flags

Each flag has a stable kebab-case `id`, a severity, a human title/detail, and
machine-readable `evidence`. Evaluation is **deterministic** (no clock, no
randomness, no I/O) and runs in a fixed order: lists → initialization → freeze
authority → mint authority → token program → supply → decimals.

| Flag id | Severity | Score | Meaning |
| --- | --- | --- | --- |
| `denylisted-mint` | critical | +100 | Mint is on the operator denylist → hard reject |
| `mint-not-initialized` | critical | +100 | Mint account is not initialized (not a live mint) |
| `freeze-authority-present` | critical | +100 | Freeze authority set → can freeze your tokens (honeypot) |
| `mint-authority-present` | high | +30 | Mint authority set → unlimited supply / dilution / rug |
| `unknown-token-program` | high | +30 | Owning program is not a recognized SPL token program |
| `suspicious-decimals` | high | +30 | Decimals outside `[0, 18]` or non-integer — clearly abnormal |
| `supply-unparsable` | medium | +15 | Supply missing or not a non-negative integer |
| `zero-supply` | medium | +15 | Supply is zero (abnormal for a tradable token) |
| `previously-traded-mint` | medium | +15 | On the operator previously-traded list (re-entry/exposure) |
| `freeze-authority-unknown` | low | +5 | Freeze authority could not be determined — not assumed safe |
| `mint-authority-unknown` | low | +5 | Mint authority could not be determined — not assumed safe |
| `initialization-unknown` | low | +5 | Initialization state could not be determined |
| `allowlisted-mint` | info | −10 (credit) | On the operator allowlist (explicit trust signal) |
| `freeze-authority-renounced` | info | 0 | No freeze authority set (positive signal) |
| `mint-authority-renounced` | info | 0 | No mint authority set (positive signal) |
| `standard-spl-token-program` | info | 0 | Owned by the standard SPL token program (positive signal) |
| `token-2022-program` | info | 0 | Owned by Token-2022 (legitimate; transfer-hook/fee caution) |

`SUSPICIOUS_DECIMALS_THRESHOLD = 18`. "Unknown" flags implement the reliability
rule: a fact we cannot determine is a **caution**, never assumed safe.

### Scoring model (simple, documented, deterministic)

Defined in `packages/risk/src/risk-score.ts` with exported constants:

- Start at **0**. Add the per-severity weight of each risk flag
  (`SEVERITY_WEIGHTS = { info: 0, low: 5, medium: 15, high: 30, critical: 100 }`).
- Apply the **allowlist credit** (`ALLOWLIST_CREDIT = −10`) once if the
  `allowlisted-mint` flag is present.
- **Clamp** the result to `[0, 100]` (`SCORE_MIN`/`SCORE_MAX`).

Positive informational flags (renounced authorities, standard program) carry
weight **0**: the reward for safety is *not incurring* the corresponding risk
weight, not a separate bonus — which would double-count and could wrongly pull a
genuinely risky token across a decision tier. The one credit (`allowlisted-mint`,
−10) is an *active* operator trust signal, and it can **never** rescue a mint
that has a critical flag, because a critical flag forces `REJECT` outright.

### Decision (`DECISION_THRESHOLDS`)

- Any **critical** flag → `REJECT` (regardless of score).
- Else score **≥ 70** → `REJECT`.
- Else score **≥ 30** → `CAUTION`.
- Else → `PASS_FOR_PAPER_EVALUATION`.

> **`PASS_FOR_PAPER_EVALUATION` does not mean "safe to live trade."** It only
> means the mint may be considered for **paper-trading** evaluation later
> (Phase 4). It is never a live-trading safety judgment and never authorizes a
> send. No transaction is built, signed, simulated, or sent at any point.

### Allowlist / denylist / previously-traded

- **Denylist**: a match is a **critical** `denylisted-mint` flag → hard `REJECT`,
  overriding an allowlist match.
- **Allowlist**: an `allowlisted-mint` info flag with a small score credit. It
  never bypasses a critical flag, the account-level caps, or the live gate.
- **Previously-traded**: a `medium` advisory flag (re-entry / double exposure).
- List utilities (`packages/risk/src/lists.ts`) are **pure**: `parseList` reads
  newline-separated content, ignores blank lines and `# comments` (whole-line and
  trailing), trims entries (**case-preserving** — base58 is case-sensitive), and
  detects duplicates. File reading lives in the CLI, which hands the text to the
  pure parser.

## Interaction with the live gate

Token risk is **advisory input**; the account-level caps + live gate are
**hard constraints**. Even a perfectly "clean" token cannot cause a send unless
the full live gate passes, and never above the per-trade cap. Risk scoring can
only make the system *more* conservative, never less.

## Limitations (be honest)

- On-chain flags (mint/freeze authority, program, supply, decimals) are reliable;
  **off-chain** signals are heuristic and gameable. Treat scores as filters
  against obvious traps, **not** as profitability or safety guarantees.
- **Not yet implemented** (need pool/metadata data not available read-only today,
  deferred to a later sprint): `metadataMutable`, `missingSocials`,
  `suspiciousPoolSize`, `liquidityBurnStatus`, deployer denylisting.
