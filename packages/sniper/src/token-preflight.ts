/**
 * Deterministic, offline, **PAPER-only** SNIPER TOKEN PREFLIGHT REPORT (Phase 5+).
 *
 * The candidate intake layer ({@link normalizeSniperCandidateList}) gives a validated list of mints.
 * The preflight is the next safety gate: for each candidate it combines (1) the mint's public-key
 * validity, (2) an ALREADY-LOADED read-only on-chain inspection (mint/freeze authorities, decimals,
 * supply, program), and (3) an ALREADY-LOADED advisory risk report, into a single per-candidate
 * status — `pass` / `warn` / `fail` / `unknown` — with explicit warnings and disqualifying reasons.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work of its own. The inspection and
 * risk inputs are parsed values the CLI loaded from LOCAL files (e.g. the output of `token:inspect` and
 * `token:risk`); this builder validates/projects them defensively and NEVER fetches anything. The
 * package carries no chain capability (no `@solana/web3.js`, no `@soulmaker/solana`); the inspection
 * input is read as plain public-data fields.
 *
 * This is a safety / research PREFLIGHT — **NOT a trade signal**, not a buy/sell recommendation, not a
 * verified-safe guarantee, and not a profitability claim. A `pass` means "no preflight concern was
 * found in the supplied data", never "safe to trade". Nothing here holds a key or builds/signs/sends a
 * transaction. It carries no wall-clock time, so the same inputs yield a byte-identical report.
 */

import { redactString } from "@soulmaker/security";
import type { RiskDecision, RiskSeverity } from "@soulmaker/risk";
import { isValidMintAddress } from "./mint-address.js";
import { validateSniperCandidateList, type SniperCandidateList } from "./candidate-list.js";

/** Stable schema identifier for the preflight report. Bump only on a breaking change. */
export const SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION = "sniper.token.preflight.report.v1";

/** The banner that prefixes every preflight report (required label). */
export const SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER = "SIMULATED PAPER-ONLY SNIPER TOKEN PREFLIGHT";

/** Required disclaimer statements carried by every preflight report (stable order). */
export const SNIPER_TOKEN_PREFLIGHT_REPORT_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER TOKEN PREFLIGHT — a deterministic safety/research summary over a candidate list and already-loaded read-only inspection + advisory risk data.",
  "It performs NO on-chain reads itself: the inspection + risk inputs were loaded from LOCAL files (e.g. token:inspect / token:risk output) and are validated/projected here, never fetched.",
  "A `pass` means no preflight concern was found in the supplied data — it is NOT a 'safe to trade' judgment, NOT a buy/sell signal, and NOT a profitability claim.",
  "`unknown` means there was no inspection and no risk data for that candidate — the preflight could not assess it.",
  "Advisory risk decisions/flags are read VERBATIM from the supplied risk report; they are read-only and never a trade recommendation.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown when preflight INPUT or a produced report is structurally invalid. */
export class SniperTokenPreflightReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperTokenPreflightReportError";
  }
}

// --- input -------------------------------------------------------------------

/** One candidate's already-loaded preflight data (parsed from local files by the CLI). */
export interface SniperPreflightCandidateData {
  /** The candidateId this data belongs to (must match a candidate in the list). */
  candidateId: string;
  /** A parsed read-only mint inspection (TokenMintInfo-like). Validated/projected defensively. */
  inspection?: unknown;
  /** A parsed advisory risk report (TokenRiskReport-like). Validated/projected defensively. */
  risk?: unknown;
}

/** Everything {@link buildSniperTokenPreflightReport} needs. */
export interface BuildSniperTokenPreflightReportInput {
  /** The candidate list (a canonical `sniper.candidate.list.v1`; strictly validated). */
  candidateList: unknown;
  /** Per-candidate already-loaded inspection/risk data (optional per candidate). */
  candidateData?: SniperPreflightCandidateData[];
}

// --- report model ------------------------------------------------------------

/** Preflight status for one candidate. */
export type SniperPreflightStatus = "pass" | "warn" | "fail" | "unknown";

/** The projected, validated read-only inspection summary for one candidate. */
export interface SniperPreflightInspection {
  present: true;
  mintMatches: boolean;
  decimals: number | null;
  mintAuthorityPresent: boolean | null;
  freezeAuthorityPresent: boolean | null;
  isInitialized: boolean | null;
  programLabel: string | null;
}

