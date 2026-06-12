/**
 * Sprint 91 — config loader regression tests, pinning the S90 BOM bug fix: PowerShell `>`
 * redirection writes a BOM, and `JSON.parse` refuses a leading U+FEFF with a confusing
 * "Unexpected token" error. The loader now strips a UTF-8 BOM before parsing.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError } from "./load.js";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "cfg-load-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const BOM = String.fromCharCode(0xfeff);
const CONFIG = JSON.stringify({ mode: "PAPER", killSwitch: true }, null, 2);

describe("loadConfig — BOM handling (S90 bug fix)", () => {
  it("parses a soulmaker.config.json that starts with a UTF-8 BOM", () => {
    withTmp((tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), BOM + CONFIG, "utf8");
      const config = loadConfig({ cwd: tmp, env: {} });
      expect(config.mode).toBe("PAPER");
      expect(config.killSwitch).toBe(true);
    });
  });

  it("parses the same file without a BOM identically", () => {
    withTmp((tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), CONFIG, "utf8");
      const withoutBom = loadConfig({ cwd: tmp, env: {} });
      writeFileSync(join(tmp, "soulmaker.config.json"), BOM + CONFIG, "utf8");
      const withBom = loadConfig({ cwd: tmp, env: {} });
      expect(withBom).toEqual(withoutBom);
    });
  });

  it("still reports a readable error for genuinely malformed JSON", () => {
    withTmp((tmp) => {
      writeFileSync(join(tmp, "soulmaker.config.json"), BOM + "{nope", "utf8");
      expect(() => loadConfig({ cwd: tmp, env: {} })).toThrow(ConfigError);
    });
  });
});
