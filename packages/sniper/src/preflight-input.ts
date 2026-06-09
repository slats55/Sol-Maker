/**
 * Deterministic, offline, **PAPER-only** SNIPER PREFLIGHT INPUT artifact (Sprint 47 — the deferred
 * S38, done right: LOCAL input validation, no new RPC).
 *
 * The token preflight (`token-preflight.ts`) consumes per-candidate, already-loaded read-only
 * inspection (`token:inspect` output) and advisory risk (`token:risk` output) JSON. Before Sprint 47
 * those inputs were loose files wired up with repeatable CLI flags and any shape problem only
 * surfaced as a silently-absent section mid-preflight. This module gives operators a **validated,
 * versioned input artifact** (`sniper.preflight.input.v1`) to check FIRST:
 *
 *   candidates → **preflight input validate** → preflight report → decisions
 *
 * Each entry pairs a `candidateId` + `mint` with its raw inspection/risk values, carried **VERBATIM**
 * (so the artifact can drive `paper:sniper:preflight` without loss) plus an honest projection using
 * the SAME logic the preflight itself uses — `unsupported shape`, `missing section`, and
 * `mint mismatch` are surfaced as explicit warnings instead of silent absence.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — it validates LOCAL files
 * only and NEVER fetches chain data. Validating an input artifact does not verify any on-chain fact:
 * the inspection/risk values are whatever the operator's earlier read-only commands produced. Mints
 * are validated with the package's pure base58 parser, which REFUSES secret-length input outright
 * (never echoed). Carries no wall-clock time.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "./mint-address.js";
import { validateSniperCandidateList, type SniperCandidateList } from "./candidate-list.js";
import {
  projectSniperPreflightInspection,
  projectSniperPreflightRisk,
  type SniperPreflightInspection,
  type SniperPreflightRisk,
} from "./token-preflight.js";

/** Stable schema identifier for the preflight input artifact. Bump only on a breaking change. */
export const SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION = "sniper.preflight.input.v1";

/** The banner that prefixes every preflight input artifact (required label). */
export const SNIPER_PREFLIGHT_INPUT_BANNER = "SIMULATED PAPER-ONLY SNIPER PREFLIGHT INPUT";

/** Required disclaimer statements carried by every preflight input artifact (stable order). */
export const SNIPER_PREFLIGHT_INPUT_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER PREFLIGHT INPUT — a validated bundle of LOCAL, already-loaded per-candidate inspection + advisory risk data for the sniper preflight.",
  "LOCAL-ONLY: this artifact validates files the operator already has (e.g. token:inspect / token:risk output). Nothing here fetches chain data, and validation verifies NO on-chain fact.",
  "Raw inspection/risk values are carried VERBATIM; the projected summaries use the SAME logic the preflight uses, so an unsupported shape or a mint mismatch is surfaced here instead of silently mid-preflight.",
  "A clean validation means the inputs are WELL-FORMED — it is NOT a safety judgment, NOT a trade signal, and NOT a profitability claim.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this artifact.",
];

/** Thrown when preflight-input INPUT or a produced artifact is structurally invalid. */
export class SniperPreflightInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperPreflightInputError";
  }
}

// --- input -------------------------------------------------------------------

/** One operator-supplied entry (raw). */
export interface SniperPreflightInputEntryInput {
  /** The candidateId this data belongs to. */
  candidateId: string;
  /** The mint the data is for (validated; secret-length input is REFUSED, never echoed). */
  mint: string;
  /** A parsed read-only mint inspection (token:inspect-shaped). Optional. */
  inspection?: unknown;
  /** A parsed advisory risk report (token:risk-shaped). Optional. */
  risk?: unknown;
  /** Optional operator label for where this entry's data came from. */
  sourceLabel?: string | null;
}

