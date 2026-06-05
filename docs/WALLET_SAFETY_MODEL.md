# Soulmaker Wallet Safety Model

This document defines how Soulmaker handles (and mostly *refuses to handle*) keys
and funds. It implements the rules in [`SECURITY.md`](../SECURITY.md).

## Core principles

1. **Default to no custody.** `PAPER` and `WATCH_ONLY` need **no** private key at
   all. The vast majority of the bot's life is spent here.
2. **Public keys are not secrets.** Watching addresses, balances, and pools needs
   only public keys — never a private key or seed.
3. **Seeds never exist in Soulmaker.** There is no code path that accepts a
   mnemonic / recovery phrase, and there must never be one. (Reference bots that
   import seeds via `bip39`/`ed25519-hd-key` are explicitly *not* a model to copy
   — see [`REFERENCE_REPO_AUDIT.md`](REFERENCE_REPO_AUDIT.md).)
4. **Live = burner only, tiny funds, hard caps.** A full compromise must cost
   only what is in a throwaway burner.

## Modes (safest → most dangerous)

| Mode | Needs a key? | Reads chain | Builds tx | Simulates | **Sends** |
| --- | --- | --- | --- | --- | --- |
| `PAPER` (default) | no | no | no | no | no |
| `WATCH_ONLY` | no (pubkeys) | yes | no | no | no |
| `SIMULATION` | no | yes | yes | yes | **no** |
| `DANGEROUS_BURNER_LIVE` | burner secret | yes | yes | yes | **yes** |

Capabilities are defined in `packages/core/src/modes.ts`. Only
`DANGEROUS_BURNER_LIVE` has `canSend: true`.

## The live-mode gate (fail-closed)

Before *any* future signing/sending code runs, it must pass
`assertLiveModeAllowed(config, env)` (`packages/core/src/live-gate.ts`). The gate
returns the **complete list** of failing reasons and refuses unless **all** hold:

1. `mode === "DANGEROUS_BURNER_LIVE"`.
2. `killSwitch === false`.
3. `live.acknowledgeBurnerRisk === true` — operator acknowledges total-loss risk.
4. `live.confirmFreshBurner === true` — operator confirms a fresh throwaway
   wallet.
5. `live.burnerKeyEnvVar` is set **and** that environment variable is present.
6. Out-of-band env flag `SOULMAKER_I_UNDERSTAND_BURNER_RISK === "true"`.
7. Caps within the hard limits (`HARD_LIMITS`).

Why a separate out-of-band env flag (#6) **and** config flags (#3–#5)? So that
arming live mode requires editing **two different surfaces** (a committed-style
config *and* the live environment). Neither alone is enough. A leaked or
copy-pasted config cannot, by itself, enable sending.

## Phase 2: read-only access uses PUBLIC KEYS ONLY

The Phase 2 Solana layer (`@soulmaker/solana`) reads public chain state and
**never touches secret material**:

- Every key it accepts is a **public** key. `parsePublicKey` validates 32-byte
  public keys and **refuses secret-length input** — anything longer than a
  44-char public key (e.g. an ~88-char base58 secret key) is rejected with
  "Refusing (never paste a private key or seed phrase)". You cannot paste a
  private key into `wallet:watch` / `token:inspect` / `token:accounts` and have
  it silently accepted.
- The read-only client is a **frozen** object exposing only read methods. There
  is no `sendTransaction`, `signTransaction`, `requestAirdrop`, or signer on it
  (asserted by tests). No secret key is ever held, logged, or required.
- These commands require **no** burner/live environment variables. They are
  gated on `capabilitiesFor(mode).canReadChain` and refuse in `PAPER` mode unless
  the operator passes `--allow-paper-read` (an explicit, documented opt-in to
  read chain while otherwise fully simulated).
- RPC endpoints are shown as **host only**; any `?api-key=` is dropped and output
  is redacted as a backstop. An RPC URL is config, not a wallet secret.

## Key handling rules (for when Phase 6 arrives)

- The config stores only the **name** of the env var holding the burner key
  (`live.burnerKeyEnvVar`), **never** the key. The key is read **at send time**,
  used to sign, and never persisted, returned, or logged.
- The key value is treated as radioactive: it is never put into any object that
  gets logged. The redaction layer is a backstop, not the primary defense — the
  primary defense is *not handing the key to loggable structures at all.*
- Preferred long-term storage: an **OS keychain**, not `.env`. `.env` is the
  acceptable interim for a burner with trivial funds.
- A burner key generator (later) will print **only the public key** to the
  terminal and write the secret straight to the keychain/env — never echoing it.

## Destinations & transfers

- **No hidden transfers.** Every destination account in a future transaction plan
  is explicit and shown in the human-readable preview.
- **No developer fee, referral skim, or "tip to unknown address."** If a fee or
  tip account is ever added, it is named, documented here, and visible in the
  preview before signing.
- Reference bots that contain referral/affiliate behavior are a reason to
  **reject** that code, not adopt it.

## What Soulmaker will never do

- Accept or derive from a seed phrase.
- Use the operator's main wallet.
- Auto-approve transactions or sign without a rendered plan.
- Send to an address the operator hasn't seen in the preview.
- Log, transmit, or persist a private key or seed.
- "Sweep," "migrate," or "consolidate" funds to any address on its own.
