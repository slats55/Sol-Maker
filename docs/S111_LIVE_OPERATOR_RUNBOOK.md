# SOL MAKER — LIVE OPERATOR RUNBOOK (Sprint 111)

Every command below was executed or test-verified on this branch. PowerShell syntax (Windows). Paths are relative to the repository root unless absolute.

**Safety rules (non-negotiable)**
- DO NOT use your primary (Phantom) wallet as the bot signer. Create a dedicated hot wallet (§3) and fund only what you are willing to lose.
- DO NOT put a seed phrase or private key into any command, env var, or file other than the `*.keypair` file the bot creates. Env vars hold a FILE PATH only.
- The keypair file is gitignored (`*.keypair`). Never share it, never commit it.
- A confirmed transaction is a fact; an edge is not. Nothing here is a profitability claim.

---

## 1. Environment

| Requirement | Verified value |
|---|---|
| Node | v22.19.0 |
| pnpm | 10.x (`pnpm-lock.yaml` frozen install) |
| Rust | only for `cargo test` (engine crate); not needed to operate |
| `NODE_ENV` | **must be unset**. A global `NODE_ENV=production` makes pnpm skip devDependencies and every gate falsely fails. `Remove-Item Env:NODE_ENV` for the session, and remove it from User/Machine env permanently. |

```powershell
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
pnpm install --frozen-lockfile
pnpm run typecheck; pnpm run lint; pnpm test
```

## 2. Configuration

Create `soulmaker.config.json` in the directory you run commands from (the CLI reads `<cwd>/soulmaker.config.json`):

```json
{
  "mode": "PAPER",
  "killSwitch": false,
  "rpcUrl": "https://api.mainnet-beta.solana.com",
  "caps": { "maxTradeSizeSol": 0.01, "maxDailyLossSol": 0.05, "maxOpenPositions": 2 },
  "phase7LiveTradingReady": true,
  "logging": { "level": "info", "redact": true }
}
```

`phase7LiveTradingReady: true` is one of the fourteen live-gate conditions. `caps.*` are ceilings: every explicit CLI cap must be ≤ these. `killSwitch: true` is a HARD STOP.

Environment (session):

```powershell
$env:SOULMAKER_RPC_URL = "https://api.mainnet-beta.solana.com"
$env:SOLMAKER_ENABLE_LIVE_TRADING = "I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK"   # exact sentence; required to arm
```

Use a private RPC provider for live operation if you can; the public endpoint rate-limits.

## 3. Create the dedicated hot wallet (once)

```powershell
pnpm soulmaker wallet:hot:create --out runs/hot.keypair
```
Prints ONLY the new public key. Never overwrites an existing file.

```powershell
$env:HOT_WALLET_FILE = "C:\<absolute path>\runs\hot.keypair"     # PATH only, never contents
pnpm soulmaker wallet:hot:pubkey --signer-env HOT_WALLET_FILE
pnpm soulmaker wallet:hot:pubkey --signer-env HOT_WALLET_FILE --wallet <PUBKEY>   # exit 0 = match, 1 = mismatch
```

## 4. Fund it

1. Copy the public key from step 3 and verify it independently (e.g. on a block explorer — it will show 0 SOL, no history).
2. From Phantom, send a SMALL amount to it (0.05–0.10 SOL is enough for several micro-trades + fees). Do not move your whole balance.
3. Wait for confirmation, then read it back with the bot's own read path:

```powershell
pnpm soulmaker wallet:watch --allow-paper-read <PUBKEY>
```

## 5. Live readiness (run before every live session)

```powershell
pnpm soulmaker live:readiness `
  --wallet <PUBKEY> --signer-env HOT_WALLET_FILE --rpc-url https://api.mainnet-beta.solana.com `
  --i-understand-this-can-lose-real-money `
  --max-spend-sol 0.005 --max-open-sol-exposure-sol 0.01 --max-open-positions 1 --max-trades-per-hour 2 `
  --session-loss-cap-sol 0.02 --slippage-bps 100 --max-price-impact-pct 1 --min-sol-reserve-sol 0.03 --risk-score-cap 40 `
  --ledger runs/live/ledger.json --status runs/live/status.json
```

