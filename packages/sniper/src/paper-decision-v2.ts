/**
 * Deterministic, offline, **PAPER-only** SNIPER DECISION REPORT **V2** (Sprint 46).
 *
 * V2 = the v1 decision report PLUS stable, machine-readable **reason codes**. Every decision branch in
 * `paper-decision.ts` and every tighten-only policy transform in `policy-config.ts` emits its code at
 * the moment it fires (see `decision-reason-codes.ts` for the closed vocabulary). Downstream tooling
 * reads CODES — never the free-text `reasons` strings, which remain operator prose.
 *
 * Per candidate, v2 carries the full v1 entry plus:
 *   - `reasonCodes`         — the full trail (cause codes in emission order + one outcome marker)
 *   - `blockingReasonCodes` — the subset that kept the candidate OUT (skip / paper-reject)
 *   - `warningReasonCodes`  — the subset marking soft holds / cautions
 *   - `policyReasonCodes`   — the subset produced by operator rules / policy enforcement
 *   - `riskReasonCodes`     — the subset about advisory risk data
 * plus deterministic summary counts by code and by category, and run-level `reportReasonCodes`.
 *
 * V1 is fully preserved: `sniper.paper.decision.report.v1` keeps building/validating byte-identically,
 * and {@link upgradePaperSniperDecisionReportV1ToV2} lifts an existing v1 artifact into v2 using ONLY
 * structured v1 fields (decision / preflightStatus / blockingRiskFlags / appliedRules) — it never
 * parses reason text, so upgraded codes are an honest, conservative subset.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work. Reason codes are
 * integrity/risk explanations for SIMULATED, paper-only decisions — never trading advice. A
 * `paper-enter` remains a simulated decision: NOT a buy/sell order, NOT a transaction, NOT live
 * readiness. Carries no wall-clock time.
 */

import { redactString } from "@soulmaker/security";
import {
  analyzePaperSniperDecisionReport,
  validatePaperSniperDecisionReport,
  type BuildPaperSniperDecisionReportInput,
  type ResolvedSniperDecisionRules,
  type SniperDecision,
  type SniperDecisionEntry,
  type SniperDecisionRules,
  type SniperPaperDecisionReport,
} from "./paper-decision.js";
import {
  enforceSniperPolicyWithReasonCodes,
  validateSniperPolicyConfig,
  deriveSniperDecisionRules,
  SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
  type SniperPolicyConfig,
} from "./policy-config.js";
import {
  validateSniperPolicyConfigV2,
  deriveSniperDecisionRulesFromV2,
  enforceSniperPolicyV2WithReasonCodes,
  SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
  type SniperPolicyConfigV2,
} from "./policy-config-v2.js";
import {
  SNIPER_DECISION_REASON_CODE_DEFINITIONS,
  SNIPER_DECISION_REASON_CATEGORIES,
  dedupeSniperDecisionReasonCodes,
  isSniperDecisionReasonCode,
  type SniperDecisionReasonCode,
  type SniperDecisionReasonCategory,
} from "./decision-reason-codes.js";

/** Stable schema identifier for the v2 decision report. Bump only on a breaking change. */
export const SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION = "sniper.paper.decision.report.v2";

/** The banner that prefixes every v2 decision report (required label). */
export const SNIPER_PAPER_DECISION_REPORT_V2_BANNER = "SIMULATED PAPER-ONLY SNIPER DECISION REPORT V2";

/** Required disclaimer statements carried by every v2 decision report (stable order). */
export const SNIPER_PAPER_DECISION_REPORT_V2_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER DECISION REPORT V2 — the v1 per-candidate simulated decisions plus stable machine-readable reason codes.",
  "Reason codes are machine-readable integrity/risk explanations for SIMULATED paper-only decisions — never trading advice, never a buy/sell signal.",
  "Codes are emitted by the same branches that produce the decisions; the free-text reasons remain operator prose and are never parsed as logic.",
  "A `paper-enter` is a SIMULATED, paper-only decision — it is NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "Conservative: a candidate reaches `paper-enter` only when the preflight PASSED and every deterministic entry rule (and any policy) is satisfied.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
] as const;

