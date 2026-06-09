/**
 * Deterministic, offline, **PAPER-only** SNIPER POLICY CONFIG (Phase 5+ operator governance).
 *
 * The paper decision pipeline (`paper-decision.ts`) takes a small set of operator RULES. This module
 * adds an explicit, versioned **operator/risk policy** on top — so the assumptions a run is governed by
 * are written down, validated, and conservative by default, instead of implicit. A policy carries the
 * base decision rules (which drive the decision build), a set of tighten-only **enforcement** switches,
 * candidate-list **guards**, operator labels, and **paper sizing assumptions** that are LABELS / unitless
 * counts only (never a currency amount, profit, ROI, or win-rate claim).
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work. The package carries no chain
 * capability. A policy can only make the paper pipeline **more** conservative — `enforceSniperPolicy`
 * may downgrade a SIMULATED `paper-enter` to `watch`/`paper-reject` or skip a candidate, but can NEVER
 * turn a non-enter into an enter, and NEVER enables any live behaviour. It carries no wall-clock time.
 *
 * Nothing here is a trade signal, an order, or a profitability claim. `maxPaperPositionUnits` is a
 * SIMULATED unit cap (not a currency amount); `budgetLabel` is an operator LABEL (not real funds).
 */

import { redactString } from "@soulmaker/security";
import {
  validatePaperSniperDecisionReport,
  type SniperDecisionRules,
  type SniperPaperDecisionReport,
  type SniperDecisionEntry,
  type SniperDecision,
} from "./paper-decision.js";
import {
  validateSniperTokenPreflightReport,
  type SniperTokenPreflightReport,
  type SniperPreflightEntry,
} from "./token-preflight.js";
import type { SniperDecisionReasonCode } from "./decision-reason-codes.js";

/** Stable schema identifier for the policy config. Bump only on a breaking change. */
export const SNIPER_POLICY_CONFIG_SCHEMA_VERSION = "sniper.policy.config.v1";

/** The banner that prefixes every policy config (required label). */
export const SNIPER_POLICY_CONFIG_BANNER = "SIMULATED PAPER-ONLY SNIPER POLICY CONFIG";

/** Required disclaimer statements carried by every policy config (stable order). */
export const SNIPER_POLICY_CONFIG_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER POLICY CONFIG — an explicit, versioned operator/risk policy for the paper decision pipeline.",
  "Conservative by default; a policy can ONLY make the paper pipeline more conservative — enforcement may downgrade a SIMULATED paper-enter to watch/reject or skip a candidate, never the reverse.",
  "It enables NO live behaviour: no wallet, key, signing, sending, or transaction planning is configurable here.",
  "Paper sizing assumptions are LABELS / unitless simulated counts only — `budgetLabel` is an operator label (not real funds) and `maxPaperPositionUnits` is a simulated unit cap (not a currency amount).",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

/** Thrown when policy-config INPUT or a produced config is structurally invalid. */
export class SniperPolicyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperPolicyConfigError";
  }
}

// --- model -------------------------------------------------------------------

/** How a candidate list's duplicate mints are treated by policy. */
export type SniperDuplicateMintPolicy = "allow" | "warn" | "reject";

const DUPLICATE_MINT_POLICIES: ReadonlySet<string> = new Set(["allow", "warn", "reject"]);

/** Paper sizing assumptions — LABELS / unitless simulated counts only (no currency / profit claims). */
export interface SniperPaperSizing {
  /** Operator LABEL for the simulated budget (e.g. "small-test"). NEVER a currency amount. */
  budgetLabel: string | null;
  /** A SIMULATED unit cap per paper position (unitless; not a currency amount). */
  maxPaperPositionUnits: number | null;
  /** Cap on how many candidates may reach a SIMULATED paper-enter in one run. */
  maxCandidatesToPaperEnter: number | null;
}