/** Everything {@link normalizeSniperPreflightInput} accepts (operator-friendly raw input). */
export interface NormalizeSniperPreflightInputInput {
  /** Optional operator label for the whole input bundle. */
  sourceLabel?: string | null;
  /** Optional label/path of the candidate list this input pairs with (a string label only). */
  candidateListRef?: string | null;
  /** The per-candidate entries. */
  entries?: SniperPreflightInputEntryInput[];
  /**
   * Optional candidate list (`sniper.candidate.list.v1`) to CROSS-CHECK against: an entry whose
   * candidateId is not in the list, or whose mint disagrees with the list's, is REFUSED; candidates
   * without an entry are surfaced as warnings.
   */
  candidateList?: unknown;
}

// --- model -------------------------------------------------------------------

/** One validated entry in the canonical artifact. */
export interface SniperPreflightInputEntry {
  candidateId: string;
  /** The canonical (trimmed, validated) mint. */
  mint: string;
  /** Raw inspection value carried VERBATIM (null when not supplied). */
  inspection: unknown;
  /** Raw risk value carried VERBATIM (null when not supplied). */
  risk: unknown;
  /** Whether an inspection value was supplied at all. */
  inspectionSupplied: boolean;
  /** Whether a risk value was supplied at all. */
  riskSupplied: boolean;
  /** Supplied but not projectable (not an object) — treated as absent by the preflight. */
  unsupportedInspectionShape: boolean;
  /** Supplied but not projectable (not an object) — treated as absent by the preflight. */
  unsupportedRiskShape: boolean;
  /** Projection of the inspection using the SAME logic the preflight uses (null when absent/unusable). */
  inspectionSummary: SniperPreflightInspection | null;
  /** Projection of the risk using the SAME logic the preflight uses (null when absent/unusable). */
  riskSummary: SniperPreflightRisk | null;
  warnings: string[];
  sourceLabel: string | null;
}

