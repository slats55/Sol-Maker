import { describe, expect, it } from "vitest";

import { renderToString } from "../src/lib/html.js";
import {
  COMMANDS,
  COMMAND_GROUP_ORDER,
} from "../src/lib/command-reference.js";
import { KNOWN_REPORT_SCHEMAS, schemaForCli } from "../src/lib/report-types.js";
import { CommandCard } from "../src/components/cards.js";
import { renderCommands } from "../src/pages/commands.js";

const render = (value: { __html: string }): string => renderToString(value);

/**
 * Commands proven shipped on `origin/master` (`apps/cli/src/index.ts`) that the
 * previous UI closeout had NOT yet surfaced on the command-reference page. Each
 * was verified with `git grep -n "\.command(" origin/master -- apps/cli/src/index.ts`.
 * The last two are the Sprint 19 research diffs, merged to master at 53a7f83.
 */
const SHIPPED_MATRIX_RESEARCH = [
  "paper:backtest:sensitivity:matrix",
  "paper:backtest:diff:sensitivity:matrix",
  "paper:backtest:research:manifest",
  "paper:backtest:research:verify",
  "paper:backtest:diff:research:manifest",
  "paper:backtest:research:bundle",
  "paper:backtest:research:status",
  "paper:backtest:research:index",
  "paper:backtest:diff:research:bundle",
  "paper:backtest:diff:research:index",
] as const;

const commandStrings = new Set(COMMANDS.map((command) => command.command));

describe("command reference — shipped matrix/research coverage", () => {
  it("lists every proven-shipped matrix and research command", () => {
    for (const command of SHIPPED_MATRIX_RESEARCH) {
      expect(commandStrings.has(command), `missing command: ${command}`).toBe(true);
    }
  });

  it("has no duplicate command strings", () => {
    expect(commandStrings.size).toBe(COMMANDS.length);
  });

  it("assigns every command to a declared group", () => {
    for (const command of COMMANDS) {
      expect(COMMAND_GROUP_ORDER).toContain(command.group);
    }
  });

  it("uses no placeholder CLI labels for any command", () => {
    const PLACEHOLDERS = [/\bTODO\b/i, /\bunknown\b/i, /\bn\/a\b/i, /pending/i, /<command>/i];
    for (const command of COMMANDS) {
      for (const re of PLACEHOLDERS) {
        expect(command.command, `placeholder label in ${command.command}`).not.toMatch(re);
      }
    }
  });

  it("gives every command a non-empty human summary", () => {
    for (const command of COMMANDS) {
      expect(command.summary.trim().length, command.command).toBeGreaterThan(0);
    }
  });
});

describe("command reference ↔ schema registry drift guard", () => {
  it("every registry `cli` is a real command on the reference page (no orphans)", () => {
    // This is the core drift guard: if a schema is added/renamed in the registry
    // with a new `cli`, this fails until the command-reference page lists it too.
    for (const schema of KNOWN_REPORT_SCHEMAS) {
      expect(
        commandStrings.has(schema.cli),
        `schema ${schema.id} references CLI "${schema.cli}" not present on the command-reference page`,
      ).toBe(true);
    }
  });

  it("schemaForCli resolves every registry cli back to a catalogued schema", () => {
    for (const schema of KNOWN_REPORT_SCHEMAS) {
      const info = schemaForCli(schema.cli);
      expect(info, `schemaForCli("${schema.cli}") should resolve`).toBeDefined();
      expect(info?.cli).toBe(schema.cli);
    }
  });

  it("a command mapped to a schema reuses the exact registry cli string", () => {
    for (const command of COMMANDS) {
      const info = schemaForCli(command.command);
      if (info) {
        expect(info.cli).toBe(command.command);
      }
    }
  });

  it("every shipped matrix/research command maps to a stable schema", () => {
    for (const command of SHIPPED_MATRIX_RESEARCH) {
      const info = schemaForCli(command);
      expect(info, `no schema for ${command}`).toBeDefined();
      expect(info?.stability).toBe("stable");
    }
  });
});

describe("CommandCard schema rendering", () => {
  it("shows the produced artifact id + stable status when a schema is supplied", () => {
    const schema = schemaForCli("paper:backtest:research:index");
    expect(schema).toBeDefined();
    const out = render(
      CommandCard(
        {
          command: "paper:backtest:research:index",
          summary: "Index a campaign of research runs.",
          group: "Research runs",
          readsChain: false,
        },
        schema,
      ),
    );
    expect(out).toContain("pnpm soulmaker paper:backtest:research:index");
    expect(out).toContain("backtest.research.campaign.index.v1");
    expect(out).toContain("sm-schema--stable");
    expect(out).toContain("sm-cmd__artifact");
    expect(out).toContain("offline");
  });

  it("omits the artifact line (never fakes a schema) when none is known", () => {
    const out = render(
      CommandCard({
        command: "doctor",
        summary: "Sanity check.",
        group: "Diagnostics",
        readsChain: false,
      }),
    );
    expect(out).not.toContain("sm-cmd__artifact");
    expect(out).not.toMatch(/\bundefined\b/);
  });
});

