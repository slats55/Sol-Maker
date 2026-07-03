# Live Sniper Canary Runbook (Sprint 108, Part 2)

> **This is real money.** A canary trade spends real SOL on Solana mainnet. **Loss is possible. Profit is
> not guaranteed.** Use a tiny amount only, from a throwaway burner wallet. Sol Maker never asks for a
> seed phrase or private key, never holds a key, and never sends a transaction for you — **you** sign
> and submit every transaction yourself in Phantom.

This runbook walks one tiny, human-confirmed canary trade end to end. The backend prepares an
**unsigned** transaction; Phantom (your browser wallet) is the only thing that signs and sends.

---

## 0. What the sniper loop is (and is not)

The Part 2 loop is an operator-controlled state machine. Its modes are:

| Mode | What it does |
| --- | --- |
| `off` (default) | nothing — the loop is idle |
| `observe_only` | discover + score + watchlist candidates; **cannot trade** |
| `paper_shadow` | also runs a paper "would-have" simulation beside discovery; **cannot trade** |
| `armed_canary` | may **recommend** preparing one tiny canary; **still cannot trade** — it produces a recommendation only |
| `paused` | halts new canaries; observation continues |
| `killed` | every loop action is blocked |

**The loop never signs or sends.** Its strongest possible output is the recommendation
`prepare_canary_request`. Turning that into a real transaction is a separate, manual step, and the
human signs it in Phantom. No mode trades — this is enforced in code (`loopModeCanTrade` is `false`
for every mode) and proven by tests.

---

## 1. Prerequisites

- A Solana **burner** wallet in Phantom, funded with a tiny amount of SOL (e.g. 0.01–0.05 SOL).
  **Never use your primary / savings wallet.**
- Phantom browser extension installed and set to **Mainnet**.
- This repo built locally (`pnpm install`, `pnpm run web:build`).
- A mainnet RPC URL (`SOULMAKER_RPC_URL`) for read-only risk and quote fetches.

## 2. Inspect the policy (no money involved)

```
pnpm soulmaker live:policy:inspect --mode live_canary --live-enabled
pnpm soulmaker live:sniper:policy
pnpm soulmaker live:kill-switch
```

Confirm: live is disabled by default, every cap is clamped to a hard ceiling, large trades are
disabled, and a manual re-arm is required. If the kill switch is engaged, nothing live can happen.

## 3. Run observe-only discovery (no money involved)

Discover real candidates from a real feed snapshot or a manual mint:

```
# from a real @soulmaker/realtime snapshot:
pnpm soulmaker live:sniper:discover --snapshot runs/realtime-snapshot.json --json

# or a manual mint you want to evaluate:
pnpm soulmaker live:sniper:discover --mint <MINT> --json
```

A malformed mint or a candidate with no provenance is **rejected**, never invented.

## 4. Get real risk + a real quote (read-only network)

```
SOULMAKER_RPC_URL=<rpc> pnpm soulmaker token:risk <MINT> --allow-paper-read --deep --json --out runs/risk.json
pnpm soulmaker paper:routequote:fetch --candidates runs/candidates.json --amount-sol 0.005 --allow-paper-read --out-dir runs/quotes
```

These are **read-only**: no wallet, no key, no signing, no sending.

## 5. Run paper-shadow (no money involved)

```
pnpm soulmaker live:sniper:shadow --mint <MINT> --risk <MINT>=runs/risk.json --quote <MINT>=runs/quote-facts.json --json
```

Read the would-enter / would-skip decisions. A `would_enter` is **not** a profit prediction —
outcome is unknown.

## 6. Approve, then run the armed loop (still no send)

Arming is a deliberate human act, not a flag. First create a **time-boxed operator approval** by
typing the exact confirm phrase (the approval expires — default 10 minutes, hard ceiling 15 — and
covers at most ONE canary recommendation window):

```
pnpm soulmaker live:sniper:approve --operator "your-name" \
  --confirm I-APPROVE-ONE-CANARY-RECOMMENDATION \
  --ttl-minutes 10 --out runs/approval.json
```

Then run the armed loop with that approval:

```
pnpm soulmaker live:sniper:run --mode armed_canary --approval runs/approval.json \
  --mint <MINT> --risk <MINT>=runs/risk.json --quote <MINT>=runs/quote-facts.json \
  --spend-sol 0.005 --json --out runs/run-report.json
```

If — and only if — every gate is green (active approval, live candidate, no risk block, fresh
quote, policy green, escalation permits one canary), the report's action is
`prepare_canary_request`. Otherwise it tells you exactly why it refused — an expired approval is
exactly as powerless as none. **This command still sends nothing.**

## 7. Prepare the UNSIGNED canary request

```
pnpm soulmaker live:canary:prepare \
  --candidate-mint <MINT> --risk runs/risk.json \
  --envelope runs/unsigned-envelope.json --simulation runs/sim.json \
  --spend-sol 0.005 --out runs/canary-request.json
```