/** The full, deterministic, JSON-serializable preflight input artifact. */
export interface SniperPreflightInput {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  sourceLabel: string | null;
  candidateListRef: string | null;
  /** Whether a candidate list was cross-checked at normalize time. */
  crossCheckedAgainstCandidateList: boolean;
  entryCount: number;
  entries: SniperPreflightInputEntry[];
  // --- aggregates (usable = supplied AND projectable) ---
  missingInspectionCount: number;
  missingRiskCount: number;
  unsupportedShapeCount: number;
  mintMismatchCount: number;
  /** Cross-checked candidates without an entry (null when no list was cross-checked). */
  uncoveredCandidateCount: number | null;
  hasWarnings: boolean;
  /** "valid" (no warning anywhere) or "valid-with-warnings". A structural problem THROWS instead. */
  validationStatus: "valid" | "valid-with-warnings";
  warnings: string[];
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optString(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new SniperPreflightInputError(`${name} must be a string when present`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Build one canonical entry from a raw entry (pure; collects entry-level warnings). */
function buildEntry(raw: SniperPreflightInputEntryInput, index: number): SniperPreflightInputEntry {
  if (!isObject(raw)) throw new SniperPreflightInputError(`entries[${index}] must be an object`);
  if (typeof raw.candidateId !== "string" || raw.candidateId.trim().length === 0) {
    throw new SniperPreflightInputError(`entries[${index}].candidateId must be a non-empty string`);
  }
  const candidateId = raw.candidateId.trim();
  let mint: string;
  try {
    mint = parseMintAddress(raw.mint);
  } catch (err) {
    // parseMintAddress never echoes secret-length input; safe to relay its message.
    throw new SniperPreflightInputError(`entries[${index}] ("${candidateId}"): ${(err as Error).message}`);
  }

  const inspectionSupplied = raw.inspection !== undefined && raw.inspection !== null;
  const riskSupplied = raw.risk !== undefined && raw.risk !== null;
  const inspectionSummary = inspectionSupplied ? projectSniperPreflightInspection(raw.inspection, mint) : null;
  const riskSummary = riskSupplied ? projectSniperPreflightRisk(raw.risk, mint) : null;
  const unsupportedInspectionShape = inspectionSupplied && inspectionSummary === null;
  const unsupportedRiskShape = riskSupplied && riskSummary === null;

  const warnings: string[] = [];
  if (unsupportedInspectionShape) {
    warnings.push("unsupported local inspection shape (not an object) — the preflight would treat it as absent");
  }
  if (unsupportedRiskShape) {
    warnings.push("unsupported local risk shape (not an object) — the preflight would treat it as absent");
  }
  if (inspectionSummary && !inspectionSummary.mintMatches) {
    warnings.push("supplied inspection is for a different mint than this entry");
  }
  if (riskSummary && !riskSummary.mintMatches) {
    warnings.push("supplied risk report is for a different mint than this entry");
  }
  if (inspectionSummary === null && riskSummary === null) {
    warnings.push("no usable inspection or risk data — the preflight would mark this candidate unknown");
  }

  return {
    candidateId,
    mint,
    inspection: inspectionSupplied ? raw.inspection : null,
    risk: riskSupplied ? raw.risk : null,
    inspectionSupplied,
    riskSupplied,
    unsupportedInspectionShape,
    unsupportedRiskShape,
    inspectionSummary,
    riskSummary,
    warnings,
    sourceLabel: optString(raw.sourceLabel, `entries[${index}].sourceLabel`),
  };
}

/** Recompute the artifact aggregates from its entries (shared by normalize + validate). */
function aggregate(entries: SniperPreflightInputEntry[]): {
  missingInspectionCount: number;
  missingRiskCount: number;
  unsupportedShapeCount: number;
  mintMismatchCount: number;
} {
  return {
    missingInspectionCount: entries.filter((e) => e.inspectionSummary === null).length,
    missingRiskCount: entries.filter((e) => e.riskSummary === null).length,
    unsupportedShapeCount: entries.filter((e) => e.unsupportedInspectionShape || e.unsupportedRiskShape).length,
    mintMismatchCount: entries.filter(
      (e) => (e.inspectionSummary !== null && !e.inspectionSummary.mintMatches) || (e.riskSummary !== null && !e.riskSummary.mintMatches),
    ).length,
  };
}

// --- normalize ----------------------------------------------------------------

/**
 * Normalize operator-friendly raw input into a canonical {@link SniperPreflightInput}. Pure,
 * non-mutating, and idempotent (a canonical artifact re-normalizes to itself, summaries re-derived).
 * Duplicate candidateIds are REFUSED; every mint is validated with the pure base58 parser (a
 * secret-length string is refused and never echoed). When `candidateList` is supplied it is strictly
 * validated and cross-checked: an entry for an unknown candidateId — or one whose mint disagrees with
 * the list — is REFUSED; candidates without an entry are warned, never invented. Throws
 * {@link SniperPreflightInputError} on any structural problem.
 */
export function normalizeSniperPreflightInput(input: NormalizeSniperPreflightInputInput = {}): SniperPreflightInput {
  if (!isObject(input)) throw new SniperPreflightInputError("preflight input must be an object");
  if (input.entries !== undefined && !Array.isArray(input.entries)) {
    throw new SniperPreflightInputError("preflight input.entries must be an array when present");
  }

  const entries = (input.entries ?? []).map((raw, i) => buildEntry(raw, i));

  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.candidateId)) {
      throw new SniperPreflightInputError(`duplicate entry for candidateId "${e.candidateId}"`);
    }
    seen.add(e.candidateId);
  }

