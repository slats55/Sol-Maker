import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * TypeScript-side mirror of crates/solmaker-engine/tests/safety_scan.rs:
 * scans the RUST crate's production source for forbidden capability tokens.
 * This runs in `pnpm test` on every machine — so the Rust safety wall holds
 * even where no cargo toolchain exists to run the Rust-side scan.
 *
 * Tokens are composed at runtime (first + rest) so this file can never match
 * itself and the token strings never appear verbatim in the repo twice.
 */

const RUST_SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "crates", "solmaker-engine", "src");
const RUST_MANIFEST = join(RUST_SRC_DIR, "..", "Cargo.toml");

const FORBIDDEN_TOKEN_PARTS: ReadonlyArray<readonly [string, string]> = [
  ["key", "pair"],
  ["secret", "_key"],
  ["secret", "key"],
  ["private", "_key"],
  ["private", "key"],
  ["mne", "monic"],
  ["seed", "_phrase"],
  ["seed", "phrase"],
  ["sign_", "transaction"],
  ["sign", "transaction"],
  ["send_", "transaction"],
  ["send", "transaction"],
  ["send_raw", "_transaction"],
  ["sendandc", "onfirm"],
  ["request_", "airdrop"],
  ["requesta", "irdrop"],
  ["req", "west"],
  ["hyp", "er::"],
  ["tok", "io"],
  ["async", "_std"],
  ["websoc", "ket"],
  ["tungst", "enite"],
  ["std::", "net"],
  ["tcpst", "ream"],
  ["udpso", "cket"],
  ["command::", "new"],
  ["process::", "command"],
  [".spaw", "n("],
  ["solana_", "sdk"],
  ["solana_", "client"],
  ["wallet_", "file"],
  ["load_", "wallet"],
  ["ed25", "519"],
  ["curve25", "519"],
];

function rustSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...rustSourceFiles(full));
    else if (entry.name.endsWith(".rs")) out.push(full);
  }
  return out.sort();
}

/** Strip // line comments (the crate uses no block comments — asserted below). */
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

describe("solmaker-engine Rust crate — TypeScript-side safety scan", () => {
  it("the crate exists where this scan expects it", () => {
    expect(existsSync(RUST_SRC_DIR), `Rust src dir missing at ${RUST_SRC_DIR}`).toBe(true);
    expect(existsSync(RUST_MANIFEST)).toBe(true);
  });

  it("scans the full Rust module set", () => {
    const names = rustSourceFiles(RUST_SRC_DIR).map((f) => f.slice(RUST_SRC_DIR.length + 1));
    expect(names).toContain("lib.rs");
    expect(names).toContain("main.rs");
    expect(names).toContain("ipc.rs");
    expect(names).toContain("safety.rs");
    expect(names).toContain("schema.rs");
    expect(names).toContain("status.rs");
    expect(names).toContain("label_safety.rs");
    expect(names).toContain("mint.rs");
    expect(names).toContain("realtime.rs");
  });

  it("Rust production source contains no forbidden capability token", () => {
    const tokens = FORBIDDEN_TOKEN_PARTS.map(([a, b]) => `${a}${b}`);
    const violations: string[] = [];
    for (const file of rustSourceFiles(RUST_SRC_DIR)) {
      const raw = readFileSync(file, "utf8");
      expect(raw.includes("/*"), `${file} must use only // comments so the stripper stays sound`).toBe(false);
      const code = stripLineComments(raw).toLowerCase();
      for (const token of tokens) {
        if (code.includes(token)) {
          violations.push(`${file.slice(RUST_SRC_DIR.length + 1)} contains forbidden token ${JSON.stringify(token)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the Rust dependency list is exactly the reviewed allowlist (serde, serde_json)", () => {
    const manifest = readFileSync(RUST_MANIFEST, "utf8");
    const depsSection = manifest.split("[dependencies]")[1] ?? "";
    const deps = depsSection
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .reduce<string[]>((acc, line) => {
        if (line.startsWith("[")) acc.push(" STOP");
        else if (!acc.includes(" STOP")) acc.push(line.split("=")[0]?.trim() ?? "");
        return acc;
      }, [])
      .filter((d) => d !== " STOP" && d.length > 0);
    expect(deps).toEqual(["serde", "serde_json"]);
  });

  it("the Rust source pins every execution marker to the literal 'disabled'", () => {
    const safety = readFileSync(join(RUST_SRC_DIR, "safety.rs"), "utf8");
    expect(safety).toContain('pub const SIGNER_SUPPORT: &str = "disabled";');
    expect(safety).toContain('pub const SEND_SUPPORT: &str = "disabled";');
    expect(safety).toContain('pub const MAINNET_SEND_SUPPORT: &str = "disabled";');
  });

  it("the Rust binary reads no environment and no clock (no std::env reads outside args, no SystemTime)", () => {
    for (const file of rustSourceFiles(RUST_SRC_DIR)) {
      const code = stripLineComments(readFileSync(file, "utf8"));
      expect(code.includes("SystemTime"), `${file} must not read a clock`).toBe(false);
      expect(code.includes("Instant::now"), `${file} must not read a clock`).toBe(false);
      expect(code.includes("env::var"), `${file} must not read environment variables`).toBe(false);
      expect(code.includes("std::env::vars"), `${file} must not read environment variables`).toBe(false);
    }
  });
});
