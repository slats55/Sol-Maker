import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../src/inspect.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/sample-backtest-report.json", import.meta.url));
const RESEARCH_FIXTURE = fileURLToPath(new URL("../fixtures/sample-research-verify.json", import.meta.url));

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
