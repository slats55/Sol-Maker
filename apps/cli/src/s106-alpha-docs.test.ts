/**
 * Sprint 106 — the alpha release docs pin the no-send framing and never claim live trading is on.
 *
 * The S106 layer (alpha history + strategy intelligence) is documented across the release docs. This
 * test pins that those docs:
 *   - keep the honest "live trading is disabled / 0% by policy / not implemented" framing;
 *   - make NO positive claim that live trading is enabled / ready;
 *   - document the two new commands (so the alpha is discoverable);
 *   - never imply a prompt or an agent can authorize live trading.
 *
 * It adds no command surface — it only guards the words.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");

const RELEASE_DOCS = [
  "docs/ALPHA_RELEASE_NOTES.md",
  "docs/ALPHA_RELEASE_CHECKLIST.md",
  "docs/ROADMAP.md",
  "docs/MAINNET_DRY_RUN.md",
  "docs/SNIPER_RUNBOOK.md",
  "examples/sniper/alpha-workflow/README.md",
] as const;

const S106_COMMANDS = ["paper:sniper:alpha:history", "paper:sniper:strategy:intel"] as const;

/** Positive claims that would mean live trading is actually on — must never appear (even near S106). */
const FORBIDDEN_POSITIVE_CLAIMS: readonly RegExp[] = [
  /live trading is enabled/i,
  /live trading is now (?:on|enabled|live|ready)/i,
  /sending is enabled/i,
  /ready to trade live/i,
  /now ready for live/i,
  /mainnet send is enabled/i,
];

describe("S106 alpha docs — honest no-send framing", () => {
  for (const rel of RELEASE_DOCS) {
    it(`${rel} makes no positive live-enabled claim`, () => {
      const text = readFileSync(join(ROOT, rel), "utf8");
      for (const re of FORBIDDEN_POSITIVE_CLAIMS) {
        expect(re.test(text), `${rel} contains a forbidden positive live claim: ${re}`).toBe(false);
      }
    });
  }

  it("the release notes + checklist keep the disabled / 0%-by-policy framing", () => {
    const notes = readFileSync(join(ROOT, "docs/ALPHA_RELEASE_NOTES.md"), "utf8");
    const checklist = readFileSync(join(ROOT, "docs/ALPHA_RELEASE_CHECKLIST.md"), "utf8");
    expect(notes).toMatch(/LIVE TRADING IS DISABLED/i);
    expect(notes).toMatch(/0% by policy/i);
    expect(checklist).toMatch(/Live trading\b.*not implemented; 0% by policy/i);
  });

  it("both S106 commands are documented in the runbook, notes, and checklist", () => {
    for (const doc of ["docs/SNIPER_RUNBOOK.md", "docs/ALPHA_RELEASE_NOTES.md", "docs/ALPHA_RELEASE_CHECKLIST.md"]) {
      const text = readFileSync(join(ROOT, doc), "utf8");
      for (const cmd of S106_COMMANDS) {
        expect(text.includes(cmd), `${doc} must document ${cmd}`).toBe(true);
      }
    }
  });

  it("the S106 ROADMAP section states the written sign-off is still the only live blocker", () => {
    const roadmap = readFileSync(join(ROOT, "docs/ROADMAP.md"), "utf8");
    const idx = roadmap.indexOf("## Sprint 106");
    expect(idx).toBeGreaterThan(-1);
    const section = roadmap.slice(idx, roadmap.indexOf("## ", idx + 1));
    expect(section).toMatch(/no-send|no-signer|no-live-trading/i);
    expect(section.toLowerCase()).toContain("written human sign-off");
  });
});
