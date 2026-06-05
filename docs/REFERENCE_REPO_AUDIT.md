# Reference Repository Audit

Audit of third-party repos used to accelerate Soulmaker's **design**. Nothing
here is copied or vendored into Soulmaker; see [`SECURITY.md`](../SECURITY.md) →
"License & dependencies".

## Method & scope (so this audit is honest)

- **Date:** 2026-06-05.
- **What was actually inspected:** GitHub API metadata (license SPDX, primary
  language, stars, archived, last push), the repository **root file listing**,
  and specific **text files read over HTTPS** (each repo's `package.json` and/or
  `.env.example`, and README excerpts). Inspection was **read-only** — no repo
  was cloned into the build, none was executed, and no funds/keys were involved.
- **What was NOT done:** a line-by-line source audit of every file (e.g. the full
  control flow of cortsdine's `bot.ts`/`transactions/`). Items requiring that are
  marked **"deep review pending."** No findings below are invented; security
  concerns are derived from the verified surface (license, dependency list, env
  template, README) and from general Solana-sniper risk patterns, and are labeled
  as such.

Recommendation vocabulary: **STUDY-ONLY** (read for ideas, import nothing),
**ADAPT-WITH-AUDIT** (a specific clean module may be re-implemented after a
documented per-file review), **AVOID** (do not use as a base; do not run).

---

## 1. Drakkar-Software/OctoBot

- **URL:** https://github.com/Drakkar-Software/OctoBot
- **License (verified):** **GPL-3.0**.
- **Language/stack (verified):** Python. ~6.0k★, actively maintained
  (pushed 2026-06-05), not archived.
- **Useful concepts:** mature **strategy engine**, **paper trading /
  backtesting**, clear **live vs. simulated** separation, plug-in/tentacle
  architecture, risk-first configuration, and overall UI/command-center layout.
  This is the best *architecture* reference of the set.
- **Security concerns:** large, general-purpose multi-exchange bot — broad
  surface, many dependencies. Not Solana-specific. No specific vulnerability
  reviewed (out of scope), but its size makes wholesale adoption inadvisable.
- **Wallet/key handling:** centralized-exchange API keys (not Solana private-key
  signing). Not a model for our burner/key handling either way.
- **Dependencies worth studying:** its strategy/evaluator abstractions and
  paper-trading/backtest design — as *patterns*, in Python, not as code to port.
- **License risk:** **GPL-3.0 is copyleft.** Copying or deriving code into
  Soulmaker would impose GPL on Soulmaker. Soulmaker's license is undecided and
  intended non-GPL, so **no code may be taken.**
- **Recommendation:** **STUDY-ONLY** (architecture & paper-trading concepts).
- **Final decision:** Use for *design inspiration only*. Do not copy any code.
  Re-evaluate only if the project explicitly elects GPL-3.0.

## 2. cortsdine/solana-trading-bot-v3

- **URL:** https://github.com/cortsdine/solana-trading-bot-v3
- **License (verified):** GitHub reports **MS-PL** (Microsoft Public License).
  ⚠️ Provenance is questionable: `package.json` lists `author: "Warp Zara"`,
  `homepage: warp.id` — i.e. this is a copy/fork of the well-known *warp-id*
  Raydium sniper, and the MS-PL `LICENSE.md` looks **bolted on** rather than the
  original project's terms. **Treat license as unsettled → do not import.**
- **Language/stack (verified):** TypeScript. ~223★, not archived, recently
  pushed. The GitHub **description is keyword-spam** ("solana trading bot" ×N) —
  a credibility red flag even though the code itself appears real.
- **Useful concepts (this is the most directly relevant reference):** verified
  from its `.env.example` and root layout — Raydium pool sniping, **snipe list**
  (`USE_SNIPE_LIST`, `snipe-list.txt`), **filters** (`CHECK_IF_MINT_IS_RENOUNCED`,
  `CHECK_IF_FREEZABLE`, `CHECK_IF_MUTABLE`, `CHECK_IF_SOCIALS`, `CHECK_IF_BURNED`,
  `MIN/MAX_POOL_SIZE`, `CONSECUTIVE_FILTER_MATCHES`), **TP/SL**
  (`TAKE_PROFIT`, `STOP_LOSS`), **slippage** (`BUY/SELL_SLIPPAGE`), **auto-sell**
  with retries, RPC + WebSocket endpoints, commitment level, and pluggable
  **transaction executors** (`default`/`warp`/`jito`). This directly informs our
  Phase 3 risk flags and Phase 4 TP/SL — as a **feature checklist**, not code.
- **Security concerns (from verified surface):**
  - **Raw `PRIVATE_KEY=` in a dotenv `.env`** — plaintext key on disk. This is
    exactly the pattern that gets wallets drained. Soulmaker rejects this model
    (env-var *name* only, burner-only, prefer keychain).
  - **`LOG_LEVEL=trace` by default** — verbose logging around signing increases
    the chance of a key/secret hitting logs. Soulmaker mandates redaction.
  - **Dependency red flags** in `package.json`: ships **`npm` as a runtime
    dependency** and a one-letter package **`i`** — both are unusual, add
    needless surface, and warrant suspicion (auto-generated/typo-squat-adjacent
    noise). Also `bip39` + `ed25519-hd-key` → **seed-phrase derivation**, which
    Soulmaker forbids entirely.
  - **Deep review pending:** the actual signing/sending logic in `bot.ts` and
    `transactions/`, and whether any hidden fee/tip/referral destination exists,
    have **not** been line-audited. Must be done before adapting *any* idea that
    touches building/sending.
- **Wallet/key handling:** single hot private key from env, used to sign live
  trades. No burner enforcement, no caps gate, no simulation-before-send
  guarantee observed in the config surface.
- **Dependencies worth studying:** `@raydium-io/raydium-sdk`,
  `@solana/web3.js`, `@solana/spl-token`,
  `@metaplex-foundation/mpl-token-metadata` (token/metadata + mint/freeze
  authority checks), `bs58`, `async-mutex` (serializing one-trade-at-a-time).
  These are the *legitimate* libraries we will likely use directly in Phases 2–3.
- **Recommendation:** **ADAPT-WITH-AUDIT** for *concepts and library choices*;
  **STUDY-ONLY** for any code until a per-file security + license review is
  recorded here. **Never run it with real funds or the main wallet.**
- **Final decision:** Primary **feature/architecture reference** for the Solana
  side. We re-implement filters/TP-SL/snipe-list cleanly in Soulmaker and reuse
  the same *upstream Solana libraries*, but **import no code** and **never adopt**
  its key-in-env / trace-logging model.

## 3. radioman/solana-trading-bot

- **URL:** https://github.com/radioman/solana-trading-bot
- **License (verified):** **NONE** (no license file). Legally **all rights
  reserved** — copying is not even permitted.
- **Language/stack (verified):** GitHub detects **no primary language**. Root
  contains only `.env.example`, `.gitignore`, `README.md`, and an `assets/`
  folder — **there is effectively no source code.** ~987★, which is
  **inconsistent** with a repo that contains no implementation.
- **What it actually is (verified from README):** a **promotional / affiliate
  "Trading Hub"** page — a list of **referral links** (Axiom `@423116`, Odin Bot,
  Bloom, etc.) with discount/bonus language. It is marketing, not a trading bot.
- **Security concerns:** the `.env.example` still asks for a raw `PRIVATE_KEY`.
  The combination of *no code + many inflated stars + a referral-link README +
  an `assets/` folder* matches the well-known pattern of low-trust "free Solana
  bot" repos. **Do not download, run, or follow its links as endorsements**, and
  obviously never enter a key anywhere it suggests.
- **Wallet/key handling:** n/a (no implementation) beyond the dangerous raw-key
  `.env` template.
- **Dependencies worth studying:** none.
- **Recommendation:** **AVOID.**
- **Final decision:** Not an implementation base and not a meaningful design
  reference. Its main value to Soulmaker is as a **concrete example of the
  untrustworthy-repo pattern** to defend against. Excluded.

## 4. SnipeTrade / Axiom-style workflows

- **URL/name:** Axiom (axiom.trade) and similar hosted Solana trading terminals;
  "SnipeTrade"-style workflows.
- **License/stack:** Proprietary, hosted SaaS. No open source to audit.
- **Useful concepts:** **UX/workflow inspiration only** — fast launch feeds,
  one-glance risk surface, position management, quick buy/sell ergonomics for a
  command center.
- **Security concerns / hard rules:** **Do not** scrape private sessions, reuse
  cookies/session tokens, bypass platform protections, or depend on undocumented
  private APIs. Any integration must use **official, documented** APIs with a
  reviewed, safe auth model — otherwise it stays purely a UX reference.
- **Wallet/key handling:** n/a to Soulmaker; we never hand keys to a third party.
- **Recommendation:** **STUDY-ONLY** (UX/workflow), pending official docs + a
  safe API model before any code-level integration.
- **Final decision:** Inspire the dashboard/command-center **UX** (Phase 8).
  No dependency, no scraping, no private-API coupling.

---

## Summary table

| Repo | License | Stack | Decision | One-line reason |
| --- | --- | --- | --- | --- |
| Drakkar-Software/OctoBot | GPL-3.0 | Python | STUDY-ONLY | Great architecture, but copyleft — no code copy |
| cortsdine/solana-trading-bot-v3 | MS-PL (questionable provenance) | TypeScript | ADAPT-WITH-AUDIT (concepts), STUDY-ONLY (code) | Most relevant features; dangerous key-in-env model + suspicious deps |
| radioman/solana-trading-bot | NONE | — (no code) | AVOID | Referral-link page, no implementation, inflated stars |
| Axiom / SnipeTrade-style | Proprietary | Hosted SaaS | STUDY-ONLY (UX) | Workflow inspiration only; no scraping/private APIs |

## Standing rules from this audit

1. **Import nothing** from any of these until a per-file license **and** security
   review is appended to this document.
2. We will use the **same upstream Solana libraries** the legit reference uses
   (`@solana/web3.js`, `@solana/spl-token`, `@raydium-io/raydium-sdk`,
   `@metaplex-foundation/mpl-token-metadata`) — those are first-party deps, not
   "reference code."
3. We explicitly **reject** the reference patterns of: raw private keys in
   `.env`, seed-phrase derivation, `trace`-level logging around signing, and any
   referral/affiliate destination.
