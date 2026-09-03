/**
 * Sprint 103-C — the S104 controlled micro-trade plan is DESIGN ONLY.
 *
 * docs/S104_CONTROLLED_MICROTRADE_PLAN.md scopes a FUTURE, separately-authorized micro-trade. This
 * test pins that the design doc opens NO executable path: the mainnet micro-trade commands it
 * proposes are NOT registered in the CLI, and no registered command targets mainnet (the only send
 * surface is the devnet probe). The doc adds words, never a command.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const DOC = join(ROOT, "docs/S104_CONTROLLED_MICROTRADE_PLAN.md");
const CLI_INDEX = join(HERE, "index.ts");

function registeredCommandNames(): string[] {
  const source = readFileSync(CLI_INDEX, "utf8");
  return [...source.matchAll(/\.command\("([^"]+)"\)/g)].map((m) => m[1] as string);
}

describe("S104 plan doc — design only, adds no command surface", () => {
  const doc = readFileSync(DOC, "utf8");

  it("declares itself DESIGN ONLY and authorizes nothing", () => {
    expect(doc).toContain("DESIGN ONLY");
    expect(doc.toLowerCase()).toContain("authorizes nothing");
    expect(doc.toLowerCase()).toContain("separate, explicit, written");
    expect(doc.toLowerCase()).toContain("no axiom dependency");
  });

  it("the mainnet micro-trade commands it proposes are NOT registered (the doc is forward-looking)", () => {
    const registered = new Set(registeredCommandNames());
    for (const proposed of ["execution:mainnet:microtrade:plan", "execution:mainnet:microtrade:send"]) {
      expect(doc, `${proposed} should be proposed in the doc`).toContain(proposed);
      expect(registered.has(proposed), `${proposed} must NOT exist as a registered command`).toBe(false);
    }
  });

  it("the only mainnet-targeting commands are the S111 allowlist; send commands are devnet:send + mainnet:send", () => {
    const names = registeredCommandNames();
    expect(names.filter((c) => /mainnet/i.test(c)).sort()).toEqual(["execution:mainnet:sell", "execution:mainnet:send"]);
    expect(names.filter((c) => /(^|:)send$/i.test(c)).sort()).toEqual(["execution:devnet:send", "execution:mainnet:send"]);
  });
});
