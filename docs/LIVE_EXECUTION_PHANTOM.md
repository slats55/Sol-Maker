# Live execution via Phantom — Part 1 (Sprint 107)

> **Read this whole document before enabling anything live.** This is the first build of Sol Maker
> that can lead to a **real Solana mainnet transaction**. It is deliberately small, gated, and
> human-confirmed. It is **not** an autonomous sniper, and it makes **no claim of profit**.

## What Part 1 is (and is not)

Part 1 is the **safe live execution bridge**: the path from "paper / read-only / dry-run" to a
single, tiny, **human-confirmed** mainnet trade, signed in **your own Phantom wallet**.

| Part 1 **is** | Part 1 is **not** |
| --- | --- |
| A default-blocked, micro-capped live-mode policy | Autonomous / unattended trading |
| Real mainnet quote → risk → unsigned-tx preparation | A profit engine or a guarantee of gains |
| A Phantom-signable canary **request** the backend assembles but never signs | A backend that holds keys or signs anything |
| A browser **Live Console** where *you* confirm the transaction in Phantom | A multi-chain live system (only Solana mainnet is live) |
| Full audit trails and honest status reporting | A bypass of Phantom confirmation |

**The backend never holds a private key, never signs, and never sends.** Every real transaction is
deserialized in the browser and handed to Phantom, where **you** approve it. If you do not click
"Approve" in Phantom, nothing happens on chain.

## The honest reality

- **Real trading can be implemented. Real profit cannot be guaranteed.** Sol Maker seeks edge,
  speed, discipline, and survivability, but memecoin trading can lose the **entire** amount of any
  trade, instantly, with no recourse.
- Nothing in Sol Maker is financial advice. It is a tool you operate on your own funds at your own
  risk.
- This build has **not broadcast a real canary trade**. It prepares one and wires the Phantom
  signing path; the actual broadcast requires you, in your browser, with funds and a Phantom click.

## Why Sol Maker never touches your seed phrase

A seed phrase or private key handed to a bot is a bot that can drain you. Sol Maker is the opposite:

- There is **no field anywhere** that asks for a seed phrase, private key, or recovery material.
- The backend and the Rust engine are structurally read-only (`crates/solmaker-engine/SAFETY.md`):
  no signer, no key loading, no send.
- The Live Console connects to Phantom via the browser's injected provider (`window.phantom.solana`)
  — it receives only your **public** key, and asks Phantom to sign. The key never leaves Phantom.

If anything ever asks you for your seed phrase "to enable live trading," it is not Sol Maker, and
you should refuse.

## The four live modes

The live-mode policy (`live.policy.v1`, in `@soulmaker/live`) has one `mode` axis, distinct from the
core `TRADING_MODES`:

| mode | what it permits |
| --- | --- |
| `paper` (default) | nothing live; simulated only |
| `readonly` | real read-only data (quotes, risk) but no transaction preparation |
| `live_prepare` | prepare a real unsigned transaction; **no** Phantom send permitted |
| `live_canary` | everything `live_prepare` does **plus** the browser may arm a Phantom canary send |

`liveEnabled` defaults to **false**. With the default policy, every live action is blocked. A live
action is only possible when **all** of these hold (see `evaluateLivePolicy`):

- `liveEnabled === true`
- `mode` is `live_prepare` or `live_canary`
- kill switch clear **and** no emergency stop
- `solana-mainnet` is on the chain allowlist
- wallet provider is `phantom`
- every cap is at or below its **absolute hard ceiling** (caps only tighten)
- preflight simulation, manual confirmation, and the audit log are all **required**

### Hard ceilings (cannot be exceeded by any config)

| cap | default | hard ceiling |
| --- | --- | --- |
| max trade | 0.005 SOL | 0.05 SOL |
| max slippage | 100 bps | 300 bps |
| max trades / day | 1 | 5 |
| max daily loss | 0.01 SOL | 0.05 SOL |
| risk score cap | 30 | 50 |
| priority fee | 1,000,000 lamports | 5,000,000 lamports |

A config that asks for more than a ceiling is **refused**, never silently raised.

## How to run each mode

```bash
# Paper (default) — nothing live. Shows the policy gate verdict.
pnpm soulmaker live:policy:inspect

# See the policy that a live_canary config WOULD evaluate to (still read-only):
pnpm soulmaker live:policy:inspect --mode live_canary --live-enabled --json

# Chain readiness (only solana-mainnet is live):
pnpm soulmaker live:chains

# Kill switch / emergency stop status:
pnpm soulmaker live:kill-switch
```

`live:policy:inspect` and every other CLI command are **read-only**: they can never sign, send, or
arm anything. Mainnet sending has **no CLI surface** at all — by design.

## Performing a tiny canary trade

A canary trade is a single, tiny, real trade used to prove the path end to end. The flow:

### 1. Generate the real building blocks (existing commands, real network)

```bash
# Real read-only risk assessment for the candidate mint:
pnpm soulmaker token:risk --mint <MINT> --rpc-url <RPC> --allow-paper-read --json --out runs/risk.json

# A REAL unsigned Jupiter swap transaction (mainnet-beta), built for YOUR public wallet key.
# This never signs and never sends — it only builds an unsigned envelope.
pnpm soulmaker execution:build --candidate-mint <MINT> --wallet <YOUR_PUBLIC_KEY> \
  --amount-sol 0.005 --slippage-bps 100 --risk runs/risk.json \
  --max-spend-sol 0.005 --slippage-cap-bps 100 --risk-score-cap 30 \
  --request mainnet-dry-run --allow-paper-read --out runs/envelope.json

# Simulate the unsigned transaction against recent chain state (read-only):
pnpm soulmaker paper:simulation:tx --envelope runs/envelope.json --rpc-url <RPC> \
  --allow-paper-read --json --out runs/sim.json
```