describe("rendered command-reference page", () => {
  const out = render(renderCommands());

  it("shows every shipped matrix/research command with its pnpm soulmaker prefix", () => {
    for (const command of SHIPPED_MATRIX_RESEARCH) {
      expect(out, `page missing ${command}`).toContain(`pnpm soulmaker ${command}`);
    }
  });

  it("surfaces produced schema ids with a stable badge", () => {
    expect(out).toContain("backtest.sensitivity.matrix.v1");
    expect(out).toContain("backtest.research.campaign.index.v1");
    expect(out).toContain("sm-schema--stable");
    expect(out).toContain("sm-cmd__artifact");
  });

  it("renders the Research runs group heading", () => {
    expect(out).toContain("Research runs");
  });

  it("keeps the reference-only and local/paper safety framing", () => {
    expect(out).toContain("Reference only");
    expect(out).toContain("public keys only");
    expect(out.toLowerCase()).toContain("offline");
    expect(out.toLowerCase()).toContain("local files only");
  });

  it("emits no emerging/unknown badge and no undefined leak (all catalogued schemas shipped)", () => {
    expect(out).not.toContain("sm-schema--emerging");
    expect(out).not.toContain("sm-schema--unknown");
    expect(out).not.toMatch(/\bundefined\b/);
  });

  it("is deterministic across renders", () => {
    expect(render(renderCommands())).toBe(out);
  });
});

describe("Sprint 19 research diffs are now shipped (merged to origin/master)", () => {
  // The S19 research diff schemas were merged to origin/master (verified at
  // 53a7f83): packages/backtest/src/research-bundle-diff.ts and
  // research-campaign-index-diff.ts, with CLI paper:backtest:diff:research:bundle
  // and :index. They are therefore catalogued in the registry and listed here.
  it("catalogues both S19 diff schemas as stable, mapped to their real CLI", () => {
    const bundle = schemaForCli("paper:backtest:diff:research:bundle");
    const campaign = schemaForCli("paper:backtest:diff:research:index");
    expect(bundle?.id).toBe("backtest.research.bundle.diff.v1");
    expect(bundle?.stability).toBe("stable");
    expect(campaign?.id).toBe("backtest.research.campaign.diff.v1");
    expect(campaign?.stability).toBe("stable");
  });

  it("surfaces both S19 diff schema ids on the rendered command-reference page", () => {
    const out = render(renderCommands());
    expect(out).toContain("pnpm soulmaker paper:backtest:diff:research:bundle");
    expect(out).toContain("pnpm soulmaker paper:backtest:diff:research:index");
    expect(out).toContain("backtest.research.bundle.diff.v1");
    expect(out).toContain("backtest.research.campaign.diff.v1");
  });
});

describe("Sprint 88 — operator bundle + paper dry-run orchestrator commands", () => {
  it("lists both S88 commands on the reference page", () => {
    expect(commandStrings.has("paper:simulation:bundle")).toBe(true);
    expect(commandStrings.has("paper:sniper:dry-run")).toBe(true);
  });

  it("maps paper:simulation:bundle to the stable phase6.operator.bundle.v1 schema", () => {
    const info = schemaForCli("paper:simulation:bundle");
    expect(info?.id).toBe("phase6.operator.bundle.v1");
    expect(info?.stability).toBe("stable");
  });

  it("paper:sniper:dry-run maps to no single schema (it writes a whole directory)", () => {
    expect(schemaForCli("paper:sniper:dry-run")).toBeUndefined();
  });

  it("renders both S88 commands with honest paper-only summaries", () => {
    const out = render(renderCommands());
    expect(out).toContain("pnpm soulmaker paper:simulation:bundle");
    expect(out).toContain("pnpm soulmaker paper:sniper:dry-run");
    expect(out).toContain("phase6.operator.bundle.v1");
    expect(out).toContain("reviewable-paper-only");
    expect(out).toContain("RUN_SUMMARY.md");
    expect(out.toLowerCase()).not.toContain("live-ready");
  });
});

describe("forward-compat: a truly hypothetical, not-yet-shipped schema", () => {
  // Guards the honest-degradation contract for ANY future schema not yet on master:
  // the registry does not invent it, schemaForCli returns undefined, and a command
  // card for it shows no artifact badge rather than a faked one.
  const FUTURE_CLI = "paper:backtest:diff:research:galaxy";
  const FUTURE_SCHEMA = "backtest.research.galaxy.diff.v9";

  it("the registry does not catalogue an unshipped future schema", () => {
    const ids = KNOWN_REPORT_SCHEMAS.map((schema) => schema.id);
    expect(ids).not.toContain(FUTURE_SCHEMA);
    expect(schemaForCli(FUTURE_CLI)).toBeUndefined();
  });

  it("a card for an unknown future command shows no artifact and fakes no schema", () => {
    const out = render(
      CommandCard(
        {
          command: FUTURE_CLI,
          summary: "Hypothetical future diff command (not on master).",
          group: "Research runs",
          readsChain: false,
        },
        schemaForCli(FUTURE_CLI),
      ),
    );
    expect(out).not.toContain("sm-cmd__artifact");
    expect(out).not.toContain("sm-schema");
    expect(out).not.toMatch(/\bundefined\b/);
  });
});