/** The full, deterministic, JSON-serializable policy config. */
export interface SniperPolicyConfig {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  policyLabel: string | null;
  operatorLabels: string[];
  // --- base decision rules (drive the decision build) ---
  requirePreflightPass: boolean;
  maxRiskScore: number | null;
  minObservedLiquidityUsd: number | null;
  denyMints: string[];
  // --- tighten-only enforcement ---
  /** The decision-mode gate: when false, no candidate may reach a SIMULATED paper-enter. */
  allowPaperEnter: boolean;
  /** When true, a candidate the preflight could not assess (unknown / no preflight) is rejected. */
  failClosedOnUnknownPreflight: boolean;
  /** When true, a paper-enter with NO supplied risk data is downgraded to watch. */
  failClosedOnMissingRisk: boolean;
  /** Risk flag ids that hard-block a candidate (paper-reject) when present in its preflight risk. */
  disallowedRiskFlags: string[];
  // --- candidate-list guards ---
  /** A run with more candidates than this is flagged (never silently truncated). */
  maxCandidatesPerRun: number | null;
  /** How duplicate mints are treated: allow (silent) / warn / reject (skip the duplicates). */
  duplicateMintPolicy: SniperDuplicateMintPolicy;
  // --- paper sizing assumptions (labels / units only) ---
  paperSizing: SniperPaperSizing;
  warnings: string[];
  notes: string[];
}

/** Everything {@link normalizeSniperPolicyConfig} accepts (operator-friendly raw input). */
export interface NormalizeSniperPolicyConfigInput {
  policyLabel?: string | null;
  operatorLabels?: string[];
  requirePreflightPass?: boolean;
  maxRiskScore?: number | null;
  minObservedLiquidityUsd?: number | null;
  denyMints?: string[];
  allowPaperEnter?: boolean;
  failClosedOnUnknownPreflight?: boolean;
  failClosedOnMissingRisk?: boolean;
  disallowedRiskFlags?: string[];
  maxCandidatesPerRun?: number | null;
  duplicateMintPolicy?: SniperDuplicateMintPolicy;
  paperSizing?: {
    budgetLabel?: string | null;
    maxPaperPositionUnits?: number | null;
    maxCandidatesToPaperEnter?: number | null;
  };
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optBool(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new SniperPolicyConfigError(`policy.${name} must be a boolean when present`);
  return value;
}

function optNonNegNumber(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SniperPolicyConfigError(`policy.${name} must be a non-negative finite number when present`);
  }
  return value;
}

function optNonNegInt(value: unknown, name: string): number | null {
  const n = optNonNegNumber(value, name);
  if (n !== null && !Number.isInteger(n)) {
    throw new SniperPolicyConfigError(`policy.${name} must be a non-negative integer when present`);
  }
  return n;
}

function optString(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new SniperPolicyConfigError(`policy.${name} must be a string when present`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Read an optional string[] (trimmed, deduped, non-empty, sorted) for a list-like policy field. */
function optStringSet(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new SniperPolicyConfigError(`policy.${name} must be an array of strings when present`);
  }
  return [...new Set((value as string[]).map((s) => s.trim()).filter((s) => s.length > 0))].sort();
}

// --- normalize (build a canonical, conservative config from raw input) -------

/**
 * Normalize operator-friendly raw input into a canonical {@link SniperPolicyConfig}. Pure, non-mutating,
 * and idempotent. Every field is optional; an absent field takes a CONSERVATIVE default (preflight pass
 * required, fail-closed on unknown preflight and on missing risk, duplicate mints warned). The result
 * NEVER enables live behaviour. Throws {@link SniperPolicyConfigError} on a present-but-wrong field.
 */
export function normalizeSniperPolicyConfig(input: NormalizeSniperPolicyConfigInput = {}): SniperPolicyConfig {
  if (!isObject(input)) throw new SniperPolicyConfigError("policy config input must be an object");

  const duplicateMintPolicyRaw = input.duplicateMintPolicy;
  if (duplicateMintPolicyRaw !== undefined && (typeof duplicateMintPolicyRaw !== "string" || !DUPLICATE_MINT_POLICIES.has(duplicateMintPolicyRaw))) {
    throw new SniperPolicyConfigError('policy.duplicateMintPolicy must be "allow" | "warn" | "reject"');
  }
  const sizingRaw = input.paperSizing;
  if (sizingRaw !== undefined && sizingRaw !== null && !isObject(sizingRaw)) {
    throw new SniperPolicyConfigError("policy.paperSizing must be an object when present");
  }
  const sizing = (sizingRaw ?? {}) as Record<string, unknown>;

  const config: SniperPolicyConfig = {
    schemaVersion: SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
    banner: SNIPER_POLICY_CONFIG_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_POLICY_CONFIG_DISCLAIMERS],
    policyLabel: optString(input.policyLabel, "policyLabel"),
    operatorLabels: optStringSet(input.operatorLabels, "operatorLabels"),
    requirePreflightPass: optBool(input.requirePreflightPass, "requirePreflightPass", true),
    maxRiskScore: optNonNegNumber(input.maxRiskScore, "maxRiskScore"),
    minObservedLiquidityUsd: optNonNegNumber(input.minObservedLiquidityUsd, "minObservedLiquidityUsd"),
    denyMints: optStringSet(input.denyMints, "denyMints"),
    allowPaperEnter: optBool(input.allowPaperEnter, "allowPaperEnter", true),
    failClosedOnUnknownPreflight: optBool(input.failClosedOnUnknownPreflight, "failClosedOnUnknownPreflight", true),
    failClosedOnMissingRisk: optBool(input.failClosedOnMissingRisk, "failClosedOnMissingRisk", true),
    disallowedRiskFlags: optStringSet(input.disallowedRiskFlags, "disallowedRiskFlags"),
    maxCandidatesPerRun: optNonNegInt(input.maxCandidatesPerRun, "maxCandidatesPerRun"),
    duplicateMintPolicy: (duplicateMintPolicyRaw as SniperDuplicateMintPolicy) ?? "warn",
    paperSizing: {
      budgetLabel: optString(sizing.budgetLabel, "paperSizing.budgetLabel"),
      maxPaperPositionUnits: optNonNegNumber(sizing.maxPaperPositionUnits, "paperSizing.maxPaperPositionUnits"),
      maxCandidatesToPaperEnter: optNonNegInt(sizing.maxCandidatesToPaperEnter, "paperSizing.maxCandidatesToPaperEnter"),
    },
    warnings: [],
    notes: [],
  };

  const warnings: string[] = [];
  if (!config.allowPaperEnter) warnings.push("paper-enter is disabled by policy — no candidate can reach a simulated paper-enter.");
  if (config.maxRiskScore === null) warnings.push("no maxRiskScore set — risk-score capping is off (the preflight pass gate still applies).");
  config.warnings = warnings;
  config.notes = [
    "Conservative by default. This policy can ONLY tighten the paper pipeline; it never loosens it or enables live behaviour.",
    "Paper sizing assumptions are labels / simulated units — never a currency amount, profit, ROI, or win-rate claim.",
  ];
  return config;
}

