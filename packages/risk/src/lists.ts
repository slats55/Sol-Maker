/**
 * Allowlist / denylist / previously-traded list utilities — pure functions only.
 *
 * No file I/O lives here by design: this package stays pure and dependency-light
 * so it is trivial to test offline. The CLI is responsible for reading a file
 * from disk and handing the *text* to {@link parseList}.
 *
 * Important: Solana addresses are **case-sensitive** base58. Normalization
 * therefore only trims surrounding whitespace — it must never change case, or it
 * would corrupt a perfectly valid mint into a different (or invalid) one.
 */

/** Trim surrounding whitespace from a mint string. Case is preserved. */
export function normalizeMint(mint: string): string {
  return mint.trim();
}

export interface ParsedList {
  /** De-duplicated, normalized entries in first-seen order. */
  entries: string[];
  /** Entries that appeared more than once (each listed once), in first-seen order. */
  duplicates: string[];
}

/**
 * Parse newline-separated list content into normalized, de-duplicated entries.
 *
 *  - Lines are split on `\n` (and tolerate `\r\n`).
 *  - Blank lines are ignored.
 *  - `# comments` are ignored — both whole-line (`# note`) and trailing
 *    (`<mint> # note`). A mint never contains `#`, so splitting on the first
 *    `#` is safe.
 *  - Remaining entries are trimmed; duplicates are detected and reported.
 */
export function parseList(content: string): ParsedList {
  const entries: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  const dupSeen = new Set<string>();

  for (const rawLine of content.split("\n")) {
    // Strip a trailing/whole-line comment, then trim.
    const withoutComment = rawLine.split("#", 1)[0] ?? "";
    const entry = normalizeMint(withoutComment);
    if (entry.length === 0) continue;

    if (seen.has(entry)) {
      if (!dupSeen.has(entry)) {
        duplicates.push(entry);
        dupSeen.add(entry);
      }
      continue;
    }
    seen.add(entry);
    entries.push(entry);
  }

  return { entries, duplicates };
}

/**
 * Normalize + de-duplicate an array of entries (e.g. lists supplied directly in
 * config rather than parsed from a file). Same semantics as {@link parseList}
 * minus the comment/line handling.
 */
export function dedupeList(input: readonly string[]): ParsedList {
  const entries: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  const dupSeen = new Set<string>();

  for (const raw of input) {
    const entry = normalizeMint(raw);
    if (entry.length === 0) continue;
    if (seen.has(entry)) {
      if (!dupSeen.has(entry)) {
        duplicates.push(entry);
        dupSeen.add(entry);
      }
      continue;
    }
    seen.add(entry);
    entries.push(entry);
  }

  return { entries, duplicates };
}

/**
 * Case-sensitive membership test after trimming both sides. Returns false for an
 * undefined/empty list.
 */
export function listIncludes(
  list: readonly string[] | undefined,
  mint: string,
): boolean {
  if (!list || list.length === 0) return false;
  const target = normalizeMint(mint);
  for (const entry of list) {
    if (normalizeMint(entry) === target) return true;
  }
  return false;
}