/** Thrown when v2 decision INPUT or a produced v2 report is structurally invalid. */
export class PaperSniperDecisionReportV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperSniperDecisionReportV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** One candidate's v2 decision entry: the v1 entry plus its machine-readable reason codes. */
export interface SniperDecisionEntryV2 extends SniperDecisionEntry {
  /** The full code trail: cause codes in emission order, then exactly one outcome marker. */
  reasonCodes: SniperDecisionReasonCode[];
  /** Codes that kept the candidate out (skip / paper-reject). Derived: definition.blocking. */
  blockingReasonCodes: SniperDecisionReasonCode[];
  /** Codes marking soft holds / cautions. Derived: definition.warning. */
  warningReasonCodes: SniperDecisionReasonCode[];
  /** Codes from operator rules / tighten-only policy enforcement. Derived: definition.policyDriven. */
  policyReasonCodes: SniperDecisionReasonCode[];
  /** Codes about advisory risk data. Derived: definition.riskRelated. */
  riskReasonCodes: SniperDecisionReasonCode[];
}

/** The full, deterministic, JSON-serializable v2 decision report. */
export interface SniperPaperDecisionReportV2 {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  sourceLabel: string | null;
  hasPreflight: boolean;
  /** The resolved rules actually applied (assumptions, made explicit). */
  rules: ResolvedSniperDecisionRules;
  /** Whether a policy config governed this build; null = not determinable (upgraded from v1). */
  policyApplied: boolean | null;
  /** The policy's label when one was applied (null otherwise / when upgraded). */
  policyLabel: string | null;
  /** The schemaVersion of the applied policy (null when none was applied / when upgraded). */
  policySchemaVersion: string | null;
  /** True when this report was lifted from a v1 artifact (codes are a conservative subset). */
  upgradedFromV1: boolean;
  candidateCount: number;
  decisions: SniperDecisionEntryV2[];
  // --- aggregate counts (same semantics as v1) ---
  skipCount: number;
  watchCount: number;
  paperEnterCount: number;
  paperRejectCount: number;
  unknownCount: number;
  hasPaperEnter: boolean;
  hasPaperReject: boolean;
  hasRiskReject: boolean;
  // --- machine-readable reason summaries ---
  /** Run-level codes (scope "report"), in emission order. */
  reportReasonCodes: SniperDecisionReasonCode[];
  /** Per-candidate code occurrences, keyed by code (sorted keys; only codes that occurred). */
  reasonCodeCounts: Record<string, number>;
  /** Per-candidate code occurrences, keyed by category (sorted keys; only categories that occurred). */
  categoryCounts: Record<string, number>;
  // --- CI decision section (mirrors v1) ---
  wouldFailOnPaperEnter: boolean;
  wouldFailOnRisk: boolean;
  ciFailReasons: string[];
  warnings: string[];
  notes: string[];
}