// --- derive base decision rules ----------------------------------------------

/**
 * Project a policy's base-rule fields onto the existing {@link SniperDecisionRules} the decision builder
 * consumes. Pure. The richer policy switches (allowPaperEnter, fail-closed, disallowed flags, sizing,
 * guards) are NOT expressible as decision rules; they are applied by {@link enforceSniperPolicy}.
 */
export function deriveSniperDecisionRules(policy: SniperPolicyConfig): SniperDecisionRules {
  return {
    requirePreflightPass: policy.requirePreflightPass,
    maxRiskScore: policy.maxRiskScore,
    minObservedLiquidityUsd: policy.minObservedLiquidityUsd,
    denyMints: [...policy.denyMints],
  };
}

// --- enforcement (tighten-only) ----------------------------------------------

/** Options for {@link enforceSniperPolicy}. */
export interface EnforceSniperPolicyOptions {
  /** The preflight report this decision was built from — gives per-candidate risk visibility. */
  preflight?: unknown;
}

/** Recompute the decision-report aggregates + CI mirror after decisions were adjusted. */
function recomputeAggregates(
  base: SniperPaperDecisionReport,
  decisions: SniperDecisionEntry[],
  extraWarnings: string[],
  extraNotes: string[],
): SniperPaperDecisionReport {
  const count = (d: SniperDecision): number => decisions.filter((e) => e.decision === d).length;
  const skipCount = count("skip");
  const watchCount = count("watch");
  const paperEnterCount = count("paper-enter");
  const paperRejectCount = count("paper-reject");
  const unknownCount = count("unknown");
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

  return {
    ...base,
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
    warnings: [...base.warnings, ...extraWarnings],
    notes: [...base.notes, ...extraNotes],
  };
}

/**
 * INTERNAL building block (consumed by the v2 decision report; not part of the public package
 * surface): the enforced report PLUS the machine-readable policy reason codes emitted by the SAME
 * tighten-only transforms — never derived from the free-text reasons.
 */
export interface SniperPolicyEnforcementAnalysis {
  report: SniperPaperDecisionReport;
  /** candidateId → policy enforcement codes in emission order (empty array when untouched). */
  policyReasonCodesById: Record<string, SniperDecisionReasonCode[]>;
  /** Report-level (run-wide) policy codes in emission order. */
  reportReasonCodes: SniperDecisionReasonCode[];
}

