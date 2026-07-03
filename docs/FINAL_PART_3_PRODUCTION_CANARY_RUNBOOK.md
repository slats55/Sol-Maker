# Final Part 3 — Production Canary Runbook (Supervised Operator Release)

This is the **human operator runbook** for the Part 3 supervised canary release (Sprint 109).
It walks one person through one tiny, supervised, Phantom-confirmed canary — from wallet setup to
reconciliation — using the production operator surface:

```
live:operator:validate          # strict fail-closed config validation
live:operator:session:start     # create the append-only session journal
live:operator:run               # the supervised recommend-only pass (off/observe_only/paper_shadow/armed_canary)
live:operator:session:status    # journal status (pause / re-arm / lifecycle tallies)
live:operator:session:export    # the artifact the operator dashboard loads
live:operator:reconcile         # post-canary accounting: balances, slippage, honest PnL
```

**What this system will never do:** hold a seed phrase or private key, sign a transaction, or send
a transaction. The backend prepares at most an UNSIGNED request; **you** approve or reject every
real transaction in **your** Phantom wallet, in your browser. Large trades are disabled
(`largeTradesEnabled: false` is a pinned literal), and every cap is clamped to a hard ceiling
(canary ≤ 0.05 SOL absolute; default 0.005 SOL).

---

## 0. Before you start — the non-negotiables

- Read `SECURITY.md`. It wins over everything, including this document.
- **Never** type a seed phrase or private key anywhere near this software. It has no field for one,
  and every validator refuses secret-named/secret-shaped input. If anything ever asks — stop; that
  is an attack.
- Trade only from a **burner** Phantom wallet with tiny funds. Assume total loss is possible.
- One canary at a time. One per session by default. No exceptions, no "just one more".

## 1. Burner wallet setup (once)

1. Create a **new** wallet in Phantom (Add / Create new wallet). This is the burner. Never reuse
   your main wallet, and never import the burner's key anywhere else.
2. Write the burner's **public** address down — the config wants it as `walletPublicKey` so every
   artifact names which wallet the human will sign from. The public key is safe to share; the seed
   phrase is not, ever, with anyone or anything.
3. Fund it **tiny**: the canary spend + fees + rent headroom. For the default 0.005 SOL canary,
   ~0.02 SOL total is plenty. Never fund more than you are fully prepared to lose.

## 2. Write and validate the operator config

Copy `examples/live/part3/operator-config.example.json` and edit it. Every field is required —
missing fields fail closed. Notable rules:

- `rpcEndpointHttps` must be a plain `https://` URL with **no query string and no userinfo** —
  URL-embedded API keys are refused. A keyed endpoint belongs only in the browser live console.
- `mode` is the **ceiling**: a run can request the same or weaker, never stronger.
- `walletPublicKey` is required for `armed_canary` (base58, 32–44 chars — never anything longer).
- The pinned literals must read exactly: `phantomApprovalRequired: true`,
  `largeTradesEnabled: false`, `backendCustodiesNoKeys: true`, `backendNeverSends: true`.

```bash
pnpm soulmaker live:operator:validate --config runs/operator-config.json
pnpm soulmaker live:operator:validate --config runs/operator-config.json --out runs/config-validation.json
```

Fix anything it refuses. Do not work around it — the refusal is the feature.

## 3. Start the session journal

```bash
pnpm soulmaker live:operator:session:start \
  --session-log runs/session.jsonl --session-id canary-$(date +%Y%m%d) --operator "<your label>"
```

The journal is **append-only** (strict sequence numbers, no rewrites, closed after
`session_ended`). It is the durable memory: caps, cooldown, pauses and manual re-arms survive
restarts because they are derived from this file. It never contains a secret — full transaction
signatures are stored as prefix references; the **slot** is the durable lookup key.

## 4. Warm up in the safe modes (required)

Run observe first, then paper-shadow, over a real snapshot (`paper:realtime:snapshot`) or manual
mints paired with real `token:risk --json` output and quote facts:

```bash
pnpm soulmaker live:operator:run --config runs/operator-config.json --mode observe_only \
  --snapshot runs/snapshot.json --risk <MINT>=runs/risk.json --quote <MINT>=runs/quote.json \
  --session-log runs/session.jsonl --out runs/run-observe.json

pnpm soulmaker live:operator:run --config runs/operator-config.json --mode paper_shadow \
  --snapshot runs/snapshot.json --risk <MINT>=runs/risk.json --quote <MINT>=runs/quote.json \
  --session-log runs/session.jsonl --out runs/run-shadow.json
```

Neither mode can recommend a canary (tested); both journal everything. If anything looks wrong
here, it will look wrong in armed mode too. Stop and investigate.

## 5. The dashboard

```bash
pnpm web:build
# open apps/web/public/operator-dashboard.html in a browser
```

Load, as plain JSON files: the config validation, the latest run report, the session export
(`live:operator:session:export --out`), and later the reconciliation. The dashboard is read-only —
it shows mode/safety state, the candidate feed, risk cards, the canary/Phantom lifecycle,
paper/live positions, PnL, and the session timeline. It cannot sign; its canary buttons are
permanently disabled and route you to the CLI + Live Console.

## 6. The canary — supervised, one only

**Checklist before arming (all must be true):**

- [ ] Config validates; `armed_canary permitted: yes`; kill switch + emergency stop clear.
- [ ] Burner funded tiny; Phantom unlocked on **mainnet**; you are on the machine.
- [ ] Observe + shadow runs looked sane; the candidate's risk report is clean and YOU read it.
- [ ] Quote is fresh (within the config TTL) and the spend is ≤ the config canary cap.
- [ ] Session journal shows no pause pending re-arm (`live:operator:session:status`).
- [ ] You have time to finish reconciliation immediately after.

