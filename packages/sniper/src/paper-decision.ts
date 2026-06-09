/**
 * Deterministic, offline, **PAPER-only** SNIPER DECISION REPORT (Phase 5+).
 *
 * This is the first real sniper-bot-shaped step: it folds a validated candidate list, an (optional)
 * token preflight report, and a small set of deterministic operator RULES into a per-candidate
 * **simulated** decision — `skip` / `watch` / `paper-enter` / `paper-reject` / `unknown` — with the
 * reasons, the blocking risk flags, the rules applied, and the assumptions used.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work. It consumes the ALREADY-BUILT
 * preflight (which itself consumed read-only inspection + advisory risk); this layer never re-derives
 * risk or reads the chain. The package carries no chain capability.
 *
 * A `paper-enter` is a **simulated, paper-only** decision — it is NOT a buy/sell order, NOT a
 * transaction, and NOT live readiness. Nothing here builds, signs, simulates, or sends a transaction
 * or holds a key. It carries no wall-clock time, so the same inputs yield a byte-identical report.
 *
 * The five decisions (conservative; a candidate only reaches `paper-enter` when EVERY deterministic
 * criterion passes):
 *   - `skip`         — structurally excluded before evaluation (operator denylist, or an invalid mint).
 *   - `paper-reject` — evaluated and hard-rejected: the preflight FAILED, or a risk score exceeds the
 *                      rule cap. A reject is an integrity/risk decision, never a sell order.
 *   - `watch`        — a soft hold: the preflight WARNED, the preflight could not assess it (unknown),
 *                      no preflight data was supplied, or observed liquidity is below the rule floor.
 *                      Watch = "keep observing / gather more before any paper entry".
 *   - `paper-enter`  — the preflight PASSED and every entry rule is satisfied. Simulated only.
 *   - `unknown`      — a defensive fallback for an unrecognized preflight status.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperCandidateList, type SniperCandidateList, type SniperCandidate } from "./candidate-list.js";
import {
  validateSniperTokenPreflightReport,
  type SniperTokenPreflightReport,
  type SniperPreflightEntry,
} from "./token-preflight.js";

/** Stable schema identifier for the decision report. Bump only on a breaking change. */
export const SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION = "sniper.paper.decision.report.v1";

/** The banner that prefixes every decision report (required label). */
export const SNIPER_PAPER_DECISION_REPORT_BANNER = "SIMULATED PAPER-ONLY SNIPER DECISION REPORT";

/** Required disclaimer statements carried by every decision report (stable order). */
export const SNIPER_PAPER_DECISION_REPORT_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER DECISION REPORT — deterministic per-candidate simulated decisions over a candidate list, an optional preflight, and operator rules.",
  "A `paper-enter` is a SIMULATED, paper-only decision — it is NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "Decisions are computed from the ALREADY-BUILT preflight + operator rules; this layer performs no on-chain reads and re-derives no risk.",
  "Conservative: a candidate reaches `paper-enter` only when the preflight PASSED and every deterministic entry rule is satisfied.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown when decision INPUT or a produced report is structurally invalid. */
export class PaperSniperDecisionReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperSniperDecisionReportError";
  }
}

// --- rules (deterministic operator entry rules) ------------------------------

/** Deterministic operator rules. All optional; resolved defaults are echoed into the report. */
export interface SniperDecisionRules {
  /** Only `paper-enter` when the preflight status is `pass` (default true). */
  requirePreflightPass?: boolean;
  /** Reject (paper-reject) when a supplied risk score exceeds this (default null = no cap). */
  maxRiskScore?: number | null;
  /** Watch when observed liquidity is null or below this USD floor (default null = no floor). */
  minObservedLiquidityUsd?: number | null;
  /** Operator denylist of mints to `skip` outright (default []). */
  denyMints?: string[];
}