  // Optional cross-check against a strictly-validated candidate list.
  let crossChecked = false;
  let uncoveredCandidateCount: number | null = null;
  const reportWarnings: string[] = [];
  if (input.candidateList !== undefined && input.candidateList !== null) {
    let list: SniperCandidateList;
    try {
      list = validateSniperCandidateList(input.candidateList);
    } catch (err) {
      throw new SniperPreflightInputError(`candidate list is invalid: ${(err as Error).message}`);
    }
    crossChecked = true;
    const mintById = new Map(list.candidates.map((c) => [c.candidateId, c.mint]));
    for (const e of entries) {
      const expected = mintById.get(e.candidateId);
      if (expected === undefined) {
        throw new SniperPreflightInputError(`entry references unknown candidateId "${e.candidateId}" (not in the candidate list)`);
      }
      if (expected !== e.mint) {
        throw new SniperPreflightInputError(
          `entry for candidateId "${e.candidateId}" carries mint ${e.mint} but the candidate list has ${expected}`,
        );
      }
    }
    const uncovered = list.candidates.filter((c) => !seen.has(c.candidateId));
    uncoveredCandidateCount = uncovered.length;
    if (uncovered.length > 0) {
      reportWarnings.push(
        `${uncovered.length} candidate(s) in the list have no preflight input entry: ${uncovered.map((c) => c.candidateId).join(", ")}.`,
      );
    }
  }

  const counts = aggregate(entries);
  if (counts.missingInspectionCount > 0) {
    reportWarnings.push(`${counts.missingInspectionCount} entr${counts.missingInspectionCount === 1 ? "y has" : "ies have"} no usable inspection.`);
  }
  if (counts.missingRiskCount > 0) {
    reportWarnings.push(`${counts.missingRiskCount} entr${counts.missingRiskCount === 1 ? "y has" : "ies have"} no usable risk report.`);
  }
  if (counts.unsupportedShapeCount > 0) {
    reportWarnings.push(`${counts.unsupportedShapeCount} entr${counts.unsupportedShapeCount === 1 ? "y carries" : "ies carry"} an unsupported local shape (treated as absent).`);
  }
  if (counts.mintMismatchCount > 0) {
    reportWarnings.push(`${counts.mintMismatchCount} entr${counts.mintMismatchCount === 1 ? "y carries" : "ies carry"} data for a DIFFERENT mint.`);
  }

  const hasWarnings = reportWarnings.length > 0 || entries.some((e) => e.warnings.length > 0);

