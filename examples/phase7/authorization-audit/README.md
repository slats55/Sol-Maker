# Phase 7 authorization-audit examples (`phase7.authorization.audit.v1`)

These are **read-only** example outputs of `pnpm soulmaker paper:phase7:authorization:audit`. They
**authorize nothing** and **send nothing**. Every example pins `liveExecutionAuthorized: false`,
`neverSends: true`, and `phase7LiveTradingReady: false`.

The audit answers one question: *is the repository ready to be **considered** for a separately,
explicitly authorized S104 controlled mainnet micro-trade?* The verdict is **re-derived** from the
evidence and **defaults to `not-authorized`**.

| File | Verdict | Meaning |
| --- | --- | --- |
| `authorization-audit.design-only.example.json` | `authorized-for-design-only` | Every safety invariant is verified, but the operational micro-trade prerequisites (a confirmed devnet broadcast, a written sign-off) are still open. **This is the repo's honest current state.** |
| `authorization-audit.not-authorized.example.json` | `not-authorized` | The fail-closed default: one safety invariant is unverified, so live stays unauthorized. |

The best possible verdict, `ready-for-separate-microtrade-authorization`, still authorizes nothing —
it means the repo is ready to be *considered*. A controlled micro-trade requires a separate, explicit,
written user authorization first. See `docs/PHASE7_AUTHORIZATION_DOSSIER.md`.

Regenerate (byte-deterministic, through production code):

```
pnpm tsx scripts/gen-phase7-authorization-audit-example.ts
```

The pin test `apps/cli/src/phase7-authorization-audit-example.test.ts` fails if these files drift.