/** The rules actually applied, with defaults resolved (echoed for transparency). */
export interface ResolvedSniperDecisionRules {
  requirePreflightPass: boolean;
  maxRiskScore: number | null;
  minObservedLiquidityUsd: number | null;
  denyMints: string[];
}

// --- input -------------------------------------------------------------------

/** Everything {@link buildPaperSniperDecisionReport} needs. */
export interface BuildPaperSniperDecisionReportInput {
  /** The candidate list (a canonical `sniper.candidate.list.v1`; strictly validated). */
  candidateList: unknown;
  /** An optional token preflight report (`sniper.token.preflight.report.v1`; strictly validated). */
  preflight?: unknown;
  /** Optional deterministic operator rules. */
  rules?: SniperDecisionRules;
}

// --- report model ------------------------------------------------------------

/** The simulated, paper-only decision for one candidate. */
export type SniperDecision = "skip" | "watch" | "paper-enter" | "paper-reject" | "unknown";

/** One candidate's decision entry. */
export interface SniperDecisionEntry {
  candidateId: string;
  mint: string;
  decision: SniperDecision;
  /** The preflight status this decision was based on (null when no preflight was supplied). */
  preflightStatus: string | null;
  /** Concise, deterministic reasons for the decision. */
  reasons: string[];
  /** Risk flags (id/severity/title) that contributed to a reject (empty otherwise). */
  blockingRiskFlags: { id: string; severity: string; title: string }[];
  /** Which operator rules were evaluated/triggered for this candidate. */
  appliedRules: string[];
  /** Assumptions made (e.g. "no risk data supplied"). */
  assumptions: string[];
}

/** The full, deterministic, JSON-serializable decision report. */
export interface SniperPaperDecisionReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  sourceLabel: string | null;
  /** Whether a preflight report was supplied (decisions without it are conservative). */
  hasPreflight: boolean;
  /** The resolved rules actually applied (assumptions, made explicit). */
  rules: ResolvedSniperDecisionRules;
  candidateCount: number;
  decisions: SniperDecisionEntry[];
  // --- aggregate counts ---
  skipCount: number;
  watchCount: number;
  paperEnterCount: number;
  paperRejectCount: number;
  unknownCount: number;
  // --- conservative flags ---
  hasPaperEnter: boolean;
  hasPaperReject: boolean;
  /** True iff at least one candidate was rejected specifically because of risk (score/REJECT/critical). */
  hasRiskReject: boolean;
  // --- CI decision section ---
  wouldFailOnPaperEnter: boolean;
  wouldFailOnRisk: boolean;
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

function resolveRules(rules: SniperDecisionRules | undefined): ResolvedSniperDecisionRules {
  if (rules !== undefined && !isObject(rules)) {
    throw new PaperSniperDecisionReportError("decision rules must be an object when present");
  }
  const r = rules ?? {};
  if (r.requirePreflightPass !== undefined && typeof r.requirePreflightPass !== "boolean") {
    throw new PaperSniperDecisionReportError("rules.requirePreflightPass must be a boolean when present");
  }
  const num = (name: keyof SniperDecisionRules): number | null => {
    const v = r[name];
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new PaperSniperDecisionReportError(`rules.${String(name)} must be a non-negative finite number when present`);
    }
    return v;
  };
  let denyMints: string[] = [];
  if (r.denyMints !== undefined) {
    if (!Array.isArray(r.denyMints) || r.denyMints.some((m) => typeof m !== "string")) {
      throw new PaperSniperDecisionReportError("rules.denyMints must be an array of strings when present");
    }
    denyMints = [...new Set(r.denyMints.map((m) => m.trim()).filter((m) => m.length > 0))].sort();
  }
  return {
    requirePreflightPass: r.requirePreflightPass ?? true,
    maxRiskScore: num("maxRiskScore"),
    minObservedLiquidityUsd: num("minObservedLiquidityUsd"),
    denyMints,
  };
}

