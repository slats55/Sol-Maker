# Soulmaker — Security Policy & Rules

Wallet safety is the **highest priority** of this project — higher than speed,
features, or convenience. This document is authoritative. If any other doc,
comment, or piece of code conflicts with it, this document wins.

## Threat model (why this project is paranoid)

The operator was previously **drained** after importing a wallet/private key
into an untrusted sniper bot. The primary adversary we defend against is
therefore **the trading software itself** (this code, its dependencies, and any
reference code we study), not just external attackers. Consequences of that:

- Secrets must never be in places software can casually exfiltrate (logs, error
  messages, crash dumps, committed files, telemetry).
- The blast radius of a total compromise must be tiny: **burner wallet, trivial
  funds, hard caps.**
- The system must be **auditable**: every live action is gated, simulated, and
  rendered as a human-readable plan before it happens.

## The non-negotiable rules

1. **Never** request, store, print, log, commit, transmit, or expose a Phantom
   (or any) **recovery / seed phrase**. Soulmaker has no feature that accepts a
   mnemonic, and must never grow one.
2. **Never** use the operator's **main wallet** for automated trading.
3. Any raw private-key mode is explicitly named **`DANGEROUS_BURNER_LIVE`** and
   is burner-only.
4. The **default mode is `PAPER`** (or read-only `WATCH_ONLY`). Safe by default.
5. **Live trading is impossible unless every live-mode gate passes** (see
   `docs/WALLET_SAFETY_MODEL.md`). The gate fails **closed**.
6. Hard limits are mandatory and enforced in the config schema itself:
   **max trade size, max daily loss, max open positions, and a kill switch.**
7. **Redacted logging** is mandatory and cannot be disabled. Redaction covers:
   private keys, seed phrases, RPC keys, API keys, bearer tokens, cookies,
   session tokens, and any key that looks like a wallet secret.
8. **No hidden developer fees, hidden transfers, referral transfers, or
   unreviewed destination accounts.** Every destination is explicit and
   reviewed.
9. **Every transaction is simulated before any live send** (later phases).
10. **Every transaction produces a human-readable transaction plan** before
    signing/sending. No blind signing.
11. **No "auto-approve everything"** wallet behavior.
12. No malicious wallet draining, phishing, credential exfiltration, or stealth
    transaction behavior — not against others, and nothing in this code that
    could do it to the operator.
13. Any eventual live mode uses a **fresh burner wallet** only.
14. **All code is tested before it is claimed to work.**
15. **No faked** test results, repo findings, or implementation status.

## How these rules are enforced in code today (Phase 0–1)

| Rule | Enforcement | Where |
| --- | --- | --- |
| Redaction mandatory | `logging.redact:false` is rejected by the schema | `packages/core/src/config/schema.ts` |
| Secrets never logged | Pattern + key-name redaction over every log record | `packages/security/src/redact.ts`, `logger.ts` |
| Safe by default | `mode` defaults to `PAPER`, `killSwitch` defaults off | `packages/core/src/config/schema.ts` |
| Hard caps | `max()` ceilings baked into the Zod schema | `packages/core/src/config/schema.ts` (`HARD_LIMITS`) |
| Live gate fails closed | `evaluateLiveGate` collects every failing reason | `packages/core/src/live-gate.ts` |
| No **backend** signing/sending | No key is ever loaded, signed with, or sent by the backend or the Rust engine | (entire backend; `crates/solmaker-engine/SAFETY.md`) |

These are covered by tests in `packages/*/src/**/*.test.ts` and
`apps/cli/src/commands.test.ts`.

## Part 1: the Phantom live bridge (Sprint 107)

Part 1 introduces the **first path that can lead to a real mainnet transaction** — and it does so
**without the backend ever holding a key**. The design keeps every rule above intact:

- **No backend key custody.** The backend and Rust engine never load, store, or sign with a key.
  They prepare an **unsigned** transaction (`txpreview.envelope.v1`) and wrap it in a
  `live.canary.request.v1`. Signing happens only in the operator's **Phantom** wallet, in the
  browser.
- **The only signing surface is the Live Console** (`apps/web/public/live-console.html`) — a single,
  **isolated** page (deliberately not part of the paper-only page registry) that calls Phantom's
  `signAndSendTransaction`. It is covered by its own dedicated test
  (`apps/web/tests/live-console.test.ts`), which asserts there is **no seed-phrase / private-key
  input**, that `@solana/web3.js` is pinned with an **SRI integrity hash**, and that the dangerous
  controls are gated by default.
- **Disabled by default, micro-capped, human-confirmed.** `@soulmaker/live` defaults to `paper` +
  `liveEnabled:false`; every cap is clamped to an absolute hard ceiling; a green simulation, a
  manual confirmation, and an audit log are all required before a request can reach `preflight_ready`.
- **No mainnet CLI send surface.** As before, no CLI command can sign, send, or arm anything; the
  command-surface audit (`apps/cli/src/command-surface-audit.test.ts`) still passes.
- **Kill switch + emergency stop** block every live action (config `killSwitch`, or
  `SOULMAKER_EMERGENCY_STOP=1`, or the Live Console's red button).

See `docs/LIVE_EXECUTION_PHANTOM.md` for the full operator flow. Rules 1, 2, 7, 10, 11, and 12 above
are unchanged and still binding.

## Secrets handling

- Real secrets live only in `.env` (gitignored) or, preferably later, an OS
  keychain. `.env.example` and `soulmaker.config.example.json` contain **no real
  values**.
- Config stores the **name** of the env var holding a burner key
  (`live.burnerKeyEnvVar`) — **never the key itself**.
- `.gitignore` blocks `.env*` (except the example), `soulmaker.config.json`,
  `*.key`, `*.keypair`, `*.wallet`, `secrets/`, and `burner/`.
- If you think a secret was committed or logged: rotate/abandon that burner
  immediately, treat the funds as lost, and never reuse the key.

## License & dependencies

- The Soulmaker **license decision is pending.** Until it is made, we do **not**
  vendor or copy third-party code — especially **GPL-3.0** code such as OctoBot.
- Reference repositories are **studied, not imported.** No reference code enters
  `packages/`/`apps/` without a recorded license review **and** security review
  in `docs/REFERENCE_REPO_AUDIT.md`.
- New runtime dependencies are added deliberately and reviewed. We explicitly
  avoid the kind of suspicious dependency noise found in reference repos (e.g.
  shipping `npm` or a one-letter package as a runtime dependency).

## Reporting

This is a private, single-operator project. "Reporting" = open an issue/notes
file for yourself and, if a secret is involved, **abandon the affected burner
first, investigate second.**