/**
 * Apply a {@link SniperPolicyConfig} to a built decision report, returning a NEW, schema-valid report
 * that is at least as conservative PLUS the per-candidate policy reason codes. Same semantics as
 * {@link enforceSniperPolicy} (which is implemented on top of this). Pure and non-mutating.
 */
export function enforceSniperPolicyWithReasonCodes(
  reportInput: unknown,
  policyInput: unknown,
  opts: EnforceSniperPolicyOptions = {},
): SniperPolicyEnforcementAnalysis {
  let report: SniperPaperDecisionReport;
  try {
    report = validatePaperSniperDecisionReport(reportInput);
  } catch (err) {
    throw new SniperPolicyConfigError(`decision report is invalid: ${(err as Error).message}`);
  }
  const policy = validateSniperPolicyConfig(policyInput);

  let preflightById = new Map<string, SniperPreflightEntry>();
  if (opts.preflight !== undefined && opts.preflight !== null) {
    let pf: SniperTokenPreflightReport;
    try {
      pf = validateSniperTokenPreflightReport(opts.preflight);
    } catch (err) {
      throw new SniperPolicyConfigError(`preflight report is invalid: ${(err as Error).message}`);
    }
    preflightById = new Map(pf.candidates.map((e) => [e.candidateId, e]));
  }

  const extraWarnings: string[] = [];
  const extraNotes: string[] = [];
  const reportReasonCodes: SniperDecisionReasonCode[] = [];
  const policyReasonCodesById: Record<string, SniperDecisionReasonCode[]> = {};

  // Candidate-list guards (reported; maxCandidatesPerRun never truncates).
  if (policy.maxCandidatesPerRun !== null && report.candidateCount > policy.maxCandidatesPerRun) {
    extraWarnings.push(`policy: run has ${report.candidateCount} candidate(s), over the maxCandidatesPerRun of ${policy.maxCandidatesPerRun}.`);
    reportReasonCodes.push("policy-max-candidates-per-run-exceeded");
  }
  const mintCounts = new Map<string, number>();
  for (const d of report.decisions) mintCounts.set(d.mint, (mintCounts.get(d.mint) ?? 0) + 1);
  const duplicateMints = new Set([...mintCounts.entries()].filter(([, n]) => n > 1).map(([m]) => m));

  // First pass: per-candidate tighten-only transforms (deterministic, candidate order preserved).
  let paperEnterSeen = 0;
  const maxEnter = policy.paperSizing.maxCandidatesToPaperEnter;
  const adjusted: SniperDecisionEntry[] = report.decisions.map((entry) => {
    let decision = entry.decision;
    const reasons = [...entry.reasons];
    const codes: SniperDecisionReasonCode[] = [];
    let blockingRiskFlags = entry.blockingRiskFlags;
    const pf = preflightById.get(entry.candidateId);

    const downgrade = (to: SniperDecision, reason: string, code: SniperDecisionReasonCode): void => {
      decision = to;
      reasons.push(`policy ⛔ ${reason}`);
      codes.push(code);
    };

    // duplicateMintPolicy: reject ⇒ skip the duplicate-mint candidates.
    if (policy.duplicateMintPolicy === "reject" && duplicateMints.has(entry.mint) && decision !== "skip") {
      downgrade("skip", `duplicate mint rejected by policy (${entry.mint})`, "policy-duplicate-mint");
    }

    // disallowedRiskFlags: a candidate whose preflight risk carries a disallowed flag is rejected.
    if (decision !== "skip" && pf?.risk && policy.disallowedRiskFlags.length > 0) {
      const hit = pf.risk.topFlags.filter((f) => policy.disallowedRiskFlags.includes(f.id));
      if (hit.length > 0 && decision !== "paper-reject") {
        blockingRiskFlags = hit.map((f) => ({ id: f.id, severity: f.severity, title: f.title }));
        downgrade("paper-reject", `disallowed risk flag(s): ${hit.map((f) => f.id).join(", ")}`, "policy-disallowed-risk-flag");
      }
    }

    // failClosedOnUnknownPreflight: a watch driven by an unknown / absent preflight ⇒ reject.
    if (policy.failClosedOnUnknownPreflight && decision === "watch") {
      const status = entry.preflightStatus;
      if (status === "unknown" || status === null) {
        downgrade("paper-reject", "fail-closed: preflight could not assess this candidate", "policy-fail-closed-unknown-preflight");
      }
    }

    // The remaining transforms only touch a (still) paper-enter.
    if (decision === "paper-enter") {
      // failClosedOnMissingRisk: a paper-enter with no supplied risk data ⇒ watch.
      if (policy.failClosedOnMissingRisk && pf && pf.risk === null) {
        downgrade("watch", "fail-closed: paper-enter has no supplied risk data", "policy-fail-closed-missing-risk");
      } else if (!policy.allowPaperEnter) {
        // allowPaperEnter=false: the decision-mode gate.
        downgrade("watch", "paper-enter disabled by policy", "policy-paper-enter-disabled");
      } else if (maxEnter !== null && paperEnterSeen >= maxEnter) {
        // maxCandidatesToPaperEnter: cap reached ⇒ the excess is watched.
        downgrade("watch", `paper-enter cap of ${maxEnter} reached`, "policy-paper-enter-cap-exceeded");
      } else {
        paperEnterSeen += 1;
        codes.push("policy-allowed-paper-enter");
      }
    }

    policyReasonCodesById[entry.candidateId] = codes;
    // `policy-allowed-paper-enter` is informational — the entry itself is unchanged in that case.
    return decision === entry.decision && blockingRiskFlags === entry.blockingRiskFlags
      ? entry
      : { ...entry, decision, reasons, blockingRiskFlags };
  });

  if (policy.duplicateMintPolicy === "warn" && duplicateMints.size > 0) {
    extraWarnings.push(`policy: ${duplicateMints.size} duplicate mint(s) present: ${[...duplicateMints].sort().join(", ")}.`);
    reportReasonCodes.push("duplicate-mints-present");
  }
  extraNotes.push(`policy "${policy.policyLabel ?? "(unlabeled)"}" applied (tighten-only).`);

  return {
    report: recomputeAggregates(report, adjusted, extraWarnings, extraNotes),
    policyReasonCodesById,
    reportReasonCodes,
  };
}