/** Compute one candidate's decision. Conservative + deterministic; reasons explain every branch. */
function decide(
  candidate: SniperCandidate,
  preflight: SniperPreflightEntry | undefined,
  hasPreflight: boolean,
  rules: ResolvedSniperDecisionRules,
): SniperDecisionEntry {
  const reasons: string[] = [];
  const appliedRules: string[] = [];
  const assumptions: string[] = [];
  let blockingRiskFlags: { id: string; severity: string; title: string }[] = [];

  const base = {
    candidateId: candidate.candidateId,
    mint: candidate.mint,
    preflightStatus: preflight ? preflight.status : null,
  };

  // 1) Structural skips (before any evaluation).
  if (rules.denyMints.includes(candidate.mint)) {
    appliedRules.push("denyMints");
    reasons.push("mint is on the operator denylist");
    return { ...base, decision: "skip", reasons, blockingRiskFlags, appliedRules, assumptions };
  }
  if (!preflight?.mintValid && preflight) {
    reasons.push("mint failed validation in the preflight");
    return { ...base, decision: "skip", reasons, blockingRiskFlags, appliedRules, assumptions };
  }

  // 2) No preflight data → conservative watch (gather data first).
  if (!preflight) {
    if (hasPreflight) {
      assumptions.push("the supplied preflight report had no entry for this candidate");
    } else {
      assumptions.push("no preflight report was supplied");
    }
    reasons.push("no preflight data — run paper:sniper:preflight before any paper entry");
    return { ...base, decision: "watch", reasons, blockingRiskFlags, appliedRules, assumptions };
  }

  // 3) Hard rejects.
  if (preflight.status === "fail") {
    reasons.push(...(preflight.disqualifiers.length > 0 ? preflight.disqualifiers : ["preflight failed"]));
    if (preflight.risk) blockingRiskFlags = preflight.risk.topFlags;
    return { ...base, decision: "paper-reject", reasons, blockingRiskFlags, appliedRules, assumptions };
  }
  if (rules.maxRiskScore !== null) {
    appliedRules.push("maxRiskScore");
    const score = preflight.risk?.score ?? null;
    if (score !== null && score > rules.maxRiskScore) {
      reasons.push(`risk score ${score} exceeds the max ${rules.maxRiskScore}`);
      if (preflight.risk) blockingRiskFlags = preflight.risk.topFlags;
      return { ...base, decision: "paper-reject", reasons, blockingRiskFlags, appliedRules, assumptions };
    }
    if (score === null) assumptions.push("no risk score supplied — maxRiskScore rule could not be applied");
  }

  // 4) Soft holds.
  if (preflight.status === "unknown") {
    reasons.push("preflight could not assess this candidate (no inspection/risk data)");
    return { ...base, decision: "watch", reasons, blockingRiskFlags, appliedRules, assumptions };
  }
  if (preflight.status === "warn") {
    reasons.push(...(preflight.warnings.length > 0 ? preflight.warnings : ["preflight warned"]));
    return { ...base, decision: "watch", reasons, blockingRiskFlags, appliedRules, assumptions };
  }

  // 5) status === "pass": apply entry rules.
  if (preflight.status === "pass") {
    if (rules.requirePreflightPass) appliedRules.push("requirePreflightPass");
    if (rules.minObservedLiquidityUsd !== null) {
      appliedRules.push("minObservedLiquidityUsd");
      const liq = candidate.observedLiquidityUsd;
      if (liq === null) {
        assumptions.push("no observed liquidity supplied");
        reasons.push(`no observed liquidity (min required ${rules.minObservedLiquidityUsd})`);
        return { ...base, decision: "watch", reasons, blockingRiskFlags, appliedRules, assumptions };
      }
      if (liq < rules.minObservedLiquidityUsd) {
        reasons.push(`observed liquidity ${liq} is below the min ${rules.minObservedLiquidityUsd}`);
        return { ...base, decision: "watch", reasons, blockingRiskFlags, appliedRules, assumptions };
      }
    }
    if (preflight.risk?.decision === "PASS_FOR_PAPER_EVALUATION") {
      reasons.push("risk decision PASS_FOR_PAPER_EVALUATION");
    } else if (!preflight.risk) {
      assumptions.push("no risk report supplied — relying on the clean inspection only");
    }
    reasons.push("preflight pass and all deterministic entry rules satisfied (SIMULATED paper entry only)");
    return { ...base, decision: "paper-enter", reasons, blockingRiskFlags, appliedRules, assumptions };
  }

  // 6) Defensive fallback.
  reasons.push(`unrecognized preflight status "${preflight.status}"`);
  return { ...base, decision: "unknown", reasons, blockingRiskFlags, appliedRules, assumptions };
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperPaperDecisionReport}. Pure and non-mutating. The candidate list is
 * STRICTLY validated; the preflight, if supplied, is STRICTLY validated and must cover the same
 * candidate ids (an extra preflight entry not in the list is refused). Every candidate gets one of
 * five conservative decisions with explicit reasons, blocking risk flags, applied rules, and
 * assumptions. A `paper-enter` is reached only when the preflight passed and all entry rules are
 * satisfied; it is a SIMULATED, paper-only decision. Carries no wall-clock time.
 */