### 2. Assemble the Phantom-signable canary request

```bash
pnpm soulmaker live:canary:prepare \
  --candidate-mint <MINT> \
  --risk runs/risk.json \
  --envelope runs/envelope.json \
  --simulation runs/sim.json \
  --spend-sol 0.005 \
  --audit-log runs/live-audit.jsonl \
  --mode live_canary --live-enabled \
  --out runs/request.json
```

The result is a `live.canary.request.v1` whose `state` is one of `blocked_by_policy`,
`blocked_by_risk`, `quote_ready`, or `preflight_ready`. Only `preflight_ready` (a green simulation,
zero blocking reasons, within caps) can be armed. The backend **cannot** advance past this — the
rest happens in the browser.

### 3. Confirm in the browser Live Console

```bash
pnpm web:build          # writes apps/web/public/live-console.html
# open apps/web/public/live-console.html in a browser with the Phantom extension
```

In the console:

1. **Connect Phantom** (make sure Phantom is set to **Mainnet**).
2. **Load** `runs/request.json` (file picker or paste).
3. Review the preview: candidate, quote, risk, simulation, caps, and any blocking reasons.
4. Tick **"I understand this spends real money."**
5. **Arm Canary Trade** (enabled only when wallet + `preflight_ready` + zero blockers + the checkbox
   all line up).
6. **Open Phantom Confirmation** → Phantom shows you the transaction → you **Approve** or **Reject**.
7. The console tracks the signature and confirmation status and keeps a downloadable audit log.

The Live Console loads `@solana/web3.js` from a **pinned CDN URL with a Subresource Integrity (SRI)
hash**, so the browser refuses a tampered build. No RPC key or secret is embedded.

## The canary state machine

A single canary's lifecycle (closed set, in `@soulmaker/live`):

```
blocked_by_policy ─┐
blocked_by_risk  ──┤ (terminal)
quote_ready ──SIMULATION_OK──▶ preflight_ready ──ARM──▶ phantom_requested
                                                          ├─ PHANTOM_REJECTED ─▶ user_rejected (terminal)
                                                          ├─ PHANTOM_SUBMITTED ─▶ submitted ──CONFIRMED──▶ confirmed ──RECONCILED──▶ reconciled (terminal)
                                                          └─ SUBMIT_FAILED ─────▶ failed (terminal)
```

The backend only ever produces the pre-arm states. The browser drives everything from
`phantom_requested` onward. Every live report distinguishes **prepared / simulated / Phantom-signed
/ submitted / confirmed / failed** — it never conflates "submitted" with "confirmed".

## Stopping everything: the kill switch

There are two independent stops, either of which blocks **all** live actions:

- **Config kill switch:** set `"killSwitch": true` in `soulmaker.config.json`.
- **Emergency stop:** set `SOULMAKER_EMERGENCY_STOP=1` in the environment.
- **Live Console kill switch:** the red button on the console immediately disables every dangerous
  control in that browser session.

Check the state any time with `pnpm soulmaker live:kill-switch`.

## Required configuration

- `soulmaker.config.json` — `mode`, `killSwitch`, and `rpcUrl` (a public mainnet RPC; **no API key
  is hardcoded** anywhere in this repo). See `soulmaker.config.example.json`.
- A mainnet RPC URL you trust, passed via `--rpc-url` or `SOULMAKER_RPC_URL`. Public endpoints work
  for low volume; for anything serious, bring your own.
- Phantom browser extension, set to **Mainnet**, holding a **small** amount of SOL you can afford to
  lose entirely.

No secret, seed phrase, or private key is ever required, stored, printed, logged, or committed.

## What Sol Maker does **not** guarantee

- **No profit.** None. Memecoin trading is adversarial and frequently a loss.
- No protection against a rug, honeypot, freeze authority abuse, or a malicious pool — the risk
  engine flags what it can read, but absence of a flag is **not** safety.
- No guarantee a prepared transaction will land: blockhashes expire (~60–90s), routes go stale, and
  a slow confirmation can still fail. Build fresh and confirm quickly.
- No MEV / sandwich protection in Part 1.

## Known memecoin risks (non-exhaustive)

Rug pulls, honeypots (you can buy but not sell), freeze/mint authority abuse, fake liquidity,
sandwich/MEV extraction, slippage on thin pools, expired blockhashes, copy-paste mint scams, and
total, instant, irreversible loss. The micro caps exist because of all of this. Keep them tiny.

## Remaining work

### Part 2 of 3 (not in this build)

- An autonomous watcher/sniper loop **behind strict arming** (still human-gated to start).
- Real-time pool/mint discovery and faster route refresh.
- Better memecoin-specific scoring and a canary→small-position escalation policy.
- Provider redundancy and hardened confirmation/reconciliation.
- A consolidated live command-center dashboard.

### Part 3 of 3 (not in this build)

- A backtesting/strategy feedback loop tied to live outcomes.
- Multi-chain adapters (the `ChainAdapter` boundary exists; EVM chains are disabled stubs today).
- Deployment hardening, alerting, a cloud/local operator mode, and production runbooks.
- Final release packaging.

---

**Disabled by default. Micro-capped. Human-confirmed. No key custody. No profit promise.**
