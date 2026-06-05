# references/ — study-only clones (NOT committed, NOT run with funds)

This directory is where reference repositories may be **cloned locally for
reading and auditing only**. The clones themselves are gitignored (see
`.gitignore`) so untrusted third-party code is never committed into Soulmaker.

## Rules

1. **Study only.** Do not import, vendor, or copy code from a reference repo
   into `packages/` or `apps/` until its license **and** a security review are
   documented in [`docs/REFERENCE_REPO_AUDIT.md`](../docs/REFERENCE_REPO_AUDIT.md).
2. **Never run reference code with real funds**, and never with the user's main
   wallet. Treat all wallet/private-key handling in references as hostile until
   audited.
3. **License hygiene.** OctoBot is GPL-3.0 — do **not** copy its code into this
   (non-GPL) project. Patterns and ideas only.
4. Prefer cloning at a pinned commit and recording that commit hash in the audit
   doc so findings are reproducible.

## Suggested layout (when you clone)

```
references/
  octobot/                 # Drakkar-Software/OctoBot   (GPL-3.0, study only)
  solana-trading-bot-v3/   # cortsdine/...              (audit wallet handling)
  solana-trading-bot/      # radioman/...               (feature inspiration)
```

Nothing here is loaded by the build, tests, lint, or typecheck.
