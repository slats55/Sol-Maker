/**
 * Node-only LOCAL artifact inspector command.
 *
 * Two modes, one entrypoint (`pnpm web:inspect`):
 *
 *   --input <report.json>  Read exactly ONE local PAPER report JSON file,
 *                          normalize it defensively (see ./lib/local-artifact.ts),
 *                          and render a single static page.
 *   --dir <folder>         Scan ONE local folder (no recursion) of report JSON
 *                          files, build a bounded folder index with a safe
 *                          diff-verdict overview (see ./lib/folder-index.ts), and
 *                          render a static index page with per-artifact sections.
 *
 * Both render through the same dashboard shell the static generator uses
 * (./components/layout.ts); output is script-free, escaped, and capped.
 *
 * Run from the repo root:
 *   pnpm web:inspect --input <report.json> --out apps/web/public/research-artifact.html --force
 *   pnpm web:inspect --input <report.json> --json     # print summary, write nothing
 *   pnpm web:inspect --dir <folder> --out apps/web/public/research-folder.html --force
 *   pnpm web:inspect --dir <folder> --json            # print folder summary, write nothing
 *
 * Hard guarantees:
 *   - Reads only LOCAL files. `--dir` scans one folder, no recursion, no globs.
 *   - No network, no fetch, no server, no chain, no wallet, no keys.
 *   - `--input` refuses non-.json inputs, directory inputs, and missing files.
 *   - In `--dir` mode, non-.json files and subdirectories are skipped (counted),
 *     and malformed JSON files are listed without crashing the scan.
 *   - Malformed JSON in `--input` mode fails clearly (non-zero exit), writes nothing.
 *   - Refuses to overwrite an existing --out unless --force is given.
 *   - Never executes report content; it is only escaped and displayed.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderDocument } from "./lib/html.js";
import { navItem } from "./lib/nav.js";
import {
  normalizeArtifact,
  parseArtifactJson,
  toSummaryJson,
} from "./lib/local-artifact.js";
import {
  buildFolderIndex,
  toFolderSummaryJson,
  type FolderInputEntry,
} from "./lib/folder-index.js";
import { DashboardShell } from "./components/layout.js";
import { hasTypedView } from "./components/artifact-views.js";
import { renderArtifactReport } from "./pages/artifact.js";
import { renderFolderIndex } from "./pages/folder.js";

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src
const webRoot = dirname(here); // apps/web
const DEFAULT_OUT = join(webRoot, "public", "research-artifact.html");
const DEFAULT_DIR_OUT = join(webRoot, "public", "research-folder.html");

/** Exit codes: 0 ok · 1 runtime/IO/parse error · 2 usage/validation error. */
const EXIT = { ok: 0, runtime: 1, usage: 2 } as const;

interface CliArgs {
  input?: string;
  dir?: string;
  out?: string;
  force: boolean;
  json: boolean;
  help: boolean;
  unknown: string[];
}

const USAGE = `Soulmaker web:inspect — render local PAPER report JSON as a static page.

Usage:
  pnpm web:inspect --input <report.json> [--out <file.html>] [--force] [--json]
  pnpm web:inspect --dir <folder> [--out <file.html>] [--force] [--json]

Options:
  --input <file>   Path to ONE local .json report artifact (single-artifact mode).
  --dir <folder>   Path to a local folder of report JSON files (folder-index mode,
                   no recursion). Exactly one of --input / --dir is required.
  --out <file>     Output HTML path. Default: apps/web/public/research-artifact.html
                   for --input, apps/web/public/research-folder.html for --dir.
  --force          Overwrite --out if it already exists.
  --json           Print a machine-readable summary to stdout; write no HTML.
  -h, --help       Show this help.

Local-only: reads local files, writes one local HTML file. No upload, no
network, no server, no wallet, no keys, no signing or sending.`;

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { force: false, json: false, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--input" || arg === "--dir" || arg === "--out") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        args.unknown.push(`${arg} (missing value)`);
      } else {
        if (arg === "--input") args.input = next;
        else if (arg === "--dir") args.dir = next;
        else args.out = next;
        i += 1;
      }
    } else if (arg.startsWith("--input=")) {
      args.input = arg.slice("--input=".length);
    } else if (arg.startsWith("--dir=")) {
      args.dir = arg.slice("--dir=".length);
    } else if (arg.startsWith("--out=")) {
      args.out = arg.slice("--out=".length);
    } else {
      args.unknown.push(arg);
    }
  }
  return args;
}

function fail(message: string, code: number): number {
  console.error(`web:inspect: ${message}`);
  return code;
}

export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  if (args.unknown.length > 0) {
    console.error(`web:inspect: unexpected argument(s): ${args.unknown.join(", ")}`);
    console.error(USAGE);
    return EXIT.usage;
  }
  const hasInput = args.input !== undefined && args.input.length > 0;
  const hasDir = args.dir !== undefined && args.dir.length > 0;
  if (hasInput && hasDir) {
    console.error("web:inspect: pass exactly one of --input or --dir, not both.");
    console.error(USAGE);
    return EXIT.usage;
  }
  if (!hasInput && !hasDir) {
    console.error("web:inspect: one of --input <report.json> or --dir <folder> is required.");
    console.error(USAGE);
    return EXIT.usage;
  }

  return hasDir ? runDirMode(args) : runFileMode(args);
}

