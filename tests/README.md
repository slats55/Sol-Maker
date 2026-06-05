# tests/

Unit tests live **next to the code** they cover (`*.test.ts` inside each
package's `src/`), which keeps them close to the implementation and easy to find.
Vitest is configured at the repo root (`vitest.config.ts`) to discover:

- `packages/**/*.test.ts`
- `apps/**/*.test.ts`

Run everything from the repo root:

```bash
pnpm test          # one-shot
pnpm test:watch    # watch mode
```

This top-level `tests/` directory is reserved for **cross-package integration
and end-to-end tests** that don't belong to a single package (added in later
phases — e.g. a full "load config → evaluate gate → refuse send" flow once the
Solana and execution packages exist).

Current coverage (Phase 0–1):

- `packages/security` — secret redaction (string, deep, key-name) and the
  redacting logger.
- `packages/core` — config schema validation (defaults, hard limits, strict
  mode, mandatory redaction) and the live-mode gate.
- `apps/cli` — the four read-only commands, including that output is redacted
  and the live gate stays CLOSED by default.