/** Everything {@link buildPaperSniperDecisionReportV2} needs. */
export interface BuildPaperSniperDecisionReportV2Input {
  /** The candidate list (a canonical `sniper.candidate.list.v1`; strictly validated). */
  candidateList: unknown;
  /** An optional token preflight report (`sniper.token.preflight.report.v1`; strictly validated). */
  preflight?: unknown;
  /** Optional deterministic operator rules (mutually exclusive with `policy`). */
  rules?: SniperDecisionRules;
  /**
   * Optional canonical policy config — `sniper.policy.config.v1` OR `.v2` (sniffed by its
   * schemaVersion; strictly validated; tighten-only). A v2 policy additionally applies its
   * reason-code-aware risk limits.
   */
  policy?: unknown;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The outcome marker for a final decision (exactly one per candidate). */
function outcomeCode(decision: SniperDecision): SniperDecisionReasonCode {
  switch (decision) {
    case "skip": return "skip-candidate";
    case "watch": return "watch-candidate";
    case "paper-enter": return "paper-enter-candidate";
    case "paper-reject": return "paper-reject-candidate";
    case "unknown": return "unknown-candidate";
  }
}

/** Project a deduped code trail into the four derived classification arrays. */
function classifyCodes(codes: SniperDecisionReasonCode[]): {
  blockingReasonCodes: SniperDecisionReasonCode[];
  warningReasonCodes: SniperDecisionReasonCode[];
  policyReasonCodes: SniperDecisionReasonCode[];
  riskReasonCodes: SniperDecisionReasonCode[];
} {
  const defs = codes.map((c) => SNIPER_DECISION_REASON_CODE_DEFINITIONS[c]);
  return {
    blockingReasonCodes: defs.filter((d) => d.blocking).map((d) => d.code),
    warningReasonCodes: defs.filter((d) => d.warning).map((d) => d.code),
    policyReasonCodes: defs.filter((d) => d.policyDriven).map((d) => d.code),
    riskReasonCodes: defs.filter((d) => d.riskRelated).map((d) => d.code),
  };
}

/** Build one v2 entry from a (final) v1 entry and its full code trail. */
function buildEntryV2(entry: SniperDecisionEntry, trail: SniperDecisionReasonCode[]): SniperDecisionEntryV2 {
  const reasonCodes = dedupeSniperDecisionReasonCodes([...trail, outcomeCode(entry.decision)]);
  return { ...entry, reasonCodes, ...classifyCodes(reasonCodes) };
}

/** Deterministic, sorted-key occurrence counts over all candidates' code trails. */
function summarizeCodes(entries: SniperDecisionEntryV2[]): {
  reasonCodeCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
} {
  const byCode = new Map<SniperDecisionReasonCode, number>();
  const byCategory = new Map<SniperDecisionReasonCategory, number>();
  for (const entry of entries) {
    for (const code of entry.reasonCodes) {
      byCode.set(code, (byCode.get(code) ?? 0) + 1);
      const category = SNIPER_DECISION_REASON_CODE_DEFINITIONS[code].category;
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    }
  }
  const reasonCodeCounts: Record<string, number> = {};
  for (const code of [...byCode.keys()].sort()) reasonCodeCounts[code] = byCode.get(code) as number;
  const categoryCounts: Record<string, number> = {};
  for (const category of [...byCategory.keys()].sort()) categoryCounts[category] = byCategory.get(category) as number;
  return { reasonCodeCounts, categoryCounts };
}

/** Assemble the final v2 report from a (final) v1 report + per-candidate trails + run-level codes. */
function assembleV2(
  base: SniperPaperDecisionReport,
  trailsById: Record<string, SniperDecisionReasonCode[]>,
  reportReasonCodes: SniperDecisionReasonCode[],
  meta: {
    policyApplied: boolean | null;
    policyLabel: string | null;
    policySchemaVersion: string | null;
    upgradedFromV1: boolean;
    extraNotes?: string[];
  },
): SniperPaperDecisionReportV2 {
  const decisions = base.decisions.map((entry) => buildEntryV2(entry, trailsById[entry.candidateId] ?? []));
  const { reasonCodeCounts, categoryCounts } = summarizeCodes(decisions);
  return {
    schemaVersion: SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
    banner: SNIPER_PAPER_DECISION_REPORT_V2_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_PAPER_DECISION_REPORT_V2_DISCLAIMERS],
    sourceLabel: base.sourceLabel,
    hasPreflight: base.hasPreflight,
    rules: { ...base.rules, denyMints: [...base.rules.denyMints] },
    policyApplied: meta.policyApplied,
    policyLabel: meta.policyLabel,
    policySchemaVersion: meta.policySchemaVersion,
    upgradedFromV1: meta.upgradedFromV1,
    candidateCount: base.candidateCount,
    decisions,
    skipCount: base.skipCount,
    watchCount: base.watchCount,
    paperEnterCount: base.paperEnterCount,
    paperRejectCount: base.paperRejectCount,
    unknownCount: base.unknownCount,
    hasPaperEnter: base.hasPaperEnter,
    hasPaperReject: base.hasPaperReject,
    hasRiskReject: base.hasRiskReject,
    reportReasonCodes: dedupeSniperDecisionReasonCodes(reportReasonCodes),
    reasonCodeCounts,
    categoryCounts,
    wouldFailOnPaperEnter: base.wouldFailOnPaperEnter,
    wouldFailOnRisk: base.wouldFailOnRisk,
    ciFailReasons: [...base.ciFailReasons],
    warnings: [...base.warnings],
    notes: [...base.notes, ...(meta.extraNotes ?? [])],
  };
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperPaperDecisionReportV2}. Pure and non-mutating. Validation and
 * decision semantics are EXACTLY v1's (the same branches run; codes are emitted alongside, never
 * re-derived). `rules` and `policy` are mutually exclusive: with a policy, its base rules drive the
 * build and its tighten-only enforcement is applied afterward — each enforcement transform contributes
 * its policy code, and a paper-enter that survives every check gets `policy-allowed-paper-enter`.
 * Carries no wall-clock time. Throws {@link PaperSniperDecisionReportV2Error} on invalid input.
 */
