# scripts/

Operational and maintenance scripts (kept thin; all real logic lives in
`packages/`).

Today the useful entry points are npm scripts at the repo root:

| Command              | What it does                                  |
| -------------------- | --------------------------------------------- |
| `pnpm typecheck`     | `tsc --noEmit` across the whole monorepo      |
| `pnpm lint`          | ESLint (flat config)                          |
| `pnpm test`          | Vitest, one-shot                              |
| `pnpm check`         | typecheck + lint + test                       |
| `pnpm soulmaker ...` | run the CLI (`doctor`, `config:check`, `mode`, `paper:status`) |

Future scripts (later phases) will live here, e.g. a burner-wallet keygen that
prints **only the public key** and writes the secret to an OS keychain / env,
and a one-shot safety preflight for CI. None exist yet — added with tests when
their phase lands.