The request must reach state `preflight_ready` (a green simulation is required) before it can be
armed. The backend holds no key and signs nothing here.

## 8. Open the Live Console and connect Phantom

1. Serve `apps/web/public/` and open `live-console.html`.
2. Engage/clear the kill switch as you intend.
3. Click **Connect Phantom**. Make sure Phantom is on **Mainnet**.
4. Load `runs/canary-request.json` (file picker or paste).

## 9. Verify, then arm, then confirm in Phantom

- Verify the **mint**, **amount**, and **slippage** in the preview match what you expect.
- Tick the "I understand this spends real money" checkbox.
- The **Arm** button stays disabled until: wallet connected + state `preflight_ready` + zero blocking
  reasons + kill switch clear + checkbox ticked. If it is disabled, it tells you why.
- Click **Arm**, then **Open Phantom Confirmation**. **Phantom** asks you to approve. Review it in
  Phantom one more time. You are the only signer.

## 10. Record the result and reconcile

- Note the **signature** Phantom returns and watch the confirmation status in the console.
- Capture the facts (signature, status, slot, amounts, fees, balances if you have them) and build the
  reconciliation record:

```
pnpm soulmaker live:sniper:reconcile --candidate-mint <MINT> --facts runs/recon-facts.json --json --out runs/reconciliation.json
```

PnL is reported as **unknown** unless you supplied before/after balances — it is never fabricated.

## 11. Stop / kill switch

- To stop the loop: set the policy kill switch (`killSwitch: true` in `soulmaker.config.json`) or set
  `SOULMAKER_EMERGENCY_STOP=1`.
- In the console, the **KILL SWITCH** button immediately disables every dangerous control.

## 12. Rank candidates (advisory; optional AI)

```
pnpm soulmaker live:sniper:rank --snapshot runs/realtime-snapshot.json \
  --risk <MINT>=runs/risk.json --quote <MINT>=runs/quote-facts.json --json
```

The default engine is a deterministic score ranking that works offline. Add `--ai` (requires
`ANTHROPIC_API_KEY` in the env) for an Anthropic advisory ranking — its output is **clamped**:

- A hard-blocked candidate (risk REJECT, critical flag, denylist, freeze/mint authority, missing
  risk) is excluded **before** the AI sees anything; an AI naming one is discarded and recorded in
  `aiAttemptedOverride`.
- Invented mints are dropped; omitted eligible candidates are appended deterministically.
- **Any** AI failure (no key, timeout, outage, malformed output) falls back to the deterministic
  ranking with an honest caveat and exit 0 — an AI problem can never block the sniper.

Every ranking logs the engine, model, prompt version, and a truncated sha256-128 hash of the exact
inputs. A ranking is advisory only: it can never unblock, approve, or trade.

## 13. Track positions and exits (paper parity)

Open a PAPER position (simulation; capped at the same hard ceiling as a live canary):

```
pnpm soulmaker live:sniper:paper:open --mint <MINT> --spend-sol 0.005 \
  --token-amount-raw <rawOut-from-quote> --ledger runs/positions.json
```

View, mark, and apply exit rules (stop-loss 20% / take-profit 50% / trailing 15% / max hold 30 min
by default — override with `--exit-policy`):

```
pnpm soulmaker live:sniper:positions --ledger runs/positions.json \
  --mark <MINT>=runs/mark.json --apply-exits
```

A mark file is a REAL sell-side observation: `{ "valueLamports": <what the position would fetch>,
"source": "<provider>" }`. Without a mark, price rules are skipped honestly and only the time-box
and emergency rules can fire. **A live (Phantom-opened) position is never auto-closed** — its exit
is printed as a RECOMMENDATION; you sell in Phantom and record the close via
`live:sniper:reconcile`. One open position per mint; duplicate intents are refused.

## 14. Emergency stop

```
pnpm soulmaker live:sniper:emergency --ledger runs/positions.json
```

Closes every open PAPER position immediately (reason `emergency`; PnL from the last known mark or
honestly unknown) and prints the exact manual steps for any live position: engage the kill switch,
swap back to SOL in Phantom yourself, record the close. This CLI cannot sell a live position — the
backend holds no key — and it says so instead of pretending.

## If a trade fails

- A Phantom rejection or an on-chain failure is recorded honestly (`user_rejected` / `failed`).
- The escalation policy auto-pauses after a failure / rejection / confirm-timeout; a human must
  manually re-arm before another canary.
- Check the signature on a block explorer. Do **not** retry blindly — diagnose first.

## What NOT to do

- Do **not** enter a seed phrase or private key anywhere. Nothing in Sol Maker ever asks for one.
- Do **not** use your primary wallet. Use a tiny burner.
- Do **not** raise the size. Part 2 is canary-only; large trades are disabled.
- Do **not** run unattended. Every real transaction requires your Phantom confirmation.
- Do **not** treat a `would_enter` or a `live_canary_candidate` as a promise of profit. It is not.
