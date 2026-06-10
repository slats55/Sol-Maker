/**
 * Sprint 59 — CLI COMMAND REFERENCE VALIDATOR.
 *
 * Command docs drift silently: a new command lands without a runbook row, or a doc keeps naming a
 * command that no longer exists. This test makes that drift LOUD, with no runtime dependency:
 *
 *  1. The REGISTERED `paper:sniper:*` / `paper:phase6:*` commands are parsed from the CLI's own
 *     source (`index.ts` `.command("…")` literals) and pinned against a curated expected list — so
 *     adding/removing a command forces a conscious update here.
 *  2. Every registered command must be documented in `docs/SNIPER_RUNBOOK.md` AND `README.md`.
 *  3. Every command-shaped token mentioned in those docs (and `docs/SNIPER_MODEL.md` +
 *     `examples/sniper/README.md`) must be a registered command — no ghost commands in docs.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const CLI_INDEX = join(HERE, "index.ts");

/** The curated, expected sniper/phase6 command surface (UPDATE THIS when a command is added/removed). */
const EXPECTED_COMMANDS: readonly string[] = [
  "paper:sniper:candidates:validate",
  "paper:sniper:preflight",
  "paper:sniper:preflight:input:validate",
  "paper:sniper:decide",
  "paper:sniper:workflow",
  "paper:sniper:report",
  "paper:sniper:diff:report",
  "paper:sniper:policy:validate",
  "paper:sniper:audit",
  "paper:sniper:session:pack",
  "paper:sniper:safety:gates",
  "paper:sniper:kill-switch:spec",
  "paper:sniper:secrets:policy",
  "paper:sniper:burner:isolation:spec",
  "paper:phase6:prereqs",
  "paper:phase6:intent:plan",
  "paper:phase6:diff:intent",
  "paper:simulation:intent:plan",
  "paper:simulation:result",
  "paper:simulation:validate",
  "paper:simulation:audit",
];

/** Docs that must cover every registered command. */
const REQUIRED_DOCS = ["docs/SNIPER_RUNBOOK.md", "README.md"] as const;

/** Docs whose command mentions must all be registered (superset of REQUIRED_DOCS). */
const SCANNED_DOCS = [...REQUIRED_DOCS, "docs/SNIPER_MODEL.md", "examples/sniper/README.md"] as const;

/** A command-shaped token: paper:sniper:… / paper:phase6:… / paper:simulation:… (colon/hyphen segments). */
const COMMAND_TOKEN = /paper:(?:sniper|phase6|simulation):[a-z0-9-]+(?::[a-z0-9-]+)*/g;

function registeredCommands(): string[] {
  const source = readFileSync(CLI_INDEX, "utf8");
  const names = [...source.matchAll(/\.command\("([^"]+)"\)/g)].map((m) => m[1] as string);
  return names
    .filter((n) => n.startsWith("paper:sniper:") || n.startsWith("paper:phase6:") || n.startsWith("paper:simulation:"))
    .sort();
}

function mentionedCommands(docPath: string): Set<string> {
  const text = readFileSync(join(ROOT, docPath), "utf8");
  return new Set([...text.matchAll(COMMAND_TOKEN)].map((m) => m[0]));
}

describe("CLI reference — registration vs. the curated expected list", () => {
  it("the registered sniper/phase6 commands are EXACTLY the expected list", () => {
    expect(registeredCommands()).toEqual([...EXPECTED_COMMANDS].sort());
  });

  it("registration parsing found a meaningful surface (guards against a broken regex)", () => {
    expect(registeredCommands().length).toBeGreaterThanOrEqual(17);
  });
});

describe("CLI reference — every registered command is documented", () => {
  for (const doc of REQUIRED_DOCS) {
    it(`${doc} documents every registered command`, () => {
      const mentioned = mentionedCommands(doc);
      const missing = registeredCommands().filter((c) => !mentioned.has(c));
      expect(missing, `${doc} is missing: ${missing.join(", ")}`).toEqual([]);
    });
  }
});

describe("CLI reference — no ghost commands in docs", () => {
  const registered = new Set(registeredCommands());
  for (const doc of SCANNED_DOCS) {
    it(`${doc} mentions only registered commands`, () => {
      const ghosts = [...mentionedCommands(doc)].filter((c) => !registered.has(c)).sort();
      expect(ghosts, `${doc} documents unregistered command(s): ${ghosts.join(", ")}`).toEqual([]);
    });
  }
});
