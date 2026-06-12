# Phase 7 — gated live execution architecture (Sprint 92)

> **Default state: live trading is DISABLED and structurally impossible to trigger accidentally.**
> This document describes the architecture that makes a live path *real, audited, and gated* —
> not an instruction to enable it. Nothing here is on by default; mainnet sending has **no CLI
> surface** in this sprint.

## The capability classes, separated by package

Sprint 92 split execution into separately-reviewed packages, each structurally fenced by
import-allowlist and forbidden-token tests:

| Package | Capability | Can it sign? | Can it send? |
| --- | --- | --- | --- |
| `@soulmaker/quotefetch` | read-only quote fetch (HTTP) | no | no |
| `@soulmaker/realtime` | read-only candidate feeds (HTTP) | no | no |
| `@soulmaker/txpreview` | `simulateTransaction` over UNSIGNED envelopes (`sigVerify:false`) | no | no |
| `@soulmaker/txbuilder` | build UNSIGNED swap transactions (HTTP) | no | no |
| `@soulmaker/execution` | mode resolution, the live gate, safety controls, the signer boundary, the send path | **yes — fenced to `signer.ts`** | **yes — fenced to `send.ts`** |

Signing exists in exactly one file (`signer.ts`); sending in exactly one file (`send.ts`). A
package-safety test fails the build if either capability token appears anywhere else.

## Execution modes (closed set, fail-closed resolution)

`resolveExecutionMode` maps an operator request to one of:

- `paper` — the default; no build, no sign, no send. **Unknown requests resolve here.**
- `readonly` — read-only intelligence only.
- `devnet-execution` — may build/sign/send **only on devnet**, and only when
  `SOLMAKER_ENABLE_DEVNET_EXECUTION=devnet-only` **and** the CLI flag
  `--acknowledge-devnet-execution` are both present.
- `mainnet-dry-run` — may build + simulate mainnet transactions; **can never send**.
- `mainnet-live-blocked` — mainnet live was requested but at least one gate failed. Blocked, with
  the full checklist attached.
- `mainnet-live-armed` — every one of the fourteen conditions passed.

## The fourteen-condition mainnet live gate

`evaluateMainnetLiveGate` returns `armed: true` **only** when all fourteen are satisfied. The
default state of every condition is *failed*, so the default state of the gate is **BLOCKED**.
There is no override, no force flag, no partial credit (a test asserts the gate source contains no
`override`/`bypass`/`force`/`unsafe` escape hatch, and that every single-condition near-miss stays
blocked).

1. `SOLMAKER_ENABLE_LIVE_TRADING` is **exactly** `I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK`.
2. config `phase7LiveTradingReady: true`.
3. the CLI flag `--i-understand-this-can-lose-real-money` was passed.
4. network is **exactly** `mainnet-beta`.
5. an explicit per-trade spend cap is set.
6. an explicit session/daily loss cap is set.
7. an explicit slippage cap is set.
8. the kill switch is explicitly clear (unknown → blocked).
9. the quote freshness check passed.
10. the exact envelope's latest simulation outcome is `simulated-ok`.
11. the advisory risk score is under an explicit cap.
12. the destination wallet public key validated.
13. a signer was loaded through the approved boundary.
14. an audit artifact path is set **and** zero redaction findings remain.

Live trading additionally requires the long-standing core gate
(`@soulmaker/core` `evaluateLiveGate` → `DANGEROUS_BURNER_LIVE`). The two gates are independent;
the operator surface requires **both**.

## The signer boundary

`loadLocalSignerBoundary` is the only place signing capability exists. It:

- handles **no seed phrases** — only the standard `solana-keygen` 64-byte JSON array;
- takes the keypair file **path from an environment variable NAME** — the path, file, and bytes
  are never logged, echoed, or serialized (`JSON.stringify` of a boundary yields a redaction
  marker; `util.inspect` carries no key material — tests assert both);
- is **devnet-first**: loading a `mainnet-beta` signer requires the **armed** fourteen-check gate
  result; a forged "armed with no checks" object is refused.

## The send path

`attemptExecution` is the only code that can submit a transaction, and it is refusal-first:

1. mode must be `devnet-execution` or `mainnet-live-armed` — every other mode refuses;
2. `mainnet-live-armed` re-verifies the full fourteen-check gate here;
3. every operator safety control must pass for this trade in this session;
4. the envelope must validate as strictly UNSIGNED and its network must match both the mode and
   the signer boundary;
5. only then: refresh the blockhash, sign through the boundary, submit **once** (no retry, no
   chase). Submission is **not** confirmation, and the report says so.

## Operator safety controls (enforced, not documented-only)

`evaluateSafetyControls` enforces, with required-by-design fields that refuse when absent: kill
switch, emergency-stop file/env, per-trade spend cap, max trades per session, session loss cap,
slippage cap, risk score cap, quote-age cap, allow/block mint lists, allowed-provider list,
network lock, audit-log-required, cooldown, and duplicate-mint protection. Controls only ever
*tighten*.

## What is and isn't reachable tonight

- **Reachable now:** `execution:status` (read-only checklist), `execution:build` (unsigned
  envelope), `paper:simulation:tx` (real simulation), `execution:devnet:send` (devnet-only, behind
  the double opt-in, journaled).
- **Deliberately NOT reachable:** mainnet sending has **no CLI command**. The architecture exists,
  the gate is implemented and tested, but there is no operator surface that submits a mainnet
  transaction in Sprint 92. Adding one is a future, separately-authorized step.

## Remaining blockers before any mainnet live send

- No mainnet send CLI surface exists (intentional).
- A real devnet broadcast needs a funded throwaway keypair + airdrop; the send path is proven by
  injected-RPC-seam tests and by a **real** devnet `simulateTransaction` run (`paper:simulation:tx`).
- Quote-freshness wiring into the live gate (condition 9) is a verdict the caller must compute from
  a fetch report's `fetchedAt` against the quote-age cap; the plumbing exists, an end-to-end
  mainnet wiring does not (and won't until separately authorized).
