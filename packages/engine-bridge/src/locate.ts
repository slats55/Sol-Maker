/**
 * Decide HOW to invoke the engine: a prebuilt binary when one exists under
 * the workspace `target/` directory (fast path), else `cargo run` (slow
 * path, requires the toolchain). The bridge never guesses success — when
 * neither path can start, the caller reports `unavailable` honestly.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type EngineInvocationVia = "prebuilt-release" | "prebuilt-debug" | "cargo-run";

export interface EngineInvocation {
  readonly via: EngineInvocationVia;
  readonly command: string;
  /** Args that select the engine; the subcommand args are appended after. */
  readonly baseArgs: readonly string[];
}

const BINARY_NAME = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";

/** Pick the invocation strategy for the workspace rooted at `cwd`. */
export function locateEngineInvocation(
  cwd: string,
  exists: (path: string) => boolean = existsSync,
): EngineInvocation {
  const release = join(cwd, "target", "release", BINARY_NAME);
  if (exists(release)) return { via: "prebuilt-release", command: release, baseArgs: [] };
  const debug = join(cwd, "target", "debug", BINARY_NAME);
  if (exists(debug)) return { via: "prebuilt-debug", command: debug, baseArgs: [] };
  return {
    via: "cargo-run",
    command: "cargo",
    baseArgs: ["run", "--quiet", "-p", "solmaker-engine", "--"],
  };
}
