/**
 * Node-only LOCAL artifact inspector command.
 *
 * Reads exactly one local PAPER report JSON file, normalizes it defensively
 * (see ./lib/local-artifact.ts), and renders a static HTML page through the same
 * dashboard shell the static generator uses (./components/layout.ts). The output
 * is script-free, escaped, and capped.
 *
 * Run from the repo root:
 *   pnpm web:inspect --input <report.json> --out apps/web/public/research-artifact.html --force
 *   pnpm web:inspect --input <report.json> --json     # print summary, write nothing
 *
 * Hard guarantees:
 *   - Reads ONE local file. No directories, no globs, no recursion.
 *   - No network, no fetch, no server, no chain, no wallet, no keys.
 *   - Refuses non-.json inputs, directory inputs, and missing files.
 *   - Malformed JSON fails clearly with a non-zero exit and writes nothing.
 *   - Refuses to overwrite an existing --out unless --force is given.
 *   - Never executes report content; it is only escaped and displayed.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
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
import { DashboardShell } from "./components/layout.js";
import { renderArtifactReport } from "./pages/artifact.js";

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src
const webRoot = dirname(here); // apps/web
const DEFAULT_OUT = join(webRoot, "public", "research-artifact.html");

/** Exit codes: 0 ok · 1 runtime/IO/parse error · 2 usage/validation error. */
const EXIT = { ok: 0, runtime: 1, usage: 2 } as const;

interface CliArgs {
  input?: string;
  out?: string;
  force: boolean;
  json: boolean;
  help: boolean;
  unknown: string[];
}

const USAGE = `Soulmaker web:inspect — render ONE local PAPER report JSON as a static page.

Usage:
  pnpm web:inspect --input <report.json> [--out <file.html>] [--force] [--json]

Options:
  --input <file>   Required. Path to one local .json report artifact.
  --out <file>     Output HTML path. Default: apps/web/public/research-artifact.html
  --force          Overwrite --out if it already exists.
  --json           Print a machine-readable summary to stdout; write no HTML.
  -h, --help       Show this help.

Local-only: reads one local file, writes one local HTML file. No upload, no
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
    } else if (arg === "--input" || arg === "--out") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        args.unknown.push(`${arg} (missing value)`);
      } else {
        if (arg === "--input") args.input = next;
        else args.out = next;
        i += 1;
      }
    } else if (arg.startsWith("--input=")) {
      args.input = arg.slice("--input=".length);
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
  if (!args.input) {
    console.error("web:inspect: --input <report.json> is required.");
    console.error(USAGE);
    return EXIT.usage;
  }

  const inputPath = resolve(process.cwd(), args.input);

  let stat;
  try {
    stat = statSync(inputPath);
  } catch {
    return fail(`input file not found: ${args.input}`, EXIT.runtime);
  }
  if (stat.isDirectory()) {
    return fail(`input is a directory, not a file: ${args.input}`, EXIT.usage);
  }
  if (!inputPath.toLowerCase().endsWith(".json")) {
    return fail(`input must be a .json file: ${args.input}`, EXIT.usage);
  }

  let text: string;
  try {
    text = readFileSync(inputPath, "utf8");
  } catch (err) {
    return fail(
      `could not read ${args.input}: ${err instanceof Error ? err.message : String(err)}`,
      EXIT.runtime,
    );
  }

  const parsed = parseArtifactJson(text);
  if (!parsed.ok) {
    return fail(`malformed JSON in ${args.input}: ${parsed.error}`, EXIT.runtime);
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
    body: renderArtifactReport(view, { name: basename(inputPath) }),
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

/** Only run (and exit) when invoked directly, so tests can import `main`. */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exit(main(process.argv.slice(2)));
}
