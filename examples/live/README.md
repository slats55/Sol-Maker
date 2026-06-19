# Live (Phantom-bridge) example artifacts — Part 1 (Sprint 107)

Committed, deterministic example artifacts for the `@soulmaker/live` schemas. They are regenerated
with:

```bash
pnpm tsx scripts/gen-live-examples.ts
```

and pinned by `packages/live/src/examples.pin.test.ts` (each must still validate against the
production validators). Every artifact is **paper-safe**: it carries no key, no secret, and pins the
honesty literals (`backendCustodiesNoKeys`, `signed:false`, `phase7LiveTradingReady:false`, …). The
fee payer / mints are public addresses used only as fixtures and are never used live.

| file | schema | what it shows |
| --- | --- | --- |
| `policy.live-canary.example.json` | `live.policy.v1` + evaluation | a fully-configured `live_canary` policy whose gate is `prepareAllowed: true` |
| `policy.paper-default.example.json` | `live.policy.v1` + evaluation | the default policy — everything live blocked |
| `canary-request.preflight-ready.example.json` | `live.canary.request.v1` | a green request ready to arm in the Live Console (state `preflight_ready`) |
| `canary-request.blocked-by-risk.example.json` | `live.canary.request.v1` | a request blocked by a REJECT risk verdict |
| `canary-request.blocked-by-policy.example.json` | `live.canary.request.v1` | a request blocked because the policy is paper / live-disabled |
| `candidate-decision.live.example.json` | `live.candidate.decision.v1` | a strong, clean candidate scored as `live_canary_candidate` |
| `latency-report.example.json` | `perf.live.latency.report.v1` | measured per-stage latency from `pnpm bench:live` (machine-specific, illustrative) |

These are **examples**, not live results. Nothing here was signed, sent, or confirmed on chain. See
[`../../docs/LIVE_EXECUTION_PHANTOM.md`](../../docs/LIVE_EXECUTION_PHANTOM.md).