export function buildPaperSniperDecisionReport(
  input: BuildPaperSniperDecisionReportInput,
): SniperPaperDecisionReport {
  if (!isObject(input)) {
    throw new PaperSniperDecisionReportError("decision input must be an object");
  }
  let list: SniperCandidateList;
  try {
    list = validateSniperCandidateList(input.candidateList);
  } catch (err) {
    throw new PaperSniperDecisionReportError(`candidate list is invalid: ${(err as Error).message}`);
  }

  const hasPreflight = input.preflight !== undefined && input.preflight !== null;
  let preflightById = new Map<string, SniperPreflightEntry>();
  if (hasPreflight) {
    let pf: SniperTokenPreflightReport;
    try {
      pf = validateSniperTokenPreflightReport(input.preflight);
    } catch (err) {
      throw new PaperSniperDecisionReportError(`preflight report is invalid: ${(err as Error).message}`);
    }
    const listIds = new Set(list.candidates.map((c) => c.candidateId));
    for (const e of pf.candidates) {
      if (!listIds.has(e.candidateId)) {
        throw new PaperSniperDecisionReportError(`preflight references unknown candidateId "${e.candidateId}"`);
      }
    }
    preflightById = new Map(pf.candidates.map((e) => [e.candidateId, e]));
  }

  const rules = resolveRules(input.rules);

  const decisions = list.candidates.map((c) => decide(c, preflightById.get(c.candidateId), hasPreflight, rules));

  const skipCount = decisions.filter((d) => d.decision === "skip").length;
  const watchCount = decisions.filter((d) => d.decision === "watch").length;
  const paperEnterCount = decisions.filter((d) => d.decision === "paper-enter").length;
  const paperRejectCount = decisions.filter((d) => d.decision === "paper-reject").length;
  const unknownCount = decisions.filter((d) => d.decision === "unknown").length;

  const hasPaperEnter = paperEnterCount > 0;
  const hasPaperReject = paperRejectCount > 0;
  const hasRiskReject = decisions.some((d) => d.decision === "paper-reject" && d.blockingRiskFlags.length > 0);

  const ciFailReasons: string[] = [];
  if (hasPaperEnter) {
    ciFailReasons.push(`${paperEnterCount} candidate(s) would paper-enter: ${decisions.filter((d) => d.decision === "paper-enter").map((d) => d.candidateId).join(", ")}`);
  }
  if (hasRiskReject) {
    ciFailReasons.push(`${decisions.filter((d) => d.decision === "paper-reject" && d.blockingRiskFlags.length > 0).length} candidate(s) rejected on risk`);
  }

  const warnings: string[] = [];
  if (!hasPreflight) {
    warnings.push("no preflight report supplied — every candidate is conservatively watched.");
  }
  if (hasPaperReject) {
    warnings.push(`${paperRejectCount} candidate(s) were paper-rejected.`);
  }

  const notes = [
    `${decisions.length} candidate(s): ${paperEnterCount} paper-enter, ${watchCount} watch, ${skipCount} skip, ${paperRejectCount} paper-reject, ${unknownCount} unknown.`,
    "A paper-enter is a SIMULATED, paper-only decision — never a buy/sell order, a transaction, or live readiness.",
  ];

  return {
    schemaVersion: SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
    banner: SNIPER_PAPER_DECISION_REPORT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_PAPER_DECISION_REPORT_DISCLAIMERS],
    sourceLabel: list.sourceLabel,
    hasPreflight,
    rules,
    candidateCount: decisions.length,
    decisions,
    skipCount,
    watchCount,
    paperEnterCount,
    paperRejectCount,
    unknownCount,
    hasPaperEnter,
    hasPaperReject,
    hasRiskReject,
    wouldFailOnPaperEnter: hasPaperEnter,
    wouldFailOnRisk: hasRiskReject,
    ciFailReasons,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const DECISIONS: ReadonlySet<string> = new Set(["skip", "watch", "paper-enter", "paper-reject", "unknown"]);

function validateEntry(value: unknown, where: string): void {
  if (!isObject(value)) throw new PaperSniperDecisionReportError(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) throw new PaperSniperDecisionReportError(`${where}.candidateId must be a non-empty string`);
  if (!nonEmptyString(value.mint)) throw new PaperSniperDecisionReportError(`${where}.mint must be a non-empty string`);
  if (typeof value.decision !== "string" || !DECISIONS.has(value.decision)) {
    throw new PaperSniperDecisionReportError(`${where}.decision must be skip|watch|paper-enter|paper-reject|unknown`);
  }
  if (value.preflightStatus !== null && typeof value.preflightStatus !== "string") {
    throw new PaperSniperDecisionReportError(`${where}.preflightStatus must be a string or null`);
  }
  for (const f of ["reasons", "appliedRules", "assumptions"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new PaperSniperDecisionReportError(`${where}.${f} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.blockingRiskFlags)) throw new PaperSniperDecisionReportError(`${where}.blockingRiskFlags must be an array`);
}

/**
 * Strictly validate a value as a {@link SniperPaperDecisionReport} and return it narrowed. A backstop
 * mirroring the package's sibling validators: checks the schema version + banner, the PAPER-ONLY
 * labelling, the disclaimers, the resolved rules, every entry, the aggregate counts, the conservative
 * flags, and the CI mirror. Throws {@link PaperSniperDecisionReportError} on the first problem. Pure.
 */
export function validatePaperSniperDecisionReport(value: unknown): SniperPaperDecisionReport {
  if (!isObject(value)) throw new PaperSniperDecisionReportError("decision report must be a JSON object");
  if (value.schemaVersion !== SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION) {
    throw new PaperSniperDecisionReportError(
      `decision report.schemaVersion must be "${SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== SNIPER_PAPER_DECISION_REPORT_BANNER) {
    throw new PaperSniperDecisionReportError(`decision report.banner must be "${SNIPER_PAPER_DECISION_REPORT_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new PaperSniperDecisionReportError(`decision report.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new PaperSniperDecisionReportError("decision report.disclaimers must be a non-empty array");
  }
  if (value.sourceLabel !== null && typeof value.sourceLabel !== "string") {
    throw new PaperSniperDecisionReportError("decision report.sourceLabel must be a string or null");
  }
  if (typeof value.hasPreflight !== "boolean") throw new PaperSniperDecisionReportError("decision report.hasPreflight must be a boolean");
  if (!isObject(value.rules)) throw new PaperSniperDecisionReportError("decision report.rules must be an object");
  if (typeof (value.rules as Record<string, unknown>).requirePreflightPass !== "boolean") {
    throw new PaperSniperDecisionReportError("decision report.rules.requirePreflightPass must be a boolean");
  }
  for (const f of ["candidateCount", "skipCount", "watchCount", "paperEnterCount", "paperRejectCount", "unknownCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new PaperSniperDecisionReportError(`decision report.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["hasPaperEnter", "hasPaperReject", "hasRiskReject", "wouldFailOnPaperEnter", "wouldFailOnRisk"] as const) {
    if (typeof value[f] !== "boolean") throw new PaperSniperDecisionReportError(`decision report.${f} must be a boolean`);
  }
  if (value.wouldFailOnPaperEnter !== value.hasPaperEnter) throw new PaperSniperDecisionReportError("decision report.wouldFailOnPaperEnter must mirror hasPaperEnter");
  if (value.wouldFailOnRisk !== value.hasRiskReject) throw new PaperSniperDecisionReportError("decision report.wouldFailOnRisk must mirror hasRiskReject");
  for (const key of ["ciFailReasons", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new PaperSniperDecisionReportError(`decision report.${key} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.decisions)) throw new PaperSniperDecisionReportError("decision report.decisions must be an array");
  if ((value.decisions as unknown[]).length !== value.candidateCount) {
    throw new PaperSniperDecisionReportError("decision report.decisions length must equal candidateCount");
  }
  (value.decisions as unknown[]).forEach((e, i) => validateEntry(e, `decision report.decisions[${i}]`));
  return value as unknown as SniperPaperDecisionReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatPaperSniperDecisionReport}. */
export interface FormatPaperSniperDecisionReportOptions {
  label?: string;
  /** Cap on the number of decision rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable decision report. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the decision tally, lists each candidate's
 * decision + reasons, and closes with the CI verdict and the simulated-only / not-a-trade-signal
 * disclaimers. The whole output is passed through the shared redactor.
 */
export function formatPaperSniperDecisionReport(
  report: SniperPaperDecisionReport,
  opts: FormatPaperSniperDecisionReportOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${report.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`source:     ${report.sourceLabel ?? "(none)"}`);
  lines.push(`preflight:  ${report.hasPreflight ? "supplied" : "(none — every candidate conservatively watched)"}`);
  lines.push(
    `decisions:  ${report.candidateCount} (${report.paperEnterCount} paper-enter / ${report.watchCount} watch / ${report.skipCount} skip / ${report.paperRejectCount} paper-reject / ${report.unknownCount} unknown)`,
  );

  lines.push("");
  lines.push("Rules applied:");
  lines.push(`- requirePreflightPass: ${report.rules.requirePreflightPass}`);
  lines.push(`- maxRiskScore:         ${report.rules.maxRiskScore ?? "(none)"}`);
  lines.push(`- minObservedLiquidityUsd: ${report.rules.minObservedLiquidityUsd ?? "(none)"}`);
  lines.push(`- denyMints:            ${report.rules.denyMints.length > 0 ? report.rules.denyMints.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Decisions:");
  if (report.decisions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const d of report.decisions.slice(0, maxRows)) {
      lines.push(`- [${d.decision.toUpperCase()}] ${d.candidateId}  ${d.mint}`);
      for (const reason of d.reasons) lines.push(`    · ${reason}`);
    }
    const hidden = report.decisions.length - Math.min(report.decisions.length, maxRows);
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the report JSON for the full set)`);
  }

  lines.push("");
  lines.push(`Any paper-enter: ${report.hasPaperEnter ? "YES" : "no"}`);
  lines.push(`Any paper-reject: ${report.hasPaperReject ? "YES" : "no"}`);
  lines.push(`Any risk reject:  ${report.hasRiskReject ? "YES" : "no"}`);
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