/**
 * Apply a {@link SniperPolicyConfig} to a built decision report, returning a NEW, schema-valid report
 * that is at least as conservative. Pure and non-mutating. Enforcement is **tighten-only** — it may
 * downgrade a SIMULATED `paper-enter` to `watch`/`paper-reject` or `skip` a duplicate mint, but never the
 * reverse, and never enables live behaviour. When a preflight report is supplied (via `opts.preflight`,
 * strictly validated), per-candidate risk visibility powers `failClosedOnMissingRisk` and
 * `disallowedRiskFlags`. Carries no wall-clock time. Throws {@link SniperPolicyConfigError} on a
 * non-report / non-config / wrong-preflight input.
 */
export function enforceSniperPolicy(
  reportInput: unknown,
  policyInput: unknown,
  opts: EnforceSniperPolicyOptions = {},
): SniperPaperDecisionReport {
  return enforceSniperPolicyWithReasonCodes(reportInput, policyInput, opts).report;
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a canonical {@link SniperPolicyConfig} and return it narrowed. A backstop
 * mirroring the package's sibling validators. Throws {@link SniperPolicyConfigError} on the first
 * problem. Pure.
 */
export function validateSniperPolicyConfig(value: unknown): SniperPolicyConfig {
  if (!isObject(value)) throw new SniperPolicyConfigError("policy config must be a JSON object");
  if (value.schemaVersion !== SNIPER_POLICY_CONFIG_SCHEMA_VERSION) {
    throw new SniperPolicyConfigError(`policy config.schemaVersion must be "${SNIPER_POLICY_CONFIG_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_POLICY_CONFIG_BANNER) {
    throw new SniperPolicyConfigError(`policy config.banner must be "${SNIPER_POLICY_CONFIG_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperPolicyConfigError(`policy config.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperPolicyConfigError("policy config.disclaimers must be a non-empty array");
  }
  if (value.policyLabel !== null && typeof value.policyLabel !== "string") {
    throw new SniperPolicyConfigError("policy config.policyLabel must be a string or null");
  }
  for (const f of ["requirePreflightPass", "allowPaperEnter", "failClosedOnUnknownPreflight", "failClosedOnMissingRisk"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperPolicyConfigError(`policy config.${f} must be a boolean`);
  }
  for (const f of ["maxRiskScore", "minObservedLiquidityUsd"] as const) {
    if (value[f] !== null && (typeof value[f] !== "number" || !Number.isFinite(value[f]) || (value[f] as number) < 0)) {
      throw new SniperPolicyConfigError(`policy config.${f} must be a non-negative number or null`);
    }
  }
  if (value.maxCandidatesPerRun !== null && (typeof value.maxCandidatesPerRun !== "number" || !Number.isInteger(value.maxCandidatesPerRun) || value.maxCandidatesPerRun < 0)) {
    throw new SniperPolicyConfigError("policy config.maxCandidatesPerRun must be a non-negative integer or null");
  }
  if (typeof value.duplicateMintPolicy !== "string" || !DUPLICATE_MINT_POLICIES.has(value.duplicateMintPolicy)) {
    throw new SniperPolicyConfigError('policy config.duplicateMintPolicy must be "allow" | "warn" | "reject"');
  }
  for (const key of ["operatorLabels", "denyMints", "disallowedRiskFlags", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperPolicyConfigError(`policy config.${key} must be an array of strings`);
    }
  }
  if (!isObject(value.paperSizing)) throw new SniperPolicyConfigError("policy config.paperSizing must be an object");
  const sizing = value.paperSizing as Record<string, unknown>;
  if (sizing.budgetLabel !== null && typeof sizing.budgetLabel !== "string") {
    throw new SniperPolicyConfigError("policy config.paperSizing.budgetLabel must be a string or null");
  }
  if (sizing.maxPaperPositionUnits !== null && (typeof sizing.maxPaperPositionUnits !== "number" || !Number.isFinite(sizing.maxPaperPositionUnits) || (sizing.maxPaperPositionUnits as number) < 0)) {
    throw new SniperPolicyConfigError("policy config.paperSizing.maxPaperPositionUnits must be a non-negative number or null");
  }
  if (sizing.maxCandidatesToPaperEnter !== null && (typeof sizing.maxCandidatesToPaperEnter !== "number" || !Number.isInteger(sizing.maxCandidatesToPaperEnter) || (sizing.maxCandidatesToPaperEnter as number) < 0)) {
    throw new SniperPolicyConfigError("policy config.paperSizing.maxCandidatesToPaperEnter must be a non-negative integer or null");
  }
  return value as unknown as SniperPolicyConfig;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperPolicyConfig}. */
export interface FormatSniperPolicyConfigOptions {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable policy config. Deterministic and path-stable. Leads with the
 * PAPER-ONLY banner, lists the base rules + enforcement switches + guards + paper sizing assumptions, and
 * closes with the conservative-by-default disclaimers. The whole output is passed through the redactor.
 */
export function formatSniperPolicyConfig(
  config: SniperPolicyConfig,
  opts: FormatSniperPolicyConfigOptions = {},
): string {
  const header = `${config.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:   ${opts.label}`);
  lines.push(`policy:  ${config.policyLabel ?? "(unlabeled)"}`);
  if (config.operatorLabels.length > 0) lines.push(`operators: ${config.operatorLabels.join(", ")}`);

  lines.push("");
  lines.push("Decision rules:");
  lines.push(`- requirePreflightPass:    ${config.requirePreflightPass}`);
  lines.push(`- maxRiskScore:            ${config.maxRiskScore ?? "(none)"}`);
  lines.push(`- minObservedLiquidityUsd: ${config.minObservedLiquidityUsd ?? "(none)"}`);
  lines.push(`- denyMints:               ${config.denyMints.length > 0 ? config.denyMints.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Enforcement (tighten-only):");
  lines.push(`- allowPaperEnter:              ${config.allowPaperEnter}`);
  lines.push(`- failClosedOnUnknownPreflight: ${config.failClosedOnUnknownPreflight}`);
  lines.push(`- failClosedOnMissingRisk:      ${config.failClosedOnMissingRisk}`);
  lines.push(`- disallowedRiskFlags:          ${config.disallowedRiskFlags.length > 0 ? config.disallowedRiskFlags.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Candidate-list guards:");
  lines.push(`- maxCandidatesPerRun:  ${config.maxCandidatesPerRun ?? "(none)"}`);
  lines.push(`- duplicateMintPolicy:  ${config.duplicateMintPolicy}`);

  lines.push("");
  lines.push("Paper sizing assumptions (labels / simulated units — NOT currency or profit):");
  lines.push(`- budgetLabel:                ${config.paperSizing.budgetLabel ?? "(none)"}`);
  lines.push(`- maxPaperPositionUnits:      ${config.paperSizing.maxPaperPositionUnits ?? "(none)"}`);
  lines.push(`- maxCandidatesToPaperEnter:  ${config.paperSizing.maxCandidatesToPaperEnter ?? "(none)"}`);

  if (config.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of config.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of config.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of config.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
