import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../src/inspect.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/sample-backtest-report.json", import.meta.url));
const RESEARCH_FIXTURE = fileURLToPath(new URL("../fixtures/sample-research-verify.json", import.meta.url));
const FOLDER_FIXTURE = fileURLToPath(new URL("../fixtures/folder-sample", import.meta.url));

const TIMEOUT = 30_000;

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the inspect command in a child process via `node --import tsx`. */
function runInspect(args: readonly string[]): RunResult {
  const res = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-inspect-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("web:inspect — happy path", () => {
  it(
    "prints a valid machine-readable summary with --json and writes no file",
    () => {
      const out = join(dir, "should-not-exist.html");
      const res = runInspect(["--input", FIXTURE, "--out", out, "--json"]);
      expect(res.status).toBe(0);
      const summary = JSON.parse(res.stdout.trim());
      expect(summary.schemaVersion).toBe("backtest.report.v1");
      expect(summary.schemaStatus).toBe("stable");
      expect(existsSync(out)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "writes a static HTML page with --out",
    () => {
      const out = join(dir, "written.html");
      const res = runInspect(["--input", FIXTURE, "--out", out]);
      expect(res.status).toBe(0);
      expect(existsSync(out)).toBe(true);
      const html = readFileSync(out, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("PAPER ONLY");
      expect(html).toContain("backtest.report.v1");
    },
    TIMEOUT,
  );
});

describe("web:inspect — overwrite protection", () => {
  it(
    "refuses to overwrite an existing --out without --force",
    () => {
      const out = join(dir, "overwrite.html");
      expect(runInspect(["--input", FIXTURE, "--out", out]).status).toBe(0);
      const res = runInspect(["--input", FIXTURE, "--out", out]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("--force");
    },
    TIMEOUT,
  );

  it(
    "overwrites with --force",
    () => {
      const out = join(dir, "force.html");
      expect(runInspect(["--input", FIXTURE, "--out", out]).status).toBe(0);
      expect(runInspect(["--input", FIXTURE, "--out", out, "--force"]).status).toBe(0);
    },
    TIMEOUT,
  );
});

describe("web:inspect — input validation (fail-closed, non-zero exit)", () => {
  it(
    "rejects malformed JSON and writes nothing",
    () => {
      const bad = join(dir, "bad.json");
      writeFileSync(bad, "{ not valid,,", "utf8");
      const out = join(dir, "bad-out.html");
      const res = runInspect(["--input", bad, "--out", out]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("malformed");
      expect(existsSync(out)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "rejects a non-.json input",
    () => {
      const txt = join(dir, "data.txt");
      writeFileSync(txt, "{}", "utf8");
      const res = runInspect(["--input", txt, "--json"]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain(".json");
    },
    TIMEOUT,
  );

  it(
    "rejects a directory input",
    () => {
      const res = runInspect(["--input", dir, "--json"]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("directory");
    },
    TIMEOUT,
  );

  it(
    "rejects a missing input file",
    () => {
      const res = runInspect(["--input", join(dir, "nope.json"), "--json"]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("not found");
    },
    TIMEOUT,
  );

  it(
    "requires --input",
    () => {
      const res = runInspect(["--json"]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("required");
    },
    TIMEOUT,
  );
});

describe("web:inspect — generated output safety", () => {
  /** Structural patterns that must never appear in a benign-input render. */
  const FORBIDDEN: readonly RegExp[] = [
    /<script/i,
    /\son(?:click|load|error|mouseover|focus|submit|change|input)\s*=/i,
    /\bfetch\s*\(/,
    /\baxios\b/i,
    /\bWebSocket\b/,
    /\bsignTransaction\b/,
    /\bsendTransaction\b/,
    /\bKeypair\b/,
    /\bprivateKey\b/,
    /\bsecretKey\b/,
    /\bmnemonic\b/i,
    /\bseedPhrase\b/,
  ];

  it(
    "produces no script, handler, network, or wallet patterns from a benign report",
    () => {
      const out = join(dir, "safe.html");
      expect(runInspect(["--input", FIXTURE, "--out", out, "--force"]).status).toBe(0);
      const html = readFileSync(out, "utf8");
      for (const re of FORBIDDEN) {
        expect(html, `should not match ${re}`).not.toMatch(re);
      }
    },
    TIMEOUT,
  );

  it(
    "escapes hostile report content instead of injecting it",
    () => {
      const hostile = join(dir, "hostile.json");
      writeFileSync(
        hostile,
        JSON.stringify({
          schemaVersion: "backtest.report.v1",
          name: "<script>alert('xss')</script>",
          evil: '"><img src=x onerror=alert(1)>',
        }),
        "utf8",
      );
      const out = join(dir, "hostile.html");
      expect(runInspect(["--input", hostile, "--out", out, "--force"]).status).toBe(0);
      const html = readFileSync(out, "utf8");
      // No real injected elements survive — only escaped text.
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;");
    },
    TIMEOUT,
  );
});

describe("web:inspect — schema-aware typed views", () => {
  it(
    "renders a typed section for a recognized stable report, keeping the generic view",
    () => {
      const out = join(dir, "typed-report.html");
      expect(runInspect(["--input", FIXTURE, "--out", out, "--force"]).status).toBe(0);
      const html = readFileSync(out, "utf8");
      expect(html).toContain("sm-typedview");
      expect(html).toContain("Schema-aware view — Backtest report");
      expect(html).toContain("Simulated PnL (not real, not advice)");
      // The generic normalized view is still present below the typed view.
      expect(html).toContain("Raw preview");
      expect(html).toContain("Generic field view");
    },
    TIMEOUT,
  );

  it(
    "renders a typed section for a research artifact with the safety banner",
    () => {
      const out = join(dir, "typed-verify.html");
      expect(runInspect(["--input", RESEARCH_FIXTURE, "--out", out, "--force"]).status).toBe(0);
      const html = readFileSync(out, "utf8");
      expect(html).toContain("sm-typedview");
      expect(html).toContain("Per-artifact verification");
      expect(html).toContain("PAPER ONLY");
    },
    TIMEOUT,
  );

  it(
    "produces byte-identical output for identical input (deterministic)",
    () => {
      const a = join(dir, "det-a.html");
      const b = join(dir, "det-b.html");
      expect(runInspect(["--input", FIXTURE, "--out", a, "--force"]).status).toBe(0);
      expect(runInspect(["--input", FIXTURE, "--out", b, "--force"]).status).toBe(0);
      expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
    },
    TIMEOUT,
  );
});

describe("web:inspect --dir — folder index", () => {
  it(
    "prints a folder summary with --json and writes no file",
    () => {
      const out = join(dir, "folder-should-not-exist.html");
      const res = runInspect(["--dir", FOLDER_FIXTURE, "--out", out, "--json"]);
      expect(res.status).toBe(0);
      const summary = JSON.parse(res.stdout.trim());
      expect(summary.counts.filesScanned).toBe(8);
      expect(summary.counts.jsonFiles).toBe(7);
      expect(summary.counts.validArtifacts).toBe(6);
      expect(summary.counts.malformedFiles).toBe(1);
      expect(summary.counts.skippedFiles).toBe(1);
      expect(summary.counts.unknownSchemas).toBe(1);
      expect(summary.counts.withRegression).toBe(1);
      expect(summary.counts.withChange).toBe(3);
      expect(existsSync(out)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "does not crash on malformed JSON and lists it as malformed",
    () => {
      const res = runInspect(["--dir", FOLDER_FIXTURE, "--json"]);
      expect(res.status).toBe(0);
      const summary = JSON.parse(res.stdout.trim());
      const broken = summary.artifacts.find((a: { name: string }) => a.name === "broken.json");
      expect(broken.status).toBe("malformed");
      expect(broken.hasRegression).toBe("not-applicable");
    },
    TIMEOUT,
  );

  it(
    "skips non-JSON files with an honest count and reason",
    () => {
      const res = runInspect(["--dir", FOLDER_FIXTURE, "--json"]);
      const summary = JSON.parse(res.stdout.trim());
      const skipped = summary.skipped.find((s: { name: string }) => s.name === "notes.txt");
      expect(skipped).toBeTruthy();
      expect(skipped.reason).toContain(".json");
    },
    TIMEOUT,
  );

  it(
    "labels an unknown schema as unknown (not stable) and fakes no verdict",
    () => {
      const res = runInspect(["--dir", FOLDER_FIXTURE, "--json"]);
      const summary = JSON.parse(res.stdout.trim());
      const unknown = summary.artifacts.find((a: { name: string }) => a.name === "unknown-schema.json");
      expect(unknown.schemaStatus).toBe("unknown");
      expect(unknown.hasTypedView).toBe(false);
      // The file literally carries hasRegression/hasChange booleans — must NOT be trusted.
      expect(unknown.hasRegression).toBe("not-applicable");
      expect(unknown.hasChange).toBe("not-applicable");
    },
    TIMEOUT,
  );

  it(
    "shows registry kind/status for a recognized schema",
    () => {
      const res = runInspect(["--dir", FOLDER_FIXTURE, "--json"]);
      const summary = JSON.parse(res.stdout.trim());
      const report = summary.artifacts.find((a: { name: string }) => a.name === "report.json");
      expect(report.schemaStatus).toBe("stable");
      expect(report.kind).toBe("Backtest report");
      expect(report.hasTypedView).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "writes a static HTML index with per-artifact sections + links",
    () => {
      const out = join(dir, "folder.html");
      const res = runInspect(["--dir", FOLDER_FIXTURE, "--out", out]);
      expect(res.status).toBe(0);
      expect(existsSync(out)).toBe(true);
      const html = readFileSync(out, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("PAPER ONLY");
      expect(html).toContain("sm-folderindex");
      expect(html).toContain("Scan summary");
      // Same-page anchor links to per-artifact sections.
      expect(html).toMatch(/href="#sm-artifact-\d+-/);
      expect(html).toMatch(/id="sm-artifact-\d+-/);
      // A recognized diff renders its typed view inside its section.
      expect(html).toContain("Schema-aware view — Research bundle diff");
    },
    TIMEOUT,
  );

  it(
    "produces byte-identical output for the same folder (deterministic)",
    () => {
      const a = join(dir, "folder-a.html");
      const b = join(dir, "folder-b.html");
      expect(runInspect(["--dir", FOLDER_FIXTURE, "--out", a, "--force"]).status).toBe(0);
      expect(runInspect(["--dir", FOLDER_FIXTURE, "--out", b, "--force"]).status).toBe(0);
      expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
    },
    TIMEOUT,
  );
});

describe("web:inspect --dir — generated output safety", () => {
  const FORBIDDEN: readonly RegExp[] = [
    /<script/i,
    /\son(?:click|load|error|mouseover|focus|submit|change|input)\s*=/i,
    /\bfetch\s*\(/,
    /\baxios\b/i,
    /\bWebSocket\b/,
    /@import/,
    /url\(/,
    /https?:\/\//,
    /\bsignTransaction\b/,
    /\bKeypair\b/,
    /\bprivateKey\b/,
  ];

  it(
    "renders the fixture folder with no script/handler/network/wallet patterns",
    () => {
      const out = join(dir, "folder-safe.html");
      expect(runInspect(["--dir", FOLDER_FIXTURE, "--out", out, "--force"]).status).toBe(0);
      const html = readFileSync(out, "utf8");
      for (const re of FORBIDDEN) {
        expect(html, `should not match ${re}`).not.toMatch(re);
      }
    },
    TIMEOUT,
  );

  it(
    "escapes hostile artifact content found in a scanned folder",
    () => {
      const hostileDir = join(dir, "hostile-folder");
      mkdirSync(hostileDir, { recursive: true });
      writeFileSync(
        join(hostileDir, "evil.json"),
        JSON.stringify({
          schemaVersion: "backtest.report.v1",
          scenarioName: "<script>alert('xss')</script>",
          evil: '"><img src=x onerror=alert(1)>',
        }),
        "utf8",
      );
      const out = join(dir, "hostile-folder.html");
      expect(runInspect(["--dir", hostileDir, "--out", out, "--force"]).status).toBe(0);
      const html = readFileSync(out, "utf8");
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;");
    },
    TIMEOUT,
  );
});

describe("web:inspect — mode selection + folder validation", () => {
  it(
    "rejects passing both --input and --dir",
    () => {
      const res = runInspect(["--input", FIXTURE, "--dir", FOLDER_FIXTURE, "--json"]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("both");
    },
    TIMEOUT,
  );

  it(
    "rejects a missing folder",
    () => {
      const res = runInspect(["--dir", join(dir, "nope-folder"), "--json"]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("not found");
    },
    TIMEOUT,
  );

  it(
    "rejects a file passed to --dir",
    () => {
      const res = runInspect(["--dir", FIXTURE, "--json"]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("not a folder");
    },
    TIMEOUT,
  );

  it(
    "refuses to overwrite an existing folder --out without --force",
    () => {
      const out = join(dir, "folder-overwrite.html");
      expect(runInspect(["--dir", FOLDER_FIXTURE, "--out", out]).status).toBe(0);
      const res = runInspect(["--dir", FOLDER_FIXTURE, "--out", out]);
      expect(res.status).not.toBe(0);
      expect(res.stderr.toLowerCase()).toContain("--force");
      expect(runInspect(["--dir", FOLDER_FIXTURE, "--out", out, "--force"]).status).toBe(0);
    },
    TIMEOUT,
  );
});
