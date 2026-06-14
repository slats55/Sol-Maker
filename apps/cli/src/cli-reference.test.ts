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
  "paper:sniper:preflight:input:prepare",
  "paper:routequote:prepare",
  "paper:routequote:fetch",
  "paper:realtime:snapshot",
  "paper:realtime:watch",
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
  "paper:sniper:dry-run",
  "paper:sniper:rehearse",
  "paper:sniper:operator-demo",
  "paper:sniper:watchlist:prepare",
  "paper:sniper:campaign:run",
  "paper:phase6:prereqs",
  "paper:phase6:intent:plan",
  "paper:phase6:diff:intent",
  "paper:simulation:intent:plan",
  "paper:simulation:result",
  "paper:simulation:route",
  "paper:simulation:tx",
  "paper:simulation:validate",
  "paper:simulation:audit",
  "paper:simulation:readiness",
  "paper:simulation:diff:plan",
  "paper:simulation:diff:result",
  "paper:simulation:handoff",
  "paper:simulation:bundle",
];

/** Docs that must cover every registered command. */
const REQUIRED_DOCS = ["docs/SNIPER_RUNBOOK.md", "README.md"] as const;

/** Docs whose command mentions must all be registered (superset of REQUIRED_DOCS). */
const SCANNED_DOCS = [...REQUIRED_DOCS, "docs/SNIPER_MODEL.md", "examples/sniper/README.md"] as const;

/** A command-shaped token: paper:sniper:… / paper:phase6:… / paper:simulation:… /
 * paper:routequote:… / paper:realtime:… (colon/hyphen segments). */
const COMMAND_TOKEN = /paper:(?:sniper|phase6|simulation|routequote|realtime):[a-z0-9-]+(?::[a-z0-9-]+)*/g;