export function buildPaperSniperDecisionReportV2(
  input: BuildPaperSniperDecisionReportV2Input,
): SniperPaperDecisionReportV2 {
  if (!isObject(input)) {
    throw new PaperSniperDecisionReportV2Error("decision v2 input must be an object");
  }
  const hasPolicy = input.policy !== undefined && input.policy !== null;
  if (hasPolicy && input.rules !== undefined) {
    throw new PaperSniperDecisionReportV2Error("rules and policy are mutually exclusive — supply one");
  }

  // Sniff the policy version (v1 / v2) by its schemaVersion; both are strictly validated.
  let policyV1: SniperPolicyConfig | null = null;
  let policyV2: SniperPolicyConfigV2 | null = null;
  let rules = input.rules;
  if (hasPolicy) {
    const sniffed = isObject(input.policy) ? input.policy.schemaVersion : undefined;
    try {
      if (sniffed === SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION) {
        policyV2 = validateSniperPolicyConfigV2(input.policy);
        rules = deriveSniperDecisionRulesFromV2(policyV2);
      } else {
        policyV1 = validateSniperPolicyConfig(input.policy);
        rules = deriveSniperDecisionRules(policyV1);
      }
    } catch (err) {
      throw new PaperSniperDecisionReportV2Error(`policy config is invalid: ${(err as Error).message}`);
    }
  }

  const buildInput: BuildPaperSniperDecisionReportInput = {
    candidateList: input.candidateList,
    preflight: input.preflight,
    rules,
  };
  let analysis;
  try {
    analysis = analyzePaperSniperDecisionReport(buildInput);
  } catch (err) {
    throw new PaperSniperDecisionReportV2Error((err as Error).message);
  }

  let finalReport = analysis.report;
  const trailsById: Record<string, SniperDecisionReasonCode[]> = { ...analysis.reasonCodesById };
  const reportReasonCodes: SniperDecisionReasonCode[] = [];
  if (!finalReport.hasPreflight) reportReasonCodes.push("missing-preflight-report");

  if (policyV1) {
    let enforcement;
    try {
      enforcement = enforceSniperPolicyWithReasonCodes(finalReport, policyV1, { preflight: input.preflight });
    } catch (err) {
      throw new PaperSniperDecisionReportV2Error((err as Error).message);
    }
    finalReport = enforcement.report;
    for (const [candidateId, codes] of Object.entries(enforcement.policyReasonCodesById)) {
      trailsById[candidateId] = [...(trailsById[candidateId] ?? []), ...codes];
    }
    reportReasonCodes.push(...enforcement.reportReasonCodes);
  } else if (policyV2) {
    // v1 enforcement + v2 risk limits in one tighten-only pass (the v2 module reuses v1 internally).
    let enforcement;
    try {
      enforcement = enforceSniperPolicyV2WithReasonCodes(finalReport, policyV2, {
        preflight: input.preflight,
        trailsById,
      });
    } catch (err) {
      throw new PaperSniperDecisionReportV2Error((err as Error).message);
    }
    finalReport = enforcement.report;
    for (const [candidateId, codes] of Object.entries(enforcement.policyReasonCodesById)) {
      trailsById[candidateId] = [...(trailsById[candidateId] ?? []), ...codes];
    }
    reportReasonCodes.push(...enforcement.reportReasonCodes);
  }

  const appliedPolicy = policyV1 ?? policyV2;
  return assembleV2(finalReport, trailsById, reportReasonCodes, {
    policyApplied: appliedPolicy !== null,
    policyLabel: appliedPolicy?.policyLabel ?? null,
    policySchemaVersion: appliedPolicy === null ? null : appliedPolicy.schemaVersion,
    upgradedFromV1: false,
  });
}

// --- v1 → v2 adapter ----------------------------------------------------------

