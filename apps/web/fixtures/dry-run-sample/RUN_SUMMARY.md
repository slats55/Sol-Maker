# PAPER Dry-Run Summary

> **SIMULATION ONLY** — this run never signs, never sends, never authorizes live trading.
> Phase 7 (live/burner trading) is NOT authorized. `phase7LiveTradingReady` is literally `false`.

- **Run label:** rehearsal-rich
- **Operator:** rehearsal-operator
- **Operator verdict:** `blocked`
- **Route resolution:** unavailable (expected — no route resolver exists inside the simulation boundary; nothing was faked; resolver attempted: false)
- **Readiness verdict (verbatim):** true
- **Chain blocking conditions:** 1

**What happened:** One PAPER dry-run chain collected: 13/13 artifacts strictly valid (0 missing, 0 invalid); 1 chain blocking condition(s); route resolution: unavailable; readiness verdict (verbatim): phase6 SIMULATION ready (never live readiness); operator verdict: blocked.

## Blocking conditions

Chain blocking codes (verbatim):

- `simulation-blocked-prereqs-not-ready`

- simulation-blocked-prereqs-not-ready: The v2 Phase-6 prerequisite report is valid but not every readiness bucket is met — resolve the not-met items before simulating. (When the ONLY unmet item is NO_OPERATOR_BLOCKING caused by paper-enters awaiting review, an explicit operator acknowledgment may stand in for that one review item.)

## What to inspect next

- Resolve the chain blocking conditions listed verbatim above, rebuild the affected artifacts, then re-run paper:simulation:audit.
- Route resolution is honestly UNAVAILABLE (no route-resolver capability exists inside this boundary) — that is the expected Phase 6 state, not an error.

## Artifacts

| role | file | digest | state |
| --- | --- | --- | --- |
| decision | decision.json | sha256-128:ec7cff7dd4165f5fb9bd01ac56cebdb3 | valid |
| run-report | run-report.json | sha256-128:c0f7262de13de65b20a3c1f63c7b56e4 | valid |
| safety-gates | safety-gates.json | sha256-128:3c9aeb2b179cea79ceba8e0354c48618 | valid |
| prereqs | prereqs.json | sha256-128:3ec77bf87fd47219a96f120491a4f387 | valid |
| kill-switch-spec | kill-switch.json | sha256-128:0128f29af6c9133b9403d6ec019c249c | valid |
| secrets-policy | secrets-policy.json | sha256-128:ceb4d8080eda561ae9e7763ab8e5a9fc | valid |
| burner-isolation-spec | burner-isolation.json | sha256-128:1e31dc8290bd298e2721d396660062ae | valid |
| intent-plan | intent-plan.json | sha256-128:50bc29a2249e4c93cd06b693f87e7199 | valid |
| simulation-result | simulation-result.json | sha256-128:927d2c98e0731450a60865356a9eda50 | valid |
| route-resolution | route-resolution.json | sha256-128:2dc423abf15a9a8e6d5b1b26787d7de2 | valid |
| audit-report | chain-audit.json | sha256-128:3014e2c74d3ea41ddca860537269ab04 | valid |
| readiness-report | readiness.json | sha256-128:7f3c19f1af9a363df5b472e30ad0255c | valid |
| handoff-pack | handoff-pack.json | sha256-128:688ec6f25fe512ad95fa2fe9fbe07ad2 | valid |

Diffs are not applicable to a single run — compare two runs with `paper:simulation:diff:plan` / `paper:simulation:diff:result`.

Inspect this folder in the web inspector: `pnpm web:inspect --dir <this directory>`.
