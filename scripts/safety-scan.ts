/**
 * Sprint 103 — `pnpm safety:scan`: a repo-level secret / wallet / filesystem leak scan.
 *
 * It scans the TRACKED files only (`git ls-files`) for REAL leaks — never harmless prose — and
 * verifies `.gitignore` covers the secret-bearing paths. The checks are deliberately high-signal:
 *
 *   - a tracked file with a secret-bearing NAME (`*.keypair`, `*.key`, `*.wallet`, a real `.env`,
 *     anything under `secrets/` or `burner/`);
 *   - a solana-keygen PRIVATE-KEY byte array (64 ints 0-255) with real entropy (filler like
 *     `[0,0,...]` is ignored);
 *   - a long base58 SECRET-KEY blob (80+ chars; public keys are <= ~44) with real entropy (filler
 *     like "5".repeat(96) is ignored);
 *   - an explicit secret ASSIGNMENT (`PRIVATE_KEY=`, `MNEMONIC:`, ...) to a long, varied value.
 *
 * Lock files (Cargo.lock, pnpm-lock.yaml, package-lock.json) are exempt from the blob checks — they
 * carry legitimate 64-hex checksums and base64 integrity hashes that are NOT secrets. Findings print
 * a REDACTED location only; the scan never echoes the offending bytes.
 *
 * Run: `pnpm safety:scan`  (exit 1 on any finding). The pure helpers are unit-tested.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The ignore rules a wallet-safety-first repo must carry. */
export const REQUIRED_GITIGNORE_RULES = [
  "runs/",
  "target/",
  "*.keypair",
  "*.key",
  "*.wallet",
  ".env",
  "secrets/",
  "burner/",
] as const;

/** Tracked filenames / paths that must never exist (secret-bearing by name). */
const SECRET_FILENAME_RE = /(^|[\\/])(secrets|burner)[\\/]|\.(keypair|wallet)$|(^|[\\/])[^\\/]*\.key$|(^|[\\/])\.env(\.[^\\/]*)?$/i;
/** `.env.example` is the one allowed .env-shaped file. */
const ENV_EXAMPLE_RE = /(^|[\\/])\.env\.example$/i;

