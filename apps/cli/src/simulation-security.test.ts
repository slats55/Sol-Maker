/**
 * Sprint 70 — SIMULATION CLI security backstops (behavioral + registration-level).
 *
 * The package-wide source scans live in `packages/simulation/src/no-forbidden-imports.test.ts`
 * and `package-boundary.test.ts`. This file proves the boundary at the CLI layer:
 *
 *  1. **No secret echo:** a mnemonic-shaped operator label and a key-shaped string flowing through
 *     a simulation command come out REDACTED, never verbatim.
 *  2. **No hidden dangerous flags:** every `paper:simulation:*` registration in the CLI source
 *     exposes only audited flag names — no flag name may smuggle a live/send/sign/key surface.
 *  3. **Key-shaped artifact fields never round-trip:** an injected `privateKey`-named field on a
 *     chain artifact never appears in any simulation command's output.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFictionalReadyChain } from "@soulmaker/simulation";
import { paperSimulationIntentPlanReport, paperSimulationResultReport } from "./commands.js";

const CLI_INDEX = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "simulation-security-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("simulation CLI — no secret echo", () => {
  it("a mnemonic-shaped operator label is REDACTED in JSON output, never verbatim", () => {
    withTmp((tmp) => {
      const mnemonicShaped = "apple banana cherry damson elder fig grape honey iris juniper kiwi lemon";
      const r = paperSimulationIntentPlanReport({ cwd: tmp, env: {} }, { operatorLabel: mnemonicShaped, json: true });
      expect(r.exitCode).toBe(0);
      expect(r.text).not.toContain(mnemonicShaped);
      expect(r.text).toContain("[REDACTED]");
    });
  });

  it("a key-shaped (long base58) plan label never survives into output", () => {
    withTmp((tmp) => {
      const keyShaped = "5".repeat(88);
      const r = paperSimulationIntentPlanReport({ cwd: tmp, env: {} }, { planLabel: keyShaped, json: true });
      expect(r.exitCode).toBe(0);
      expect(r.text).not.toContain(keyShaped);
    });
  });

  it("an injected privateKey-named field on a chain artifact never reaches the output", () => {
    withTmp((tmp) => {
      const chain = buildFictionalReadyChain();
      const evil = { ...chain.decision, privateKey: "fictional-injected-value" } as Record<string, unknown>;
      writeFileSync(join(tmp, "dec-evil.json"), JSON.stringify(evil));
      // The strict validator refuses the unknown shape OR the builder blocks it as invalid —
      // either way the injected value must never be echoed.
      const r = paperSimulationIntentPlanReport({ cwd: tmp, env: {} }, { decisionsPath: "dec-evil.json", json: true });
      expect(r.text).not.toContain("fictional-injected-value");
    });
  });

  it("a tampered plan refusal from the result command never echoes injected key material", () => {
    withTmp((tmp) => {
      writeFileSync(
        join(tmp, "evil-plan.json"),
        JSON.stringify({ schemaVersion: "simulation.intent.plan.v2", walletSecret: "fictional-secret-value" }),
      );
      const r = paperSimulationResultReport({ cwd: tmp, env: {} }, { planPath: "evil-plan.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).not.toContain("fictional-secret-value");
    });
  });
});

describe("simulation CLI — no hidden dangerous flags", () => {
  /** Flag-name tokens that must never appear on a paper:simulation:* command. */
  const FORBIDDEN_FLAG_TOKENS = [
    "--live",
    "--send",
    "--sign",
    "--private",
    "--mnemonic",
    "--seed",
    "--wallet",
    "--dangerous",
    "--bypass",
    "--unsafe",
    "--execute",
  ] as const;

  it("every registered paper:simulation:* flag is clean (no live/send/sign/key surface)", () => {
    const source = readFileSync(CLI_INDEX, "utf8");
    // Slice out each paper:simulation:* command block (from .command(...) to .action().
    const blocks = [...source.matchAll(/\.command\("(paper:simulation:[^"]+)"\)([\s\S]*?)\.action\(/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(5); // intent:plan, result, validate, audit, readiness
    for (const block of blocks) {
      const command = block[1] as string;
      const flags = [...(block[2] as string).matchAll(/\.option\(\s*"(--[a-z0-9-]+)/g)].map((m) => m[1] as string);
      expect(flags.length).toBeGreaterThan(0);
      for (const flag of flags) {
        for (const token of FORBIDDEN_FLAG_TOKENS) {
          expect(flag.startsWith(token), `${command} exposes suspicious flag ${flag}`).toBe(false);
        }
      }
    }
  });
});