/** Single-artifact mode: read ONE local .json report and render one page. */
function runFileMode(args: CliArgs): number {
  const input = args.input;
  if (input === undefined) return fail("internal: --input missing", EXIT.usage);

  const inputPath = resolve(process.cwd(), input);

  let stat;
  try {
    stat = statSync(inputPath);
  } catch {
    return fail(`input file not found: ${input}`, EXIT.runtime);
  }
  if (stat.isDirectory()) {
    return fail(`input is a directory, not a file: ${input} (use --dir to scan a folder)`, EXIT.usage);
  }
  if (!inputPath.toLowerCase().endsWith(".json")) {
    return fail(`input must be a .json file: ${input}`, EXIT.usage);
  }

  let text: string;
  try {
    text = readFileSync(inputPath, "utf8");
  } catch (err) {
    return fail(
      `could not read ${input}: ${err instanceof Error ? err.message : String(err)}`,
      EXIT.runtime,
    );
  }

  const parsed = parseArtifactJson(text);
  if (!parsed.ok) {
    return fail(`malformed JSON in ${input}: ${parsed.error}`, EXIT.runtime);
  }

  const view = normalizeArtifact(parsed.value);

  if (args.json) {
    console.log(JSON.stringify(toSummaryJson(view), null, 2));
    return EXIT.ok;
  }

  const outPath = args.out ? resolve(process.cwd(), args.out) : DEFAULT_OUT;
  if (existsSync(outPath) && !args.force) {
    return fail(
      `output already exists: ${relative(process.cwd(), outPath)} — pass --force to overwrite.`,
      EXIT.usage,
    );
  }

  const nav = navItem("artifact");
  const document = DashboardShell({
    activeId: nav.id,
    title: nav.label,
    description: nav.description,
    body: renderArtifactReport(view, { name: basename(inputPath) }, parsed.value),
  });
  const htmlOut = `${renderDocument(document)}\n`;

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, htmlOut, "utf8");
  } catch (err) {
    return fail(
      `could not write ${args.out ?? "default output"}: ${err instanceof Error ? err.message : String(err)}`,
      EXIT.runtime,
    );
  }

  console.log(`web:inspect: wrote ${relative(process.cwd(), outPath)}`);
  console.log(`  schema: ${view.schemaVersion ?? "(none)"} · status: ${view.schemaStatus} · kind: ${view.kind}`);
  return EXIT.ok;
}

/**
 * Folder-index mode: scan ONE local folder (no recursion) of report JSON files,
 * build a bounded folder index with a safe diff-verdict overview, and render a
 * static index page. Non-.json files and subdirectories are skipped (counted);
 * malformed JSON files are listed without aborting the scan.
 */
function runDirMode(args: CliArgs): number {
  const dir = args.dir;
  if (dir === undefined) return fail("internal: --dir missing", EXIT.usage);

  const dirPath = resolve(process.cwd(), dir);

  let stat;
  try {
    stat = statSync(dirPath);
  } catch {
    return fail(`folder not found: ${dir}`, EXIT.runtime);
  }
  if (!stat.isDirectory()) {
    return fail(`--dir is not a folder: ${dir} (use --input to inspect one file)`, EXIT.usage);
  }

  let dirents;
  try {
    dirents = readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return fail(
      `could not read folder ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      EXIT.runtime,
    );
  }

  const entries: FolderInputEntry[] = [];
  for (const dirent of dirents) {
    const name = dirent.name;
    if (dirent.isDirectory()) {
      entries.push({ name, type: "skipped", reason: "subdirectory (not scanned — no recursion)" });
      continue;
    }
    if (!name.toLowerCase().endsWith(".json")) {
      entries.push({ name, type: "skipped", reason: "not a .json file" });
      continue;
    }
    if (!dirent.isFile()) {
      entries.push({ name, type: "skipped", reason: "not a regular file" });
      continue;
    }
    try {
      const text = readFileSync(join(dirPath, name), "utf8");
      entries.push({ name, type: "json", text });
    } catch (err) {
      entries.push({
        name,
        type: "skipped",
        reason: `unreadable (${err instanceof Error ? err.message : String(err)})`,
      });
    }
  }

  const index = buildFolderIndex(entries, { hasTypedView });

  if (args.json) {
    console.log(JSON.stringify(toFolderSummaryJson(index), null, 2));
    return EXIT.ok;
  }

  const outPath = args.out ? resolve(process.cwd(), args.out) : DEFAULT_DIR_OUT;
  if (existsSync(outPath) && !args.force) {
    return fail(
      `output already exists: ${relative(process.cwd(), outPath)} — pass --force to overwrite.`,
      EXIT.usage,
    );
  }

  const nav = navItem("folder");
  const document = DashboardShell({
    activeId: nav.id,
    title: nav.label,
    description: nav.description,
    body: renderFolderIndex(index, { name: basename(dirPath) }),
  });
  const htmlOut = `${renderDocument(document)}\n`;

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, htmlOut, "utf8");
  } catch (err) {
    return fail(
      `could not write ${args.out ?? "default output"}: ${err instanceof Error ? err.message : String(err)}`,
      EXIT.runtime,
    );
  }

  const c = index.counts;
  console.log(`web:inspect: wrote ${relative(process.cwd(), outPath)}`);
  console.log(
    `  scanned ${c.filesScanned} · valid ${c.validArtifacts} · malformed ${c.malformedFiles} · ` +
      `skipped ${c.skippedFiles} · regression ${c.withRegression} · change ${c.withChange}`,
  );
  return EXIT.ok;
}

/** Only run (and exit) when invoked directly, so tests can import `main`. */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exit(main(process.argv.slice(2)));
}