/** Lock files carry legitimate checksum/integrity hashes — exempt from the blob checks. */
const LOCK_FILE_RE = /(^|[\\/])(Cargo\.lock|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i;

export interface SafetyFinding {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

function distinctChars(s: string): number {
  return new Set(s.split("")).size;
}

/** Count distinct integer values in a comma-separated run like "12,34,12,...". */
function distinctInts(csv: string): number {
  return new Set(csv.split(",").map((x) => x.trim())).size;
}

const BASE58_BLOB_RE = /[1-9A-HJ-NP-Za-km-z]{80,}/g;
const BYTE_ARRAY_RE = /\[\s*(\d{1,3}(?:\s*,\s*\d{1,3}){63})\s*\]/g;
const SECRET_ASSIGN_RE =
  /(private[_-]?key|secret[_-]?key|wallet[_-]?secret|mnemonic|seed[_-]?phrase|passphrase)\s*[:=]\s*["']?([A-Za-z0-9+/]{24,})/gi;

/**
 * Scan one file's text for REAL secret leaks. Pure. `fileName` selects lock-file exemptions.
 * Returns findings with a REDACTED detail (never the offending bytes).
 */
export function scanContentForSecrets(text: string, fileName: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const isLock = LOCK_FILE_RE.test(fileName);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    // Explicit, auditable allowlist for intentional fixtures (e.g. the redactor's own fake key):
    // a `safety-scan-ignore` marker on the line or the line directly above skips it.
    if (line.includes("safety-scan-ignore") || (i > 0 && (lines[i - 1] as string).includes("safety-scan-ignore"))) {
      continue;
    }

    // 1) base58 secret-key blob (80+, high entropy). Public keys are <= ~44 chars.
    if (!isLock) {
      for (const m of line.matchAll(BASE58_BLOB_RE)) {
        const blob = m[0] as string;
        if (distinctChars(blob) >= 20) {
          findings.push({ file: fileName, line: i + 1, rule: "base58-secret-blob", detail: `${blob.length}-char high-entropy base58 blob [REDACTED]` });
        }
      }
    }

    // 2) solana-keygen private-key byte array (64 ints 0-255, real entropy).
    for (const m of line.matchAll(BYTE_ARRAY_RE)) {
      const csv = m[1] as string;
      const ints = csv.split(",").map((x) => Number(x.trim()));
      if (ints.every((n) => n >= 0 && n <= 255) && distinctInts(csv) >= 12) {
        findings.push({ file: fileName, line: i + 1, rule: "private-key-byte-array", detail: "64-element 0-255 byte array (keypair-shaped) [REDACTED]" });
      }
    }

    // 3) explicit secret assignment to a long, varied value.
    if (!isLock) {
      for (const m of line.matchAll(SECRET_ASSIGN_RE)) {
        const value = m[2] as string;
        if (distinctChars(value) >= 10 && !/^(your|example|placeholder|redacted|changeme|xxx)/i.test(value)) {
          findings.push({ file: fileName, line: i + 1, rule: "secret-assignment", detail: `${(m[1] as string).toLowerCase()} = [REDACTED]` });
        }
      }
    }
  }
  return findings;
}

/** Verify `.gitignore` covers every required secret-bearing path. Returns the missing rules. */
export function checkGitignoreCoverage(gitignoreText: string): string[] {
  const lines = new Set(gitignoreText.split(/\r?\n/).map((l) => l.trim()));
  return REQUIRED_GITIGNORE_RULES.filter((rule) => !lines.has(rule));
}

/** True if a tracked path is secret-bearing by name (and not the allowed .env.example). */
export function isSecretFilename(path: string): boolean {
  if (ENV_EXAMPLE_RE.test(path)) return false;
  return SECRET_FILENAME_RE.test(path);
}

/** List tracked files via git. */
export function listTrackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split(/\r?\n/).filter((l) => l.length > 0);
}

export interface SafetyScanResult {
  filenameFindings: string[];
  contentFindings: SafetyFinding[];
  missingGitignoreRules: string[];
  filesScanned: number;
}

/** Run the full repo scan over tracked files. */
export function runRepoSafetyScan(): SafetyScanResult {
  const tracked = listTrackedFiles();
  const filenameFindings = tracked.filter(isSecretFilename);
  const contentFindings: SafetyFinding[] = [];
  let filesScanned = 0;
  for (const rel of tracked) {
    const full = join(REPO_ROOT, rel);
    if (!existsSync(full)) continue;
    let buf: Buffer;
    try {
      buf = readFileSync(full);
    } catch {
      continue;
    }
    // Skip binary files (a NUL in the first 8 KiB).
    if (buf.subarray(0, 8192).includes(0)) continue;
    filesScanned++;
    contentFindings.push(...scanContentForSecrets(buf.toString("utf8"), rel));
  }
  const gitignorePath = join(REPO_ROOT, ".gitignore");
  const missingGitignoreRules = existsSync(gitignorePath)
    ? checkGitignoreCoverage(readFileSync(gitignorePath, "utf8"))
    : [...REQUIRED_GITIGNORE_RULES];
  return { filenameFindings, contentFindings, missingGitignoreRules, filesScanned };
}

function main(): void {
  const result = runRepoSafetyScan();
  const problems: string[] = [];
  for (const f of result.filenameFindings) problems.push(`TRACKED SECRET FILE: ${f}`);
  for (const f of result.contentFindings) problems.push(`${f.rule} @ ${f.file}:${f.line} — ${f.detail}`);
  for (const r of result.missingGitignoreRules) problems.push(`.gitignore is MISSING the rule: ${r}`);

  console.log(`safety:scan — scanned ${result.filesScanned} tracked text file(s).`);
  if (problems.length === 0) {
    console.log("OK — no tracked secret files, no key/seed leaks, .gitignore covers the secret-bearing paths.");
    return;
  }
  console.log(`FOUND ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