function registeredCommands(): string[] {
  const source = readFileSync(CLI_INDEX, "utf8");
  const names = [...source.matchAll(/\.command\("([^"]+)"\)/g)].map((m) => m[1] as string);
  return names
    .filter(
      (n) =>
        n.startsWith("paper:sniper:") ||
        n.startsWith("paper:phase6:") ||
        n.startsWith("paper:simulation:") ||
        n.startsWith("paper:routequote:") ||
        n.startsWith("paper:realtime:"),
    )
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

// ---------------------------------------------------------------------------
// Sprint 72 — FLAG-level drift protection (closes the "commands pinned but not
// flags" gap). The paper:simulation:* surface is pinned EXACTLY; key cross-
// cutting sniper flags are asserted present; and every flag the runbook's
// Phase 6 section mentions must really exist on a simulation command.
// ---------------------------------------------------------------------------

/** The curated, expected flag surface of every paper:simulation:* command
 * (UPDATE THIS when a flag is added/removed — that's the point). */
const EXPECTED_SIMULATION_FLAGS: Readonly<Record<string, readonly string[]>> = {
  "paper:simulation:intent:plan": [
    "--decisions", "--gates", "--prereqs", "--kill-switch", "--secrets-policy", "--burner-isolation",
    "--stop-simulation-tripped", "--acknowledge-paper-enter-review", "--operator", "--plan-label",
    "--amount-label", "--json", "--out", "--force", "--fail-on-blocking", "--fail-on-unresolved",
  ],
  "paper:simulation:result": [
    "--plan", "--stop-simulation-tripped", "--json", "--out", "--force",
    "--fail-on-blocked", "--fail-on-unresolved", "--fail-on-dry-run-unavailable",
  ],
  "paper:simulation:route": [
    "--plan", "--quotes", "--stop-simulation-tripped", "--operator", "--resolution-label", "--json", "--out",
    "--force", "--fail-on-blocked", "--fail-on-unavailable",
  ],
  "paper:simulation:tx": [
    "--envelope", "--rpc-url", "--allow-paper-read", "--json", "--out", "--force", "--fail-on-not-ok",
  ],
  "paper:simulation:validate": ["--plan", "--result", "--json"],
  "paper:simulation:audit": [
    "--decisions", "--run-report", "--gates", "--prereqs", "--kill-switch", "--secrets-policy",
    "--burner-isolation", "--intent-plan", "--simulation-result", "--route", "--operator", "--json",
    "--out", "--force", "--fail-on-findings", "--fail-on-incomplete", "--fail-on-chain-conditions",
  ],
  "paper:simulation:readiness": [
    "--audit", "--plan", "--result", "--evidence", "--operator", "--json", "--out", "--force",
    "--fail-on-not-ready",
  ],
  "paper:simulation:diff:plan": ["--base", "--next", "--json", "--out", "--force", "--fail-on-diff"],
  "paper:simulation:diff:result": ["--base", "--next", "--json", "--out", "--force", "--fail-on-diff"],
  "paper:simulation:handoff": [
    "--decisions", "--run-report", "--gates", "--prereqs", "--kill-switch", "--secrets-policy",
    "--burner-isolation", "--intent-plan", "--simulation-result", "--route", "--audit", "--readiness",
    "--operator", "--pack-label", "--json", "--out", "--force",
    "--fail-on-incomplete", "--fail-on-blocking", "--fail-on-not-ready",
  ],
  "paper:simulation:bundle": [
    "--decisions", "--run-report", "--gates", "--prereqs", "--kill-switch", "--secrets-policy",
    "--burner-isolation", "--intent-plan", "--simulation-result", "--route", "--audit", "--readiness",
    "--handoff", "--operator", "--bundle-label", "--json", "--out", "--force",
    "--fail-on-blocked", "--fail-on-incomplete",
  ],
};

/** Parse each registered command's flag names from the CLI source. */
function registeredFlags(): Map<string, string[]> {
  const source = readFileSync(CLI_INDEX, "utf8");
  const out = new Map<string, string[]>();
  for (const block of source.matchAll(/\.command\("([^"]+)"\)([\s\S]*?)\.action\(/g)) {
    const command = block[1] as string;
    const flags = [...(block[2] as string).matchAll(/\.option\(\s*\n?\s*"(--[a-z0-9-]+)/g)].map((m) => m[1] as string);
    out.set(command, flags);
  }
  return out;
}

describe("CLI reference — flag-level drift (paper:simulation:* pinned exactly)", () => {
  const flags = registeredFlags();

  for (const [command, expected] of Object.entries(EXPECTED_SIMULATION_FLAGS)) {
    it(`${command} exposes EXACTLY the curated flags`, () => {
      expect(flags.get(command)?.slice().sort()).toEqual([...expected].sort());
    });
  }

  it("the parser found a meaningful flag surface (guards against a broken regex)", () => {
    const total = [...flags.values()].reduce((n, f) => n + f.length, 0);
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it("key cross-cutting sniper flags still exist somewhere on the sniper surface", () => {
    for (const flag of ["--schema-version", "--out", "--force", "--fail-on-not-adopted", "--preflight-input", "--policy"]) {
      const carried = [...flags.entries()].some(([cmd, f]) => cmd.startsWith("paper:") && f.includes(flag));
      expect(carried, `no registered paper:* command exposes ${flag}`).toBe(true);
    }
  });

  it("every flag the runbook's Phase 6 section mentions exists on a simulation command", () => {
    const runbook = readFileSync(join(ROOT, "docs/SNIPER_RUNBOOK.md"), "utf8");
    const start = runbook.indexOf("## Phase 6 simulation");
    expect(start).toBeGreaterThan(-1);
    const rest = runbook.slice(start + 1);
    const end = rest.indexOf("\n## ");
    const section = end === -1 ? rest : rest.slice(0, end);
    const simulationFlags = new Set(Object.values(EXPECTED_SIMULATION_FLAGS).flat());
    const mentioned = [...section.matchAll(/(--[a-z0-9][a-z0-9-]+)/g)].map((m) => m[1] as string);
    expect(mentioned.length).toBeGreaterThan(5);
    const ghosts = [...new Set(mentioned)].filter((f) => !simulationFlags.has(f)).sort();
    expect(ghosts, `runbook Phase 6 section mentions unknown flag(s): ${ghosts.join(", ")}`).toEqual([]);
  });
});