/** The projected, validated advisory risk summary for one candidate. */
export interface SniperPreflightRisk {
  present: true;
  mintMatches: boolean;
  score: number | null;
  decision: RiskDecision | null;
  flagCount: number;
  criticalFlagCount: number;
  highFlagCount: number;
  /** A capped list of the most-severe flags (id/severity/title), severity-ordered. */
  topFlags: { id: string; severity: RiskSeverity; title: string }[];
}

/** One candidate's preflight entry. */
export interface SniperPreflightEntry {
  candidateId: string;
  mint: string;
  mintValid: boolean;
  inspection: SniperPreflightInspection | null;
  risk: SniperPreflightRisk | null;
  warnings: string[];
  disqualifiers: string[];
  status: SniperPreflightStatus;
}

/** The full, deterministic, JSON-serializable preflight report. */
export interface SniperTokenPreflightReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  sourceLabel: string | null;
  candidateCount: number;
  candidates: SniperPreflightEntry[];
  // --- aggregate counts ---
  passCount: number;
  warnCount: number;
  failCount: number;
  unknownCount: number;
  /** Candidates with neither inspection nor risk data supplied. */
  missingDataCount: number;
  // --- conservative flags ---
  hasFail: boolean;
  hasWarn: boolean;
  hasUnknown: boolean;
  // --- CI decision section ---
  wouldFailOnFail: boolean;
  wouldFailOnWarning: boolean;
  ciFailReasons: string[];
  warnings: string[];
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function boolOrNull(value: unknown): boolean | null {
  return value === true ? true : value === false ? false : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const RISK_DECISIONS: ReadonlySet<string> = new Set(["REJECT", "CAUTION", "PASS_FOR_PAPER_EVALUATION"]);
const RISK_SEVERITIES: ReadonlySet<string> = new Set(["info", "low", "medium", "high", "critical"]);
const SEVERITY_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

/** Cap on the number of flags echoed per candidate (concise; the risk JSON holds the full list). */
const MAX_TOP_FLAGS = 5;

/** Project a parsed inspection value into a validated summary (or null if not an object). */
function projectInspection(value: unknown, mint: string): SniperPreflightInspection | null {
  if (!isObject(value)) return null;
  const inspMint = typeof value.mint === "string" ? value.mint.trim() : null;
  return {
    present: true,
    mintMatches: inspMint === mint,
    decimals: finiteNumberOrNull(value.decimals),
    mintAuthorityPresent: boolOrNull(value.mintAuthorityPresent),
    freezeAuthorityPresent: boolOrNull(value.freezeAuthorityPresent),
    isInitialized: boolOrNull(value.isInitialized),
    programLabel: nonEmptyString(value.programLabel) ? value.programLabel : null,
  };
}

/** Project a parsed risk value into a validated summary (or null if not an object). */
function projectRisk(value: unknown, mint: string): SniperPreflightRisk | null {
  if (!isObject(value)) return null;
  const riskMint = typeof value.mint === "string" ? value.mint.trim() : null;
  const decision = typeof value.decision === "string" && RISK_DECISIONS.has(value.decision)
    ? (value.decision as RiskDecision)
    : null;
  const rawFlags = Array.isArray(value.flags) ? value.flags : [];
  const flags = rawFlags
    .filter(isObject)
    .map((f) => ({
      id: nonEmptyString(f.id) ? f.id : "(unknown)",
      severity: typeof f.severity === "string" && RISK_SEVERITIES.has(f.severity) ? (f.severity as RiskSeverity) : ("info" as RiskSeverity),
      title: nonEmptyString(f.title) ? f.title : "(untitled)",
    }));
  const sorted = [...flags].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  return {
    present: true,
    mintMatches: riskMint === mint,
    score: finiteNumberOrNull(value.score),
    decision,
    flagCount: flags.length,
    criticalFlagCount: flags.filter((f) => f.severity === "critical").length,
    highFlagCount: flags.filter((f) => f.severity === "high").length,
    topFlags: sorted.slice(0, MAX_TOP_FLAGS),
  };
}

/** Compute a candidate's preflight entry (status + warnings + disqualifiers). Conservative + honest. */
function buildEntry(
  candidateId: string,
  mint: string,
  data: SniperPreflightCandidateData | undefined,
): SniperPreflightEntry {
  const mintValid = isValidMintAddress(mint);
  const inspection = data?.inspection !== undefined ? projectInspection(data.inspection, mint) : null;
  const risk = data?.risk !== undefined ? projectRisk(data.risk, mint) : null;

  const warnings: string[] = [];
  const disqualifiers: string[] = [];

  if (!mintValid) {
    disqualifiers.push("mint is not a valid 32-byte Solana public key");
  }
  if (inspection && !inspection.mintMatches) {
    warnings.push("supplied inspection is for a different mint than the candidate");
  }
  if (risk && !risk.mintMatches) {
    warnings.push("supplied risk report is for a different mint than the candidate");
  }

  // Risk decision: REJECT is a hard preflight FAIL; CAUTION is a warn.
  if (risk?.decision === "REJECT") {
    disqualifiers.push("advisory risk decision is REJECT");
  } else if (risk?.decision === "CAUTION") {
    warnings.push("advisory risk decision is CAUTION");
  }
  if (risk && risk.criticalFlagCount > 0) {
    disqualifiers.push(`${risk.criticalFlagCount} critical risk flag(s)`);
  }
  if (risk && risk.highFlagCount > 0) {
    warnings.push(`${risk.highFlagCount} high-severity risk flag(s)`);
  }

  // Inspection authorities: freeze authority (can't sell) is the most serious; mint authority is dilution.
  if (inspection?.freezeAuthorityPresent === true) {
    warnings.push("freeze authority present (the token can be frozen — you may not be able to sell)");
  }
  if (inspection?.mintAuthorityPresent === true) {
    warnings.push("mint authority present (more tokens can be minted — dilution/rug risk)");
  }
  if (inspection?.isInitialized === false) {
    warnings.push("mint is not initialized");
  }

  let status: SniperPreflightStatus;
  if (disqualifiers.length > 0) {
    status = "fail";
  } else if (!inspection && !risk) {
    status = "unknown";
  } else if (warnings.length > 0) {
    status = "warn";
  } else {
    status = "pass";
  }

  return { candidateId, mint, mintValid, inspection, risk, warnings, disqualifiers, status };
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperTokenPreflightReport} from a validated candidate list and a set of
 * already-loaded per-candidate inspection/risk data. Pure and non-mutating. The candidate list is
 * STRICTLY validated (a non-list / wrong-schema input throws
 * {@link SniperTokenPreflightReportError}); the per-candidate data is validated/projected defensively
 * (a malformed inspection/risk value is treated as absent for that field). Each candidate gets a
 * conservative status: `fail` (a disqualifier — invalid mint, risk REJECT, or a critical risk flag),
 * `warn` (a softer concern — CAUTION, a high flag, freeze/mint authority), `unknown` (no inspection
 * AND no risk data), or `pass` (data present, no concern found). Carries no wall-clock time.
 */
export function buildSniperTokenPreflightReport(
  input: BuildSniperTokenPreflightReportInput,
): SniperTokenPreflightReport {
  if (!isObject(input)) {
    throw new SniperTokenPreflightReportError("preflight input must be an object");
  }
  let list: SniperCandidateList;
  try {
    list = validateSniperCandidateList(input.candidateList);
  } catch (err) {
    throw new SniperTokenPreflightReportError(`candidate list is invalid: ${(err as Error).message}`);
  }
  if (input.candidateData !== undefined && !Array.isArray(input.candidateData)) {
    throw new SniperTokenPreflightReportError("preflight input.candidateData must be an array when present");
  }

  // Index the supplied data by candidateId; a duplicate candidateId in the data is refused.
  const dataById = new Map<string, SniperPreflightCandidateData>();
  for (const d of input.candidateData ?? []) {
    if (!isObject(d) || !nonEmptyString(d.candidateId)) {
      throw new SniperTokenPreflightReportError("each candidateData entry must have a non-empty candidateId");
    }
    if (dataById.has(d.candidateId)) {
      throw new SniperTokenPreflightReportError(`duplicate candidateData for candidateId "${d.candidateId}"`);
    }
    dataById.set(d.candidateId, d);
  }
  // A data entry whose candidateId is not in the list is a hard error (operator pointed at the wrong list).
  const listIds = new Set(list.candidates.map((c) => c.candidateId));
  for (const id of dataById.keys()) {
    if (!listIds.has(id)) {
      throw new SniperTokenPreflightReportError(`candidateData references unknown candidateId "${id}"`);
    }
  }

  const candidates = list.candidates.map((c) => buildEntry(c.candidateId, c.mint, dataById.get(c.candidateId)));

  const passCount = candidates.filter((e) => e.status === "pass").length;
  const warnCount = candidates.filter((e) => e.status === "warn").length;
  const failCount = candidates.filter((e) => e.status === "fail").length;
  const unknownCount = candidates.filter((e) => e.status === "unknown").length;
  const missingDataCount = candidates.filter((e) => e.inspection === null && e.risk === null).length;

  const hasFail = failCount > 0;
  const hasWarn = warnCount > 0;
  const hasUnknown = unknownCount > 0;

  const ciFailReasons: string[] = [];
  if (hasFail) {
    ciFailReasons.push(`${failCount} candidate(s) failed preflight: ${candidates.filter((e) => e.status === "fail").map((e) => e.candidateId).join(", ")}`);
  }
  if (hasWarn) {
    ciFailReasons.push(`${warnCount} candidate(s) have a preflight warning`);
  }

  const warnings: string[] = [];
  if (missingDataCount > 0) {
    warnings.push(`${missingDataCount} candidate(s) had no inspection or risk data (status unknown).`);
  }
  if (hasFail) {
    warnings.push(`${failCount} candidate(s) failed preflight.`);
  }

  const notes = [
    `${candidates.length} candidate(s): ${passCount} pass, ${warnCount} warn, ${failCount} fail, ${unknownCount} unknown.`,
    "A pass means no preflight concern was found in the supplied LOCAL data — it is NOT a 'safe to trade' judgment and NOT a trade signal.",
  ];

  return {
    schemaVersion: SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION,
    banner: SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_TOKEN_PREFLIGHT_REPORT_DISCLAIMERS],
    sourceLabel: list.sourceLabel,
    candidateCount: candidates.length,
    candidates,
    passCount,
    warnCount,
    failCount,
    unknownCount,
    missingDataCount,
    hasFail,
    hasWarn,
    hasUnknown,
    wouldFailOnFail: hasFail,
    wouldFailOnWarning: hasWarn,
    ciFailReasons,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const PREFLIGHT_STATUSES: ReadonlySet<string> = new Set(["pass", "warn", "fail", "unknown"]);

function validateEntry(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperTokenPreflightReportError(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) throw new SniperTokenPreflightReportError(`${where}.candidateId must be a non-empty string`);
  if (!nonEmptyString(value.mint)) throw new SniperTokenPreflightReportError(`${where}.mint must be a non-empty string`);
  if (typeof value.mintValid !== "boolean") throw new SniperTokenPreflightReportError(`${where}.mintValid must be a boolean`);
  if (typeof value.status !== "string" || !PREFLIGHT_STATUSES.has(value.status)) {
    throw new SniperTokenPreflightReportError(`${where}.status must be pass|warn|fail|unknown`);
  }
  for (const f of ["warnings", "disqualifiers"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperTokenPreflightReportError(`${where}.${f} must be an array of strings`);
    }
  }
  if (value.inspection !== null && !isObject(value.inspection)) {
    throw new SniperTokenPreflightReportError(`${where}.inspection must be an object or null`);
  }
  if (value.risk !== null && !isObject(value.risk)) {
    throw new SniperTokenPreflightReportError(`${where}.risk must be an object or null`);
  }
  // Internal consistency: a disqualifier ⟺ fail; no data ⟺ (unknown or fail).
  if ((value.disqualifiers as unknown[]).length > 0 && value.status !== "fail") {
    throw new SniperTokenPreflightReportError(`${where}: a disqualifier requires status "fail"`);
  }
}

/**
 * Strictly validate a value as a {@link SniperTokenPreflightReport} and return it narrowed. A backstop
 * mirroring the package's sibling validators: checks the schema version + banner, the PAPER-ONLY
 * labelling, the disclaimers, every entry, the aggregate counts, the conservative flags, and the CI
 * mirror. Throws {@link SniperTokenPreflightReportError} on the first problem. Pure.
 */
export function validateSniperTokenPreflightReport(value: unknown): SniperTokenPreflightReport {
  if (!isObject(value)) throw new SniperTokenPreflightReportError("preflight report must be a JSON object");
  if (value.schemaVersion !== SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION) {
    throw new SniperTokenPreflightReportError(
      `preflight report.schemaVersion must be "${SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER) {
    throw new SniperTokenPreflightReportError(`preflight report.banner must be "${SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperTokenPreflightReportError(`preflight report.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperTokenPreflightReportError("preflight report.disclaimers must be a non-empty array");
  }
  if (value.sourceLabel !== null && typeof value.sourceLabel !== "string") {
    throw new SniperTokenPreflightReportError("preflight report.sourceLabel must be a string or null");
  }
  for (const f of ["candidateCount", "passCount", "warnCount", "failCount", "unknownCount", "missingDataCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new SniperTokenPreflightReportError(`preflight report.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["hasFail", "hasWarn", "hasUnknown", "wouldFailOnFail", "wouldFailOnWarning"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperTokenPreflightReportError(`preflight report.${f} must be a boolean`);
  }
  if (value.wouldFailOnFail !== value.hasFail) throw new SniperTokenPreflightReportError("preflight report.wouldFailOnFail must mirror hasFail");
  if (value.wouldFailOnWarning !== value.hasWarn) throw new SniperTokenPreflightReportError("preflight report.wouldFailOnWarning must mirror hasWarn");
  for (const key of ["ciFailReasons", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperTokenPreflightReportError(`preflight report.${key} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.candidates)) throw new SniperTokenPreflightReportError("preflight report.candidates must be an array");
  if ((value.candidates as unknown[]).length !== value.candidateCount) {
    throw new SniperTokenPreflightReportError("preflight report.candidates length must equal candidateCount");
  }
  (value.candidates as unknown[]).forEach((e, i) => validateEntry(e, `preflight report.candidates[${i}]`));
  return value as unknown as SniperTokenPreflightReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperTokenPreflightReport}. */
export interface FormatSniperTokenPreflightReportOptions {
  label?: string;
  /** Cap on the number of candidate rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable preflight report. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the pass/warn/fail/unknown tally, lists each
 * candidate's status with its warnings + disqualifiers, and closes with the CI verdict and the
 * not-a-trade-signal disclaimers. The whole output is passed through the shared redactor.
 */
export function formatSniperTokenPreflightReport(
  report: SniperTokenPreflightReport,
  opts: FormatSniperTokenPreflightReportOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${report.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`source:     ${report.sourceLabel ?? "(none)"}`);
  lines.push(
    `candidates: ${report.candidateCount} (${report.passCount} pass / ${report.warnCount} warn / ${report.failCount} fail / ${report.unknownCount} unknown)`,
  );

  lines.push("");
  lines.push("Preflight:");
  if (report.candidates.length === 0) {
    lines.push("- (none)");
  } else {
    for (const e of report.candidates.slice(0, maxRows)) {
      lines.push(`- [${e.status.toUpperCase()}] ${e.candidateId}  ${e.mint}`);
      for (const d of e.disqualifiers) lines.push(`    ✗ ${d}`);
      for (const w of e.warnings) lines.push(`    ! ${w}`);
      if (e.risk) lines.push(`    risk: ${e.risk.decision ?? "(none)"}${e.risk.score !== null ? ` (score ${e.risk.score})` : ""}, ${e.risk.flagCount} flag(s)`);
      if (e.inspection) {
        const auth: string[] = [];
        if (e.inspection.mintAuthorityPresent === true) auth.push("mint-authority");
        if (e.inspection.freezeAuthorityPresent === true) auth.push("freeze-authority");
        lines.push(`    inspection: ${auth.length > 0 ? auth.join(", ") : "no mint/freeze authority"}`);
      }
    }
    const hidden = report.candidates.length - Math.min(report.candidates.length, maxRows);
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the report JSON for the full set)`);
  }

  lines.push("");
  lines.push(`Any failure:  ${report.hasFail ? "YES" : "no"}`);
  lines.push(`Any warning:  ${report.hasWarn ? "YES" : "no"}`);
  lines.push(`Any unknown:  ${report.hasUnknown ? "YES" : "no"}`);
  if (report.ciFailReasons.length > 0) {
    lines.push("CI gate reasons:");
    for (const r of report.ciFailReasons) lines.push(`- ${r}`);
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of report.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
