# Soulmaker Architecture

## Goals

1. **Safety is structural, not procedural.** Unsafe actions should be
   *impossible by construction* in the current phase, not merely discouraged.
2. **Separation of live vs. simulated.** Read/build/simulate are separated from
   sign/send, with the live boundary guarded by a single, well-tested gate.
3. **Auditable.** Config is validated and explicit; secrets are redacted;
   eventual transactions are simulated and previewed before sending.
4. **Original, minimal, tested code.** Reference repos accelerate *design*, not
   copy-paste.

## Monorepo shape

TypeScript-first **pnpm workspace**. Internal packages are consumed by their
source (`exports: "./src/index.ts"`) and run/tested via `tsx`/Vitest, so there
is no build step required for development. `tsc --noEmit` typechecks the whole
tree in one pass.

```
apps/cli          @soulmaker/cli       read-only command surface
apps/web          (Phase 7)            local dashboard (placeholder)

packages/security @soulmaker/security  redaction + redacting logger      [no deps]
packages/core     @soulmaker/core      config, modes, caps, LIVE GATE    [zod]
packages/solana   @soulmaker/solana    read-only chain access (Phase 2)  [web3.js, spl-token, security]
packages/risk     @soulmaker/risk      token risk flags + scoring (Phase 3)
packages/strategy @soulmaker/strategy  snipe list, entry/exit, TP/SL (Phase 4+)
packages/paper    @soulmaker/paper     paper trading engine (Phase 4)
packages/adapters @soulmaker/adapters  audited external integrations (Phase 5+)
```

### Dependency direction

```
        cli ─────────────┐
         │               │
         ▼               ▼
       core  ◄────── (security)
         ▲               ▲
         │               │
  solana/risk/strategy/paper/adapters  (later phases)
```

- `@soulmaker/security` has **zero dependencies** and depends on nothing else in
  the repo. It is the redaction chokepoint and must stay tiny and auditable.
- `@soulmaker/core` owns config, modes, caps, and the **live gate** — the single
  source of truth for "is a live send allowed?".
- Everything that could touch the chain (solana, strategy, paper, adapters) sits
  *below* core and must route any live intent through core's gate. `solana` is
  now implemented as a **read-only** layer (Phase 2); `strategy`, `paper`, and
  `adapters` remain typed placeholders. Note `@soulmaker/solana` depends on
  `@soulmaker/security` (for redaction) but **not** on `core` — the CLI is what
  composes config/modes (core) with the read-only client (solana).

## The live boundary

There is exactly **one** way to be allowed to sign/send: pass
`assertLiveModeAllowed(config, env)` in `packages/core/src/live-gate.ts`. It
fails **closed** and requires *all* of:

- `mode === "DANGEROUS_BURNER_LIVE"`
- `killSwitch === false`
- `live.acknowledgeBurnerRisk === true`
- `live.confirmFreshBurner === true`
- `live.burnerKeyEnvVar` set **and** that env var present
- `SOULMAKER_I_UNDERSTAND_BURNER_RISK === "true"` in the environment
- caps within hard limits

Mode → capability mapping lives in `packages/core/src/modes.ts`
(`capabilitiesFor`): only `DANGEROUS_BURNER_LIVE` has `canSend: true`. In the
current repo **no code consumes `canSend`/the gate to actually send** — there is
no signing/sending implementation at all. The gate and capability model exist so
that when execution is built (Phase 6) it has exactly one door to go through.

## Read-only Solana layer (`@soulmaker/solana`, Phase 2)

A small, read-only layer over `@solana/web3.js` / `@solana/spl-token`:

- `public-key.ts` — `parsePublicKey` / `isValidPublicKey` / `publicKeyToBase58`.
  Validates 32-byte public keys and **refuses secret-length input** (anything
  longer than a 44-char public key — e.g. an ~88-char secret key — is rejected
  with a pointed message). There is no path that treats input as a private key.
- `rpc-client.ts` — `createReadOnlySolanaClient(config)` builds a `Connection`
  and returns a **frozen** object exposing only read methods: `getRpcHealth`,
  `getVersion`, `getSolBalance`, `getTokenAccounts`, `getTokenMintInfo`. There is
  no `sendTransaction`/`signTransaction`/`requestAirdrop`/signer — a test asserts
  none exist and that the object is frozen. The client depends on a narrow
  `SolanaRpcLike` seam (a read-only subset of `Connection`), so unit tests inject
  an in-memory fake and never hit the network.
- `wallet-watch.ts` / `token-inspect.ts` — assemble structured, redacted reports
  (SOL balance + token accounts; mint decimals/supply/authorities) with an
  injectable clock for deterministic tests, plus human-readable formatters.

The endpoint is only ever shown as a **host** (`new URL(rpcUrl).host`), which
drops any `?api-key=` query, and all rendered output is passed through
`redactString` as a backstop. The CLI gates these commands on
`capabilitiesFor(mode).canReadChain` and refuses in `PAPER` mode unless
`--allow-paper-read` is passed; none of them require any burner/live env var.

## Configuration

- Sources, lowest→highest precedence: **schema defaults → `soulmaker.config.json`
  → `SOULMAKER_*` env vars** (`packages/core/src/config/load.ts`).
- Validated by a **strict** Zod schema (`schema.ts`): unknown keys rejected,
  hard caps enforced via `.max()`, redaction non-disableable via a refinement.
- `null` in JSON is treated as "unset" so optional fields fall back to defaults.

## Logging & redaction

- `@soulmaker/security` provides `createLogger`, a small JSON-lines logger with
  a **pino-compatible** interface (`info/warn/error/debug/child`). We own this
  boundary deliberately: redaction runs over **every field of every record** via
  pattern matching (bearer tokens, long base58/hex blobs, mnemonics, api-key
  query params) **and** key-name matching (`privateKey`, `seed`, `cookie`, …).
- Rationale for not starting with a third-party logger's path-based redaction: a
  secret must be scrubbed even when logged under an unexpected key or inside a
  free-form string. The interface is intentionally compatible so we can mount it
  onto a pino transport later for rotation/shipping without changing callers.

## Testing

- **Vitest**, configured at the root. Unit tests live beside code
  (`*.test.ts`). Cross-package integration tests will live in `tests/`.
- Security-critical behavior has **negative** tests: redaction proves secrets do
  not appear in output; the live gate proves it refuses unsafe config; the schema
  proves it rejects oversized caps and disabled redaction.

## Why this stack

- **TypeScript + Zod** → types *and* runtime validation of untrusted config.
- **pnpm workspace** → clear package boundaries; the security package can be kept
  dependency-free and small.
- **Vitest + tsx** → fast, no build step in dev.
- **@solana/web3.js / @solana/spl-token** (Phase 2+) → standard, read-only first.
- **OctoBot** (GPL, Python) informs the *separation of live vs. simulated*,
  strategy-engine, and paper-trading concepts only — no code is copied. See
  [`REFERENCE_REPO_AUDIT.md`](REFERENCE_REPO_AUDIT.md).
