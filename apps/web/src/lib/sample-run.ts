/**
 * Loader for the committed, byte-pinned `fixtures/dry-run-sample/` run (Sprint 90).
 *
 * This is the ONE lib module that touches the filesystem, and only at static
 * build / test time (Node), to read the repo's own committed fixture — the
 * output of a real `paper:sniper:dry-run` over fictional candidates. It never
 * reads outside the fixture folder, never fetches anything, and the result is
 * cached (the fixture is committed, so the bytes are stable).
 *
 * The typed-view predicate is INJECTED (lib never imports components), exactly
 * like {@link buildFolderIndex} expects.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFolderIndex, type FolderIndex, type FolderInputEntry } from "./folder-index.js";
import { buildDryRunOverview, type DryRunOverview } from "./dry-run-overview.js";

/** The committed sample folder (a real dry-run output over FICTIONAL candidates). */
const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/dry-run-sample");

export interface SampleDryRun {
  readonly index: FolderIndex;
  readonly overview: DryRunOverview;
}

let cached: SampleDryRun | null = null;

/**
 * Load and index the committed sample dry-run folder. Throws when the fixture
 * is missing or carries no valid operator bundle — that is a build-time
 * invariant (the fixture is committed and pin-tested), not a runtime state.
 */
export function loadSampleDryRun(hasTypedView: (schemaVersion: string | null) => boolean): SampleDryRun {
  if (cached !== null) return cached;
  const entries: FolderInputEntry[] = [];
  for (const name of readdirSync(SAMPLE_DIR)) {
    const path = join(SAMPLE_DIR, name);
    if (!statSync(path).isFile()) {
      entries.push({ name, type: "skipped", reason: "subdirectory" });
      continue;
    }
    if (!name.toLowerCase().endsWith(".json")) {
      entries.push({ name, type: "skipped", reason: "non-JSON file" });
      continue;
    }
    entries.push({ name, type: "json", text: readFileSync(path, "utf8") });
  }
  const index = buildFolderIndex(entries, { hasTypedView });
  const overview = buildDryRunOverview(index);
  if (overview === null) {
    throw new Error("fixtures/dry-run-sample carries no valid operator bundle — the committed sample is broken");
  }
  cached = { index, overview };
  return cached;
}