/**
 * Lift an existing, already-built `sniper.paper.decision.report.v1` artifact into a v2 report. Pure.
 * Codes are derived from STRUCTURED v1 fields ONLY — `decision`, `preflightStatus`,
 * `blockingRiskFlags`, and `appliedRules`; the free-text `reasons` strings are NEVER parsed. The
 * result is therefore an honest, conservative SUBSET: cause-level codes that v1 does not record
 * structurally (e.g. which policy switch downgraded an entry) are simply absent, and `policyApplied`
 * is `null` (not determinable from a v1 artifact). All v1 aggregates are carried VERBATIM. Throws
 * {@link PaperSniperDecisionReportV2Error} when the input is not a valid v1 report.
 */
export function upgradePaperSniperDecisionReportV1ToV2(value: unknown): SniperPaperDecisionReportV2 {
  let v1: SniperPaperDecisionReport;
  try {
    v1 = validatePaperSniperDecisionReport(value);
  } catch (err) {
    throw new PaperSniperDecisionReportV2Error(`v1 decision report is invalid: ${(err as Error).message}`);
  }

  const trailsById: Record<string, SniperDecisionReasonCode[]> = {};
  for (const entry of v1.decisions) {
    const codes: SniperDecisionReasonCode[] = [];
    if (entry.preflightStatus === null) {
      codes.push("missing-preflight");
      if (entry.decision === "watch") codes.push("watched-incomplete-info");
    } else if (entry.preflightStatus === "fail") {
      codes.push("preflight-fail");
    } else if (entry.preflightStatus === "warn" && entry.decision === "watch") {
      codes.push("preflight-warning");
    } else if (entry.preflightStatus === "unknown") {
      codes.push("preflight-unknown");
      if (entry.decision === "watch") codes.push("watched-incomplete-info");
    }
    if (entry.decision === "paper-reject" && entry.blockingRiskFlags.length > 0) {
      codes.push("risk-blocked");
    }
    if (entry.decision === "skip" && entry.appliedRules.includes("denyMints")) {
      codes.push("operator-denylist-mint");
    }
    if (entry.decision === "unknown") {
      codes.push("preflight-status-unrecognized");
    }
    trailsById[entry.candidateId] = codes;
  }

  const reportReasonCodes: SniperDecisionReasonCode[] = v1.hasPreflight ? [] : ["missing-preflight-report"];

  return assembleV2(v1, trailsById, reportReasonCodes, {
    policyApplied: null,
    policyLabel: null,
    policySchemaVersion: null,
    upgradedFromV1: true,
    extraNotes: [
      "Upgraded from v1: reason codes were derived from structured v1 fields only (never the free-text reasons) and may be a conservative subset.",
    ],
  });
}

// --- validation (backstop) ---------------------------------------------------

const DECISIONS: ReadonlySet<string> = new Set(["skip", "watch", "paper-enter", "paper-reject", "unknown"]);
const CATEGORY_SET: ReadonlySet<string> = new Set(SNIPER_DECISION_REASON_CATEGORIES);

function requireCodeArray(value: unknown, where: string): SniperDecisionReasonCode[] {
  if (!Array.isArray(value)) throw new PaperSniperDecisionReportV2Error(`${where} must be an array`);
  for (const code of value) {
    if (!isSniperDecisionReasonCode(code)) {
      throw new PaperSniperDecisionReportV2Error(`${where} contains an unknown reason code "${String(code)}"`);
    }
  }
  return value as SniperDecisionReasonCode[];
}