**Armed run (recommend-only):**

```bash
pnpm soulmaker live:operator:run --config runs/operator-config.json --mode armed_canary \
  --snapshot runs/snapshot.json --risk <MINT>=runs/risk.json --quote <MINT>=runs/quote.json \
  --session-log runs/session.jsonl --escalation-armed --spend-sol 0.005 \
  --alert-console --out runs/run-armed.json
```

At most ONE candidate can come back `CANARY*` (recommended). That is a **recommendation, not an
instruction** — review it yourself. Then the human path, exactly as in Parts 1–2:

1. `pnpm soulmaker live:canary:prepare --candidate-mint <MINT> --risk runs/risk.json --envelope runs/envelope.json … --out runs/request.json`
   (build the UNSIGNED request; see `docs/LIVE_SNIPER_CANARY_RUNBOOK.md` for the full flags).
2. Open `apps/web/public/live-console.html`, load `runs/request.json`, connect the **burner**
   Phantom, verify mint / amount / slippage **in the Phantom popup itself**.
3. Approve **or reject** in Phantom. You are the only signer. Rejecting is always a valid outcome.

**Record the outcome in the journal** (pending → submitted → confirmed/rejected/timeout events are
appended by the tooling where possible; anything manual goes in as honest `note` events).

## 7. Reconcile immediately

Capture pre/post balances (the console shows them; a public RPC works too), then:

```bash
pnpm soulmaker live:operator:reconcile --candidate-mint <MINT> \
  --facts runs/facts.json --pre runs/pre.json --post runs/post.json \
  --token-decimals <N> --quoted-out-raw <QUOTED_RAW> \
  --session-log runs/session.jsonl --out runs/reconciliation.json
```

The record computes gross token received, SOL spent, fees, realized slippage vs the quote, and an
honest PnL classification (`unknown` when evidence is missing — it never estimates silently).
Confidence is re-derived from the facts; aim for HIGH (signature + settled status + both balance
snapshots). Then export the session for the dashboard and the dossier:

```bash
pnpm soulmaker live:operator:session:export --session-log runs/session.jsonl --out runs/session-export.json
```

## 8. Emergency stop procedure

Any doubt ⇒ stop. In order:

1. **Reject in Phantom** (if a popup is open). Nothing signed = nothing spent.
2. Set `"killSwitchEngaged": true` (or `"emergencyStopEngaged": true`) in the operator config.
   Every subsequent run — even observe — is blocked and journaled as blocked (tested).
3. `pnpm soulmaker live:kill-switch` shows the Part 1 global state; the same switches gate
   `live:canary:prepare`.
4. If a transaction was already submitted, do NOT panic-trade. Reconcile (step 7), record honest
   facts, and stop for the day.

A pause (rejection, timeout, kill switch, emergency stop) **stays** paused until a human runs the
next armed pass with `--record-manual-rearm "<label>"`. The flag exists so re-arming is an
explicit, journaled decision — never a default.

## 9. Evidence to save (all of it)

Keep the whole `runs/` folder for the session (it is gitignored):

- `operator-config.json` + `config-validation.json`
- `session.jsonl` + `session-export.json`
- every `run-*.json` report
- the unsigned `request.json`
- `facts.json`, `pre.json`, `post.json`, `reconciliation.json`
- the alert file if you enabled `--alert-webhook-file`

The slot number and signature **prefix** identify the transaction durably; the full signature stays
in your wallet history and the facts file (never in a committed file — the repo safety scanner
refuses signature-length base58).

## 10. What NOT to do

- Do NOT import the burner (or any) private key into this software. It has no place for one.
- Do NOT edit caps upward past a refusal. Refusals are load-bearing.
- Do NOT run a second canary because the first "looked fine". One per session. Cooldown applies.
- Do NOT scale the size. `largeTradesEnabled` is false and stays false — see below.
- Do NOT approve a Phantom popup whose mint/amount/slippage you did not personally verify.
- Do NOT paste RPC endpoints with embedded API keys into the config (they are refused anyway).
- Do NOT trade from a machine you do not control, and do not let alert forwarding leak artifacts.

## 11. Why large trades remain disabled

The Part 3 release is a **supervised canary** release: its purpose is to prove the full pipeline —
discovery → risk → quote → recommendation → human Phantom signature → reconciliation — with the
smallest possible real value at risk. Position sizing, PnL-aware strategy, latency competitiveness
and portfolio risk are **not** proven, and one canary is not evidence of profitability
(`notProfitabilityClaim: true` is pinned into every artifact on purpose). Escalating size before
the canary stage is proven — and separately authorized **in writing** — would put real money behind
unproven behaviour. The ceilings are enforced in code (caps only tighten), so a bigger trade
requires a deliberate, reviewed code change, not a config edit at 2am.

## Alert forwarding (optional, local-only)

`--alert-console` prints one redacted line per event. `--alert-webhook-file runs/alerts.jsonl`
appends webhook-style JSON payloads to a **local file** — no network sink exists here by design
(a webhook URL is a secret and posting is a network side effect). If you want Discord/Telegram,
run your own forwarder over that file, outside this codebase, e.g.:

```bash
tail -f runs/alerts.jsonl | while read -r line; do
  curl -s -H "Content-Type: application/json" -d "{\"content\": $(printf '%s' "$line" | jq -Rs .)}" "$YOUR_WEBHOOK_URL" >/dev/null
done
```

You own that forwarder and its secret; the release stays secret-free.