  return {
    schemaVersion: SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION,
    banner: SNIPER_PREFLIGHT_INPUT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_PREFLIGHT_INPUT_DISCLAIMERS],
    sourceLabel: optString(input.sourceLabel, "preflight input.sourceLabel"),
    candidateListRef: optString(input.candidateListRef, "preflight input.candidateListRef"),
    crossCheckedAgainstCandidateList: crossChecked,
    entryCount: entries.length,
    entries,
    ...counts,
    uncoveredCandidateCount,
    hasWarnings,
    validationStatus: hasWarnings ? "valid-with-warnings" : "valid",
    warnings: reportWarnings,
    notes: [
      "LOCAL-ONLY input validation — nothing here fetched chain data, and a clean validation verifies no on-chain fact.",
      "Raw inspection/risk values are carried verbatim so this artifact can drive paper:sniper:preflight without loss.",
    ],
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a canonical {@link SniperPreflightInput} and return it narrowed. A
 * backstop mirroring the package's sibling validators: schema/banner/labels/disclaimers, every entry
 * (mint re-parsed; the projected summaries are DERIVED, so they are recomputed from the verbatim raw
 * values and compared), and the recomputed aggregates. Throws {@link SniperPreflightInputError} on the
 * first problem. Pure.
 */
export function validateSniperPreflightInput(value: unknown): SniperPreflightInput {
  if (!isObject(value)) throw new SniperPreflightInputError("preflight input artifact must be a JSON object");
  if (value.schemaVersion !== SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION) {
    throw new SniperPreflightInputError(`preflight input.schemaVersion must be "${SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_PREFLIGHT_INPUT_BANNER) {
    throw new SniperPreflightInputError(`preflight input.banner must be "${SNIPER_PREFLIGHT_INPUT_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperPreflightInputError(`preflight input.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperPreflightInputError("preflight input.disclaimers must be a non-empty array");
  }
  for (const f of ["sourceLabel", "candidateListRef"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperPreflightInputError(`preflight input.${f} must be a string or null`);
    }
  }
  if (typeof value.crossCheckedAgainstCandidateList !== "boolean") {
    throw new SniperPreflightInputError("preflight input.crossCheckedAgainstCandidateList must be a boolean");
  }
  if (!Array.isArray(value.entries)) throw new SniperPreflightInputError("preflight input.entries must be an array");
  if (value.entryCount !== value.entries.length) {
    throw new SniperPreflightInputError("preflight input.entryCount must equal entries.length");
  }

  const seen = new Set<string>();
  (value.entries as unknown[]).forEach((e, i) => {
    const where = `preflight input.entries[${i}]`;
    if (!isObject(e)) throw new SniperPreflightInputError(`${where} must be an object`);
    if (typeof e.candidateId !== "string" || e.candidateId.length === 0) {
      throw new SniperPreflightInputError(`${where}.candidateId must be a non-empty string`);
    }
    if (seen.has(e.candidateId)) throw new SniperPreflightInputError(`${where} duplicates candidateId "${e.candidateId}"`);
    seen.add(e.candidateId);
    let mint: string;
    try {
      mint = parseMintAddress(e.mint);
    } catch (err) {
      throw new SniperPreflightInputError(`${where}: ${(err as Error).message}`);
    }
    if (mint !== e.mint) throw new SniperPreflightInputError(`${where}.mint must be the canonical trimmed form`);
    for (const f of ["inspectionSupplied", "riskSupplied", "unsupportedInspectionShape", "unsupportedRiskShape"] as const) {
      if (typeof e[f] !== "boolean") throw new SniperPreflightInputError(`${where}.${f} must be a boolean`);
    }
    if (!Array.isArray(e.warnings) || (e.warnings as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperPreflightInputError(`${where}.warnings must be an array of strings`);
    }
    if (e.sourceLabel !== null && typeof e.sourceLabel !== "string") {
      throw new SniperPreflightInputError(`${where}.sourceLabel must be a string or null`);
    }
    // The summaries are DERIVED from the verbatim raw values — recompute and compare.
    const expectedInspection = e.inspectionSupplied ? projectSniperPreflightInspection(e.inspection, mint) : null;
    const expectedRisk = e.riskSupplied ? projectSniperPreflightRisk(e.risk, mint) : null;
    if (JSON.stringify(e.inspectionSummary) !== JSON.stringify(expectedInspection)) {
      throw new SniperPreflightInputError(`${where}.inspectionSummary must equal the projection of the verbatim inspection`);
    }
    if (JSON.stringify(e.riskSummary) !== JSON.stringify(expectedRisk)) {
      throw new SniperPreflightInputError(`${where}.riskSummary must equal the projection of the verbatim risk`);
    }
    if (e.inspectionSupplied !== (e.inspection !== null && e.inspection !== undefined)) {
      throw new SniperPreflightInputError(`${where}.inspectionSupplied must mirror the verbatim inspection`);
    }
    if (e.riskSupplied !== (e.risk !== null && e.risk !== undefined)) {
      throw new SniperPreflightInputError(`${where}.riskSupplied must mirror the verbatim risk`);
    }
  });

  // Aggregates are DERIVED — recompute and compare.
  const expected = aggregate(value.entries as SniperPreflightInputEntry[]);
  for (const f of ["missingInspectionCount", "missingRiskCount", "unsupportedShapeCount", "mintMismatchCount"] as const) {
    if (value[f] !== expected[f]) {
      throw new SniperPreflightInputError(`preflight input.${f} must equal the recomputed value (${expected[f]})`);
    }
  }
  if (value.uncoveredCandidateCount !== null && (typeof value.uncoveredCandidateCount !== "number" || !Number.isInteger(value.uncoveredCandidateCount) || value.uncoveredCandidateCount < 0)) {
    throw new SniperPreflightInputError("preflight input.uncoveredCandidateCount must be a non-negative integer or null");
  }
  if (value.crossCheckedAgainstCandidateList === false && value.uncoveredCandidateCount !== null) {
    throw new SniperPreflightInputError("preflight input.uncoveredCandidateCount must be null when no candidate list was cross-checked");
  }
  if (typeof value.hasWarnings !== "boolean") throw new SniperPreflightInputError("preflight input.hasWarnings must be a boolean");
  if (value.validationStatus !== "valid" && value.validationStatus !== "valid-with-warnings") {
    throw new SniperPreflightInputError('preflight input.validationStatus must be "valid" | "valid-with-warnings"');
  }
  if ((value.validationStatus === "valid") === (value.hasWarnings as boolean)) {
    throw new SniperPreflightInputError("preflight input.validationStatus must mirror hasWarnings");
  }
  for (const key of ["warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperPreflightInputError(`preflight input.${key} must be an array of strings`);
    }
  }
  const anyWarning =
    (value.warnings as string[]).length > 0 ||
    (value.entries as SniperPreflightInputEntry[]).some((e) => e.warnings.length > 0);
  if (value.hasWarnings !== anyWarning) {
    throw new SniperPreflightInputError("preflight input.hasWarnings must mirror the presence of warnings");
  }
  return value as unknown as SniperPreflightInput;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperPreflightInput}. */
export interface FormatSniperPreflightInputOptions {
  label?: string;
  /** Cap on the number of entry rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable preflight input summary. Deterministic and path-stable.
 * Leads with the PAPER-ONLY banner and the coverage counts, lists each entry's
 * inspection/risk availability + warnings, and closes with the LOCAL-ONLY disclaimers. The whole
 * output is passed through the shared redactor.
 */
export function formatSniperPreflightInput(
  artifact: SniperPreflightInput,
  opts: FormatSniperPreflightInputOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${artifact.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:        ${opts.label}`);
  lines.push(`source:       ${artifact.sourceLabel ?? "(none)"}`);
  lines.push(`candidates:   ${artifact.candidateListRef ?? "(no list reference)"}`);
  lines.push(`cross-check:  ${artifact.crossCheckedAgainstCandidateList ? `done${artifact.uncoveredCandidateCount !== null ? ` (${artifact.uncoveredCandidateCount} candidate(s) uncovered)` : ""}` : "(no candidate list supplied)"}`);
  lines.push(`entries:      ${artifact.entryCount}`);
  lines.push(`status:       ${artifact.validationStatus}`);

  lines.push("");
  lines.push("Coverage:");
  lines.push(`- missing inspection: ${artifact.missingInspectionCount}`);
  lines.push(`- missing risk:       ${artifact.missingRiskCount}`);
  lines.push(`- unsupported shapes: ${artifact.unsupportedShapeCount}`);
  lines.push(`- mint mismatches:    ${artifact.mintMismatchCount}`);

  lines.push("");
  lines.push("Entries:");
  if (artifact.entries.length === 0) {
    lines.push("- (none)");
  } else {
    for (const e of artifact.entries.slice(0, maxRows)) {
      const insp = e.inspectionSummary ? "inspection ✓" : e.unsupportedInspectionShape ? "inspection ✗ (unsupported shape)" : "inspection —";
      const risk = e.riskSummary ? "risk ✓" : e.unsupportedRiskShape ? "risk ✗ (unsupported shape)" : "risk —";
      lines.push(`- ${e.candidateId}  ${e.mint}  [${insp} | ${risk}]`);
      for (const w of e.warnings) lines.push(`    · ${w}`);
    }
    const hidden = artifact.entries.length - Math.min(artifact.entries.length, maxRows);
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the artifact JSON for the full set)`);
  }

  if (artifact.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of artifact.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of artifact.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of artifact.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
