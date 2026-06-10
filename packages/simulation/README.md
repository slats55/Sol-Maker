# @soulmaker/simulation

The **Phase 6 safe simulation foundation** — read-only, dry-run-only, deterministic.

## What this package is

Phase 6 work was explicitly authorized to begin as **simulation only**. This package consumes the
already-validated `@soulmaker/sniper` v2 artifact chain (paper decision report v2, safety gates v2,
Phase-6 prerequisite report v2) plus the three adopted governance specs (kill-switch spec, secrets
policy, burner isolation spec) and produces deterministic simulation artifacts: intent-plan previews
and simulation results.

## What this package can never do

The boundary is enforced by source-scan and dependency tests, not by convention:

- **It can never authorize live trading.** Every artifact carries
  `neverAuthorizesLiveTrading: true` as a validated literal; flipping it fails validation.
- **It never signs.** No key material, no key import, no signing surface exists anywhere in the
  package, and the forbidden-token scan refuses any attempt to add one.
- **It never sends.** No transaction-submission surface exists; the forbidden-import scan refuses
  every network/chain capability module (`@solana/*`, `@soulmaker/solana`, `http`, `net`, …).
- **It is dry-run only.** Where a real on-chain dry-run is structurally impossible without
  transaction material, the package does **not** fake one — it records the dry-run as
  `unavailable` with an honest reason code.
- **It is deterministic.** No wall-clock, no randomness; the same inputs always produce a
  byte-identical artifact.

Allowed dependencies are exactly `@soulmaker/sniper` (artifact types/validators) and
`@soulmaker/security` (redaction). Anything else fails the package-boundary test.

## Phase boundary

Phase 6 = simulation. **Phase 7 (live/burner trading) is NOT started, NOT authorized, and cannot
be authorized from here.** A green simulation chain is local readiness evidence only — it is never
permission to build, sign, or send a transaction.
