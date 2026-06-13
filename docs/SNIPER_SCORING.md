# Sniper candidate scoring (S101) — design + safety boundary

This is the design review for the **Rust memecoin candidate scoring + operator ranking**
layer (Sprint 101). It is the safety contract the implementation is built to; read it before
touching `crates/solmaker-engine/src/sniper_score.rs`,
`packages/engine-bridge/src/validate-sniper-score.ts`, or
`packages/sniper/src/sniper-score-input.ts`.

Axiom Pro is a **UX/product benchmark only** — an operator-grade command center is the goal of
the *experience*, never a dependency, never a trust relationship, never a source of code or data.
Nothing here calls, imports, or relies on Axiom or any third-party wallet-touching service.

## What candidate scoring IS

A candidate score is a **deterministic operator intelligence layer**: it folds facts the system
already collected or replayed — realtime candidate snapshots, advisory risk reports, Token-2022
flags, route-quote scores + freshness, simulation classification, transaction-build evidence —
into a single transparent, component-based number (0–100) and a closed verdict
(`watch` / `caution` / `reject` / `insufficient-evidence`) per candidate, plus a deterministic
ranking. It exists to help an operator decide **what is worth watching or dry-running** in a
PAPER / mainnet-dry-run workflow.

The score is **component-based and reproducible**: it is the clamped sum of six published
component buckets (risk safety, quote quality, quote freshness, liquidity evidence, token
mechanics, simulation/build evidence), each computed from the echoed input facts by a pure
function. Rust computes it; TypeScript independently re-derives every component, the score, the
verdict, the reason codes, and the ranking from the same facts and **refuses the whole artifact on
any disagreement** (the parity wall). Missing facts produce `insufficient-evidence`, never a fake
green.

## What candidate scoring MUST NEVER mean

- **Not a buy signal, not financial advice, not a profitability claim.** A score ranks evidence
  quality, never expected return. The artifact pins `notProfitabilityClaim`, `notExecutable`,
  `neverSigns`, `neverSends`, `phase7LiveTradingReady:false`.
- **Not live readiness.** `scoreIsNotLiveReadiness:true`. A candidate score is **not** one of the
  fourteen mainnet live-gate conditions (`packages/execution/src/live-gate.ts`) and cannot satisfy
  any of them. It feeds nothing downstream, gates nothing, and leaves the dry-run evidence chain
  UNCHANGED. The default state of every gate remains **blocked**.
- **High score ≠ safe to trade.** `highScoreIsNotSafeToTrade:true`. A high score is never a
  "safe to trade" judgment and never a buy recommendation.

## Why scoring cannot override risk gates

Scoring **never re-derives or overturns risk**. The risk decision and flags are carried VERBATIM
from the supplied risk facts (the output of `token:risk` / the risk engine), and the scorer treats
them as hard inputs:

- A risk decision of `REJECT` → verdict `reject` (`risk-rejected`), no matter how high the
  component sum is. A rejected risk report stays rejected.
- One or more **critical** risk flags → verdict `reject` (`risk-over-threshold`).
- A blocking **Token-2022** extension → verdict `reject` (`token2022-blocker`).

These hard-reject gates dominate the score: a `reject` verdict is impossible to escape via a high
score, and the parity wall enforces it in TypeScript independently. This mirrors the existing
sniper preflight rule — *"disqualifiers always override the score; a high score can never bypass a
hard disqualifier"* — and `EXECUTION_SAFETY.md`'s *"refuses `REJECT` decisions outright"*.

## Why scoring cannot create live readiness

The scorer adds **no execution capability of any kind**. It opens no socket, signs nothing, sends
nothing, loads no key. In Rust it is a pure function over a bounded stdin document; the dependency
allowlist stays exactly `serde + serde_json`, and the engine-side capability scan
(`crates/solmaker-engine/src/safety.rs`) plus the TypeScript mirror
(`packages/engine-bridge/src/engine-safety.test.ts`) both refuse any execution-shaped capability
token. A high-scoring `watch` candidate is still only reviewable paper material — the operator's
next safe action is to run `paper:sniper:dry-run`, whose terminal verdict remains
`blocked / live-not-authorized` by design.

## How this helps memecoin sniping without adding unsafe capability

An operator watching a fast memecoin feed needs a triage signal: of N freshly-observed candidates,
which few are worth a closer (paper) look, and which are obvious rejects? The score answers
exactly that and nothing more. It turns the facts the pipeline already produces into a ranked
table the operator can read at a glance — the Axiom Pro *experience* — while every unsafe action
(signing, sending, key handling, live trading) remains structurally absent. Intelligence goes up;
capability does not.

## Verdict + score model (the spec the two implementations must match)

**Score** = `clamp(riskSafety + quoteQuality + quoteFreshness + liquidity + tokenMechanics +
simulationEvidence, 0, 100)`, integer math throughout.

| Component | Range | Rule |
|---|---|---|
| `riskSafety` | 0–40 | `PASS_FOR_PAPER_EVALUATION`→40, `CAUTION`→18, `REJECT`/null→0; minus `min(highFlagCount×4, 16)` |
| `quoteQuality` | 0–25 | observed+fresh: `floor(quoteScore × 25 / 100)`; else 0 |
| `quoteFreshness` | 0–10 | `fresh`→10; else 0 |
| `liquidity` | 0–10 | `adequate`→10, `unknown`/null→4, `low`→0 |
| `tokenMechanics` | 0–10 | all facts null→4; else base 10 minus freeze 5 / mint 3 / holderConc 3 / metadataMutable 2 / token2022Blocker 10, clamped |
| `simulationEvidence` | 0–5 | `simulated-ok`→5, `failed`→0, unavailable/null→2 |

**Verdict** (closed set), evaluated in precedence order:

1. **`reject`** if any hard-reject gate fires: `risk-rejected`, `risk-over-threshold`,
   `token2022-blocker`.
2. **`insufficient-evidence`** if `riskDecision` is absent (no risk assessment ⇒ the safety bar
   cannot be cleared) — emits `insufficient-evidence`.
3. **`caution`** if any caution gate fires: `quote-stale` (observed but not fresh),
   `quote-unavailable` (observed=false), `quote-missing` (no quote facts), `high-price-impact`,
   `low-liquidity`, `holder-concentration-risk`, `metadata-mutable-risk`, `simulation-failed`,
   `tx-build-refused`, or `riskDecision === CAUTION`.
4. **`watch`** otherwise.

`simulation-unavailable`, `paper-only`, and `mainnet-live-disabled` are **informational** reason
codes (always present where applicable) and never raise the verdict on their own. `candidate-duplicate`
is in the closed set but is refused at bundle-normalize time, so it never reaches a scored entry.

**Ranking**: sort by verdict rank (`watch`=3 > `caution`=2 > `insufficient-evidence`=1 > `reject`=0),
then score desc, then `candidateId` asc. `rank` is the 1-based position; `bestCandidateId` is the
head (or null when there are no candidates).

**nextSafeAction** (closed): `watch`→`watch-and-paper-dry-run`, `caution`→
`review-cautions-before-dry-run`, `reject`→`do-not-proceed-risk-gate`, `insufficient-evidence`→
`gather-risk-and-quote-evidence`.

## Boundary echo (the non-negotiables)

The dependency allowlist stays exactly `serde + serde_json`; the engine signs nothing, sends
nothing, opens no socket, and loads no key material. Rust never becomes the source of truth — every
artifact crosses the bridge through the TypeScript validator first (the parity wall). There is no
mainnet send surface and no Rust signer/send/network path, in this sprint or any prior one.