Verdicts: `BLOCKED` (something material fails), `READY_TO_SIMULATE` (chain side green, signer/live config missing), `READY_TO_ARM` (every checkable gate green; arms nothing by itself). Each check prints `PASS | BLOCKED_* | FAIL_* | SKIPPED` with the reason.

## 6. Dashboard

```powershell
pnpm soulmaker live:status:serve --status runs/live/status.json --port 8378
```
Open **http://127.0.0.1:8378/live.html** — read-only, polls every 2 s. It shows `BACKEND OFFLINE` (server down), `NO LIVE STATUS` (no daemon has published), `STALE` (heartbeat older than 90 s), `DAEMON STOPPED`, `NO OPEN POSITIONS`, and never demo data. Raw status is under "Diagnostics".

## 7. Daemon — paper mode (no signer, no sends)

```powershell
pnpm soulmaker live:sniper:daemon --mode paper --out-dir runs/paper --duration-minutes 30 --poll-seconds 15 --rpc-url https://api.mainnet-beta.solana.com --apply-exits
```

## 8. Daemon — LIVE mode (autonomous, fails closed)

```powershell
pnpm soulmaker live:sniper:daemon --mode live --out-dir runs/live --duration-minutes 60 --poll-seconds 15 `
  --rpc-url https://api.mainnet-beta.solana.com --profile conservative `
  --i-understand-this-can-lose-real-money --wallet <PUBKEY> --signer-env HOT_WALLET_FILE `
  --max-spend-sol 0.005 --max-open-sol-exposure-sol 0.01 --max-open-positions 1 --max-trades-per-hour 2 `
  --session-loss-cap-sol 0.02 --slippage-bps 100 --max-price-impact-pct 1 --min-sol-reserve-sol 0.03 --risk-score-cap 40