function validateEntryV2(value: unknown, where: string): void {
  if (!isObject(value)) throw new PaperSniperDecisionReportV2Error(`${where} must be an object`);
  if (typeof value.candidateId !== "string" || value.candidateId.length === 0) {
    throw new PaperSniperDecisionReportV2Error(`${where}.candidateId must be a non-empty string`);
  }
  if (typeof value.mint !== "string" || value.mint.length === 0) {
    throw new PaperSniperDecisionReportV2Error(`${where}.mint must be a non-empty string`);
  }
  if (typeof value.decision !== "string" || !DECISIONS.has(value.decision)) {
    throw new PaperSniperDecisionReportV2Error(`${where}.decision must be skip|watch|paper-enter|paper-reject|unknown`);
  }
  if (value.preflightStatus !== null && typeof value.preflightStatus !== "string") {
    throw new PaperSniperDecisionReportV2Error(`${where}.preflightStatus must be a string or null`);
  }
  for (const f of ["reasons", "appliedRules", "assumptions"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new PaperSniperDecisionReportV2Error(`${where}.${f} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.blockingRiskFlags)) {
    throw new PaperSniperDecisionReportV2Error(`${where}.blockingRiskFlags must be an array`);
  }

  const reasonCodes = requireCodeArray(value.reasonCodes, `${where}.reasonCodes`);
  if (new Set(reasonCodes).size !== reasonCodes.length) {
    throw new PaperSniperDecisionReportV2Error(`${where}.reasonCodes must not contain duplicates`);
  }
  for (const code of reasonCodes) {
    if (SNIPER_DECISION_REASON_CODE_DEFINITIONS[code].scope !== "candidate") {
      throw new PaperSniperDecisionReportV2Error(`${where}.reasonCodes contains report-scoped code "${code}"`);
    }
  }
  const expectedOutcome = outcomeCode(value.decision as SniperDecision);
  if (!reasonCodes.includes(expectedOutcome)) {
    throw new PaperSniperDecisionReportV2Error(`${where}.reasonCodes must include the outcome marker "${expectedOutcome}"`);
  }
  // The four classification arrays are DERIVED — enforce exact agreement with the definitions.
  const expected = classifyCodes(reasonCodes);
  for (const f of ["blockingReasonCodes", "warningReasonCodes", "policyReasonCodes", "riskReasonCodes"] as const) {
    const actual = requireCodeArray(value[f], `${where}.${f}`);
    if (JSON.stringify(actual) !== JSON.stringify(expected[f])) {
      throw new PaperSniperDecisionReportV2Error(`${where}.${f} must equal the codes derived from reasonCodes`);
    }
  }
}

/**
 * Strictly validate a value as a {@link SniperPaperDecisionReportV2} and return it narrowed. A backstop
 * mirroring the package's sibling validators: schema/banner/labels/disclaimers, the resolved rules,
 * every entry (including that every reason code is in the closed vocabulary, candidate-scoped, deduped,
 * carries its outcome marker, and that the four classification arrays agree with the definitions), the
 * aggregate counts, the deterministic code/category summaries (recomputed and compared), and the CI
 * mirror. Throws {@link PaperSniperDecisionReportV2Error} on the first problem. Pure.
 */
export function validatePaperSniperDecisionReportV2(value: unknown): SniperPaperDecisionReportV2 {
  if (!isObject(value)) throw new PaperSniperDecisionReportV2Error("decision v2 report must be a JSON object");
  if (value.schemaVersion !== SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION) {
    throw new PaperSniperDecisionReportV2Error(
      `decision v2 report.schemaVersion must be "${SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== SNIPER_PAPER_DECISION_REPORT_V2_BANNER) {
    throw new PaperSniperDecisionReportV2Error(`decision v2 report.banner must be "${SNIPER_PAPER_DECISION_REPORT_V2_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new PaperSniperDecisionReportV2Error(`decision v2 report.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.disclaimers must be a non-empty array");
  }
  if (value.sourceLabel !== null && typeof value.sourceLabel !== "string") {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.sourceLabel must be a string or null");
  }
  if (typeof value.hasPreflight !== "boolean") {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.hasPreflight must be a boolean");
  }
  if (!isObject(value.rules) || typeof (value.rules as Record<string, unknown>).requirePreflightPass !== "boolean") {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.rules must be a resolved rules object");
  }
  if (value.policyApplied !== null && typeof value.policyApplied !== "boolean") {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.policyApplied must be a boolean or null");
  }
  if (value.policyLabel !== null && typeof value.policyLabel !== "string") {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.policyLabel must be a string or null");
  }
  if (value.policyApplied === true) {
    if (value.policySchemaVersion !== SNIPER_POLICY_CONFIG_SCHEMA_VERSION && value.policySchemaVersion !== SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION) {
      throw new PaperSniperDecisionReportV2Error(
        `decision v2 report.policySchemaVersion must be "${SNIPER_POLICY_CONFIG_SCHEMA_VERSION}" or "${SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION}" when a policy was applied`,
      );
    }
  } else if (value.policySchemaVersion !== null) {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.policySchemaVersion must be null when no policy was applied");
  }
  if (typeof value.upgradedFromV1 !== "boolean") {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.upgradedFromV1 must be a boolean");
  }
  for (const f of ["candidateCount", "skipCount", "watchCount", "paperEnterCount", "paperRejectCount", "unknownCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new PaperSniperDecisionReportV2Error(`decision v2 report.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["hasPaperEnter", "hasPaperReject", "hasRiskReject", "wouldFailOnPaperEnter", "wouldFailOnRisk"] as const) {
    if (typeof value[f] !== "boolean") throw new PaperSniperDecisionReportV2Error(`decision v2 report.${f} must be a boolean`);
  }
  if (value.wouldFailOnPaperEnter !== value.hasPaperEnter) {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.wouldFailOnPaperEnter must mirror hasPaperEnter");
  }
  if (value.wouldFailOnRisk !== value.hasRiskReject) {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.wouldFailOnRisk must mirror hasRiskReject");
  }
  for (const key of ["ciFailReasons", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new PaperSniperDecisionReportV2Error(`decision v2 report.${key} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.decisions)) throw new PaperSniperDecisionReportV2Error("decision v2 report.decisions must be an array");
  if ((value.decisions as unknown[]).length !== value.candidateCount) {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.decisions length must equal candidateCount");
  }
  (value.decisions as unknown[]).forEach((e, i) => validateEntryV2(e, `decision v2 report.decisions[${i}]`));

  const reportCodes = requireCodeArray(value.reportReasonCodes, "decision v2 report.reportReasonCodes");
  for (const code of reportCodes) {
    if (SNIPER_DECISION_REASON_CODE_DEFINITIONS[code].scope !== "report") {
      throw new PaperSniperDecisionReportV2Error(`decision v2 report.reportReasonCodes contains candidate-scoped code "${code}"`);
    }
  }

  // The summaries are DERIVED — recompute and compare (sorted keys, exact counts).
  const expected = summarizeCodes(value.decisions as SniperDecisionEntryV2[]);
  if (JSON.stringify(value.reasonCodeCounts) !== JSON.stringify(expected.reasonCodeCounts)) {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.reasonCodeCounts must equal the recomputed per-code counts");
  }
  if (!isObject(value.categoryCounts) || [...Object.keys(value.categoryCounts)].some((k) => !CATEGORY_SET.has(k))) {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.categoryCounts keys must be known categories");
  }
  if (JSON.stringify(value.categoryCounts) !== JSON.stringify(expected.categoryCounts)) {
    throw new PaperSniperDecisionReportV2Error("decision v2 report.categoryCounts must equal the recomputed per-category counts");
  }
  return value as unknown as SniperPaperDecisionReportV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatPaperSniperDecisionReportV2}. */
export interface FormatPaperSniperDecisionReportV2Options {
  label?: string;
  /** Cap on the number of decision rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

/** The stable order in which decision groups are printed (most actionable first). */
const DECISION_GROUP_ORDER: readonly SniperDecision[] = ["paper-enter", "paper-reject", "watch", "skip", "unknown"];

/** Render one candidate's full reason trail (codes, reasons, blocking flags, assumptions). */
function formatEntryV2(d: SniperDecisionEntryV2, lines: string[]): void {
  lines.push(`- ${d.candidateId}  ${d.mint}${d.preflightStatus !== null ? `  (preflight: ${d.preflightStatus})` : "  (no preflight data)"}`);
  lines.push(`    codes: ${d.reasonCodes.join(" → ")}`);
  for (const reason of d.reasons) lines.push(`    · ${reason}`);
  if (d.blockingRiskFlags.length > 0) {
    lines.push(`    risk flags: ${d.blockingRiskFlags.map((f) => `${f.id} (${f.severity})`).join(", ")}`);
  }
  for (const a of d.assumptions) lines.push(`    assumes: ${a}`);
}

/**
 * Render a redacted, stable, human-readable v2 decision report — the operator-grade view (Sprint 49).
 * Deterministic and path-stable (no timestamps). Sections, in order: header + run facts, the policy
 * summary, the sorted reason-code table (with category and blocking/warning class), the decisions
 * grouped by outcome (paper-enter first — each with its full reason trail: codes, reasons, blocking
 * risk flags, assumptions), the risk summary, the CI verdict, warnings, notes, and the simulated-only
 * disclaimers. The whole output is passed through the shared redactor.
 */
export function formatPaperSniperDecisionReportV2(
  report: SniperPaperDecisionReportV2,
  opts: FormatPaperSniperDecisionReportV2Options = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${report.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`source:     ${report.sourceLabel ?? "(none)"}`);
  lines.push(`preflight:  ${report.hasPreflight ? "supplied" : "(none — every candidate conservatively watched)"}`);
  if (report.upgradedFromV1) lines.push("origin:     upgraded from a v1 artifact (codes are a conservative subset)");
  lines.push(
    `decisions:  ${report.candidateCount} (${report.paperEnterCount} paper-enter / ${report.watchCount} watch / ${report.skipCount} skip / ${report.paperRejectCount} paper-reject / ${report.unknownCount} unknown)`,
  );

  lines.push("");
  lines.push("Policy:");
  if (report.policyApplied === null) {
    lines.push("- (not determinable — this report was upgraded from a v1 artifact)");
  } else if (!report.policyApplied) {
    lines.push("- (none applied — only the base operator rules governed this run)");
  } else {
    lines.push(`- applied: ${report.policyLabel ?? "(unlabeled)"} (${report.policySchemaVersion})`);
  }
  lines.push(`- rules: requirePreflightPass=${report.rules.requirePreflightPass}, maxRiskScore=${report.rules.maxRiskScore ?? "(none)"}, minObservedLiquidityUsd=${report.rules.minObservedLiquidityUsd ?? "(none)"}, denyMints=${report.rules.denyMints.length > 0 ? report.rules.denyMints.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Reason codes (per-candidate occurrences, sorted):");
  const codeKeys = Object.keys(report.reasonCodeCounts);
  if (codeKeys.length === 0) {
    lines.push("- (none)");
  } else {
    for (const code of codeKeys) {
      const definition = SNIPER_DECISION_REASON_CODE_DEFINITIONS[code as SniperDecisionReasonCode];
      const klass = definition.blocking ? " blocking" : definition.warning ? " warning" : "";
      lines.push(`- ${code}  ×${report.reasonCodeCounts[code]}  [${definition.category}${klass}]`);
    }
  }
  if (report.reportReasonCodes.length > 0) {
    lines.push(`Run-level codes: ${report.reportReasonCodes.join(", ")}`);
  }

  // Decisions, grouped by outcome (stable order; candidate order preserved within a group).
  let printed = 0;
  for (const group of DECISION_GROUP_ORDER) {
    const members = report.decisions.filter((d) => d.decision === group);
    if (members.length === 0) continue;
    lines.push("");
    lines.push(`${group.toUpperCase()} (${members.length}):`);
    for (const d of members) {
      if (printed >= maxRows) break;
      formatEntryV2(d, lines);
      printed += 1;
    }
  }
  if (report.decisions.length === 0) {
    lines.push("");
    lines.push("Decisions: (none)");
  } else if (report.decisions.length > printed) {
    lines.push(`… and ${report.decisions.length - printed} more (summarized; see the report JSON for the full set)`);
  }

  lines.push("");
  lines.push("Risk summary:");
  const riskCodeTotal = report.decisions.reduce((n, d) => n + d.riskReasonCodes.length, 0);
  const riskFlagged = report.decisions.filter((d) => d.blockingRiskFlags.length > 0);
  lines.push(`- risk-related codes: ${riskCodeTotal}`);
  lines.push(`- candidates with blocking risk flags: ${riskFlagged.length}${riskFlagged.length > 0 ? ` (${riskFlagged.map((d) => d.candidateId).join(", ")})` : ""}`);
  lines.push(`- any risk reject: ${report.hasRiskReject ? "YES" : "no"}`);

  lines.push("");
  lines.push("CI verdict:");
  lines.push(`- any paper-enter:  ${report.hasPaperEnter ? "YES" : "no"}`);
  lines.push(`- any paper-reject: ${report.hasPaperReject ? "YES" : "no"}`);
  lines.push(`- any risk reject:  ${report.hasRiskReject ? "YES" : "no"}`);
  for (const r of report.ciFailReasons) lines.push(`- ${r}`);

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