```

Every cap is REQUIRED (there is no default that can trade). Startup order: config → arming → persistent ledger (`runs/live/ledger.json`, never wiped) → chain reconciliation (`reconcile.json`) → lingering-intent check (`intents.json`) → stop state → loop. Any blocker refuses to start. Exits are always applied in live mode. Ctrl+C writes the summary and a final `status.json` with `running:false`.

Artifacts in `--out-dir`: `status.json` (atomic, every loop), `ledger.json` (positions — the truth), `audit.jsonl` (every execution attempt, with public signatures), `decisions.jsonl` (every accept/reject with reasons), `intents.json`, `reconcile.json`, `summary.json`.

## 9. SAFE STOP — no new entries, exits continue

Either of:
```powershell
New-Item .soulmaker-no-entry -ItemType File          # in the directory the daemon runs from
$env:SOULMAKER_NO_NEW_ENTRIES = "true"
```
Remove: `Remove-Item .soulmaker-no-entry` / `Remove-Item Env:SOULMAKER_NO_NEW_ENTRIES`. Checked every tick.

## 10. HARD STOP — nothing sends (kill switch)

Any of:
```powershell
New-Item .soulmaker-emergency-stop -ItemType File
$env:SOULMAKER_EMERGENCY_STOP = "1"
$env:SOULMAKER_KILL_SWITCH = "true"
# or "killSwitch": true in soulmaker.config.json
```
Enforced by the execution core itself (gate condition `kill-switch-clear`), independently of the daemon. Under HARD STOP fired exits are journaled but NOT sent; clear the stop, then sell manually (§11) or restart the daemon.

## 11. Manual mainnet BUY / SELL (production path, no bypass)

Build + simulate, then send. `<CAPS>` = the same explicit cap flags as §5.

```powershell
# BUY
pnpm soulmaker token:risk <MINT> --allow-paper-read --out runs/live/risk.json --force
pnpm soulmaker execution:build --allow-paper-read --candidate-mint <MINT> --amount-sol 0.005 --slippage-bps 100 --wallet <PUBKEY> --risk runs/live/risk.json --request mainnet-dry-run --max-spend-sol 0.005 --slippage-cap-bps 100 --risk-score-cap 40 --max-quote-age-ms 8000 --out runs/live/buy.envelope.json --force
pnpm soulmaker paper:simulation:tx --envelope runs/live/buy.envelope.json --rpc-url https://api.mainnet-beta.solana.com --allow-paper-read --out runs/live/buy.sim.json --force
pnpm soulmaker execution:mainnet:send --envelope runs/live/buy.envelope.json --simulation runs/live/buy.sim.json --risk-score <score from risk.json> --signer-env HOT_WALLET_FILE --rpc-url https://api.mainnet-beta.solana.com --ledger runs/live/ledger.json --audit-log runs/live/audit.jsonl --i-understand-this-can-lose-real-money --max-spend-sol 0.005 --slippage-cap-bps 100 --risk-score-cap 40 --min-sol-reserve-sol 0.03 --out runs/live/buy.report.json --force
```
The simulation must be < 2 minutes old and the quote < 8 s old at send time — run the three commands back-to-back. Exit 0 = CONFIRMED (position written to the ledger with the signature), 2 = SUBMITTED-UNCONFIRMED (no position; reconcile), 1 = refused/failed.

```powershell
# SELL (position id from runs/live/ledger.json)
pnpm soulmaker execution:build --allow-paper-read --input-mint <MINT> --candidate-mint So11111111111111111111111111111111111111112 --amount-raw <tokenAmountRaw> --slippage-bps 100 --wallet <PUBKEY> --risk runs/live/risk.json --request mainnet-dry-run --max-spend-sol 0.005 --slippage-cap-bps 100 --risk-score-cap 100 --max-quote-age-ms 8000 --out runs/live/sell.envelope.json --force
pnpm soulmaker paper:simulation:tx --envelope runs/live/sell.envelope.json --rpc-url https://api.mainnet-beta.solana.com --allow-paper-read --out runs/live/sell.sim.json --force
pnpm soulmaker execution:mainnet:sell --position-id <positionId> --reason operator-manual --envelope runs/live/sell.envelope.json --simulation runs/live/sell.sim.json --risk-score 0 --signer-env HOT_WALLET_FILE --rpc-url https://api.mainnet-beta.solana.com --ledger runs/live/ledger.json --audit-log runs/live/audit.jsonl --i-understand-this-can-lose-real-money --max-spend-sol 0.005 --slippage-cap-bps 100 --risk-score-cap 100 --out runs/live/sell.report.json --force
```
Note: the sell envelope's `candidateMint` is the OUTPUT (SOL); `execution:mainnet:sell` keys the sell by the position's mint — pass the envelope as built. An unconfirmed sell leaves the position OPEN; reconcile before retrying.

## 12. Restart / recovery

Stop the daemon (Ctrl+C) and start it again with the same `--out-dir`. Startup reconciliation runs before the first loop and reports per position: `OPEN_CONFIRMED` (still held), `RECOVERED_OPEN` (buy landed during a crash; restored from journal + chain), `RECOVERED_CLOSED` (sell landed; close persisted now), `RESOLVED_FAILED` (tx failed; no position), `PENDING_RECONCILIATION` / `UNRESOLVED_TRANSACTION` (unknown — start refused), `CHAIN_BALANCE_MISMATCH` (ledger open, wallet holds 0, no sell journaled — start refused; resolve by hand), `ORPHANED_CHAIN_HOLDING` (a token in the wallet the bot never bought — ignored, never traded). Details in `runs/live/reconcile.json`. If the daemon died holding a token: read `ledger.json`, confirm the balance on chain, then either restart (auto-exit continues) or sell manually (§11).

## 13. Logs and truth

- `runs/<dir>/ledger.json` — positions (truth). `audit.jsonl` — every execution attempt. `decisions.jsonl` — every candidate verdict. `status.json` — dashboard source. `report.md` — human summary.
- Secrets never appear in any of them: the redactor scrubs key-shaped strings; transaction signatures are preserved only under signature-named fields.
