/**
 * Deterministic, offline, **PAPER-only** SNIPER POLICY CONFIG **V2** (Sprint 48 — risk-limit
 * deepening, versioned and non-breaking).
 *
 * V2 = everything `sniper.policy.config.v1` carries, plus an explicit **policy mode** and structured
 * **risk limits** that speak the Sprint 46 reason-code vocabulary:
 *
 *   - `policyMode` — `conservative` | `balanced-paper` | `research-only`. A mode is a CONSISTENCY
 *     CONTRACT, not a loosener: `research-only` forbids paper-enter outright; `conservative` forbids
 *     turning the fail-closed switches off. A config whose explicit switches contradict its mode is
 *     REFUSED at normalize time (fail-closed — never silently "fixed").
 *   - `riskLimits.disallowedReasonCodes` — candidates whose v2 reason-code trail hits one of these
 *     are paper-rejected.
 *   - `riskLimits.disallowedPreflightStatuses` — `warn` / `unknown` / `fail` statuses that
 *     hard-reject (a `pass` cannot be disallowed; `fail` is already always rejected).
 *   - `riskLimits.maxWarningsPerCandidate` — a paper-enter whose preflight carries more warnings
 *     than this is downgraded to watch.
 *   - `riskLimits.requireRiskPresent` / `requireInspectionPresent` — candidates missing that section
 *     are surfaced (and any paper-enter downgraded to watch).
 *   - `riskLimits.requirePreflightInputArtifact` — DECLARATIVE: the operator promises a validated
 *     `sniper.preflight.input.v1` exists for the run; the safety gates (not this module) enforce it.
 *
 * The "maximum paper-enter count" limit remains `paperSizing.maxCandidatesToPaperEnter`, carried
 * unchanged from v1 (not duplicated).
 *
 * V1 is fully preserved: the v1 config keeps validating and enforcing unchanged, and
 * {@link upgradeSniperPolicyConfigV1ToV2} lifts a v1 config losslessly (mode derived from its
 * switches; new limits start at their conservative-neutral defaults). V2 enforcement REUSES the v1
 * tighten-only enforcement via a pure projection, then applies the v2-only limits — also strictly
 * tighten-only. Because the new limits act on reason-code trails, a v2 policy is consumed by the
 * codes-aware **v2 decision builder**; feeding it where only v1 semantics exist is refused, never
 * silently weakened.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work, enables no live behaviour,
 * and carries no wall-clock time. Nothing here is a trade signal or a profitability claim.
 */

import { redactString } from "@soulmaker/security";
import {
  normalizeSniperPolicyConfig,
  validateSniperPolicyConfig,
  enforceSniperPolicyWithReasonCodes,
  SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
  SNIPER_POLICY_CONFIG_BANNER,
  type SniperPolicyConfig,
  type NormalizeSniperPolicyConfigInput,
  type EnforceSniperPolicyOptions,
} from "./policy-config.js";
import type { SniperDecisionRules, SniperPaperDecisionReport, SniperDecisionEntry } from "./paper-decision.js";
import {
  validateSniperTokenPreflightReport,
  type SniperTokenPreflightReport,
  type SniperPreflightEntry,
} from "./token-preflight.js";
import { isSniperDecisionReasonCode, type SniperDecisionReasonCode } from "./decision-reason-codes.js";

/** Stable schema identifier for the v2 policy config. Bump only on a breaking change. */
export const SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION = "sniper.policy.config.v2";

/** The banner that prefixes every v2 policy config (required label). */
export const SNIPER_POLICY_CONFIG_V2_BANNER = "SIMULATED PAPER-ONLY SNIPER POLICY CONFIG V2";

/** Required disclaimer statements carried by every v2 policy config (stable order). */
export const SNIPER_POLICY_CONFIG_V2_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER POLICY CONFIG V2 — the v1 operator/risk policy plus an explicit policy mode and structured, reason-code-aware risk limits.",
  "Tighten-only: every v2 limit can only make the paper pipeline MORE conservative — downgrade a SIMULATED paper-enter or reject a candidate, never the reverse.",
  "A policy mode is a consistency contract: a config whose explicit switches contradict its mode is REFUSED, never silently adjusted.",
  "It enables NO live behaviour: no wallet, key, signing, sending, or transaction planning is configurable here.",
  "Paper sizing assumptions remain LABELS / unitless simulated counts only — never a currency amount, profit, ROI, or win-rate claim.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

/** Thrown when v2 policy INPUT or a produced config is structurally invalid or self-contradictory. */
export class SniperPolicyConfigV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperPolicyConfigV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** The explicit policy modes (stable). */
export const SNIPER_POLICY_MODES = ["conservative", "balanced-paper", "research-only"] as const;

/** One of the explicit policy modes. */
export type SniperPolicyMode = (typeof SNIPER_POLICY_MODES)[number];

/** Preflight statuses a v2 policy may disallow (`pass` can never be disallowed). */
const DISALLOWABLE_STATUSES: ReadonlySet<string> = new Set(["warn", "unknown", "fail"]);

/** The structured, reason-code-aware risk limits (all tighten-only). */
export interface SniperPolicyV2RiskLimits {
  /** Candidates whose v2 reason-code trail hits one of these are paper-rejected. Sorted, deduped. */
  disallowedReasonCodes: SniperDecisionReasonCode[];
  /** Preflight statuses that hard-reject (subset of warn/unknown/fail). Sorted, deduped. */
  disallowedPreflightStatuses: string[];
  /** A paper-enter whose preflight carries more warnings than this is downgraded to watch. */
  maxWarningsPerCandidate: number | null;
  /** Candidates without risk data are surfaced; any paper-enter among them is downgraded. */
  requireRiskPresent: boolean;
  /** Candidates without inspection data are surfaced; any paper-enter among them is downgraded. */
  requireInspectionPresent: boolean;
  /** DECLARATIVE: a validated `sniper.preflight.input.v1` is required for the run (gates enforce it). */
  requirePreflightInputArtifact: boolean;
}

/** The full, deterministic, JSON-serializable v2 policy config. */
export interface SniperPolicyConfigV2 extends Omit<SniperPolicyConfig, "schemaVersion" | "banner"> {
  schemaVersion: string;
  banner: string;
  /** The explicit policy mode (a consistency contract; see the module doc). */
  policyMode: SniperPolicyMode;
  /** The structured risk limits (tighten-only). */
  riskLimits: SniperPolicyV2RiskLimits;
}

/** Everything {@link normalizeSniperPolicyConfigV2} accepts (operator-friendly raw input). */
export interface NormalizeSniperPolicyConfigV2Input extends NormalizeSniperPolicyConfigInput {
  policyMode?: SniperPolicyMode;
  riskLimits?: {
    disallowedReasonCodes?: string[];
    disallowedPreflightStatuses?: string[];
    maxWarningsPerCandidate?: number | null;
    requireRiskPresent?: boolean;
    requireInspectionPresent?: boolean;
    requirePreflightInputArtifact?: boolean;
  };
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Derive the mode a config's switches imply (used when no explicit mode is supplied). */
function deriveMode(v1: SniperPolicyConfig): SniperPolicyMode {
  if (!v1.allowPaperEnter) return "research-only";
  if (v1.requirePreflightPass && v1.failClosedOnUnknownPreflight && v1.failClosedOnMissingRisk) return "conservative";
  return "balanced-paper";
}

/** Refuse a config whose explicit switches contradict its (explicit) mode. Fail-closed. */
function checkModeConsistency(mode: SniperPolicyMode, v1: SniperPolicyConfig): void {
  if (mode === "research-only" && v1.allowPaperEnter) {
    throw new SniperPolicyConfigV2Error('policyMode "research-only" forbids allowPaperEnter=true (research never paper-enters)');
  }
  if (mode === "conservative") {
    for (const f of ["requirePreflightPass", "failClosedOnUnknownPreflight", "failClosedOnMissingRisk"] as const) {
      if (!v1[f]) {
        throw new SniperPolicyConfigV2Error(`policyMode "conservative" forbids ${f}=false (fail-closed switches must stay on)`);
      }
    }
  }
}

// --- normalize ----------------------------------------------------------------

/**
 * Normalize operator-friendly raw input into a canonical {@link SniperPolicyConfigV2}. Pure,
 * non-mutating, idempotent. The v1 fields take the SAME conservative defaults as v1 (the v1
 * normalizer does that work). An absent `policyMode` is DERIVED from the switches; an explicit mode
 * is CHECKED against them and a contradiction is REFUSED. Risk limits default to neutral
 * (`requireRiskPresent` mirrors `failClosedOnMissingRisk`); `requireRiskPresent=true` with
 * `failClosedOnMissingRisk=false` is refused as self-contradictory. The result never enables live
 * behaviour. Throws {@link SniperPolicyConfigV2Error} on any problem.
 */
export function normalizeSniperPolicyConfigV2(input: NormalizeSniperPolicyConfigV2Input = {}): SniperPolicyConfigV2 {
  if (!isObject(input)) throw new SniperPolicyConfigV2Error("policy config v2 input must be an object");

  // 1) The v1 surface, via the real v1 normalizer (same defaults, same refusals).
  const { policyMode: modeRaw, riskLimits: limitsRaw, ...v1Input } = input;
  let v1: SniperPolicyConfig;
  try {
    v1 = normalizeSniperPolicyConfig(v1Input);
  } catch (err) {
    throw new SniperPolicyConfigV2Error((err as Error).message);
  }

  // 2) Mode: derived when absent; checked (fail-closed) when explicit.
  if (modeRaw !== undefined && !SNIPER_POLICY_MODES.includes(modeRaw as SniperPolicyMode)) {
    throw new SniperPolicyConfigV2Error('policy.policyMode must be "conservative" | "balanced-paper" | "research-only"');
  }
  let policyMode: SniperPolicyMode;
  if (modeRaw === undefined) {
    policyMode = deriveMode(v1);
  } else {
    policyMode = modeRaw as SniperPolicyMode;
    // research-only PRESETS allowPaperEnter=false when the operator did not set it explicitly.
    if (policyMode === "research-only" && input.allowPaperEnter === undefined) {
      v1 = { ...v1, allowPaperEnter: false, warnings: [...v1.warnings] };
      if (!v1.warnings.some((w) => /paper-enter is disabled/.test(w))) {
        v1.warnings.push("paper-enter is disabled by policy — no candidate can reach a simulated paper-enter.");
      }
    }
    checkModeConsistency(policyMode, v1);
  }

  // 3) Risk limits (tighten-only; conservative-neutral defaults).
  if (limitsRaw !== undefined && !isObject(limitsRaw)) {
    throw new SniperPolicyConfigV2Error("policy.riskLimits must be an object when present");
  }
  const lr = limitsRaw ?? {};

  const codes: SniperDecisionReasonCode[] = [];
  if (lr.disallowedReasonCodes !== undefined) {
    if (!Array.isArray(lr.disallowedReasonCodes)) {
      throw new SniperPolicyConfigV2Error("policy.riskLimits.disallowedReasonCodes must be an array of reason codes");
    }
    for (const code of lr.disallowedReasonCodes) {
      if (!isSniperDecisionReasonCode(code)) {
        throw new SniperPolicyConfigV2Error(`policy.riskLimits.disallowedReasonCodes contains an unknown reason code "${String(code)}"`);
      }
      codes.push(code);
    }
  }
  const statuses: string[] = [];
  if (lr.disallowedPreflightStatuses !== undefined) {
    if (!Array.isArray(lr.disallowedPreflightStatuses) || lr.disallowedPreflightStatuses.some((s) => typeof s !== "string")) {
      throw new SniperPolicyConfigV2Error("policy.riskLimits.disallowedPreflightStatuses must be an array of strings");
    }
    for (const s of lr.disallowedPreflightStatuses) {
      if (!DISALLOWABLE_STATUSES.has(s)) {
        throw new SniperPolicyConfigV2Error(`policy.riskLimits.disallowedPreflightStatuses may only contain warn|unknown|fail (got "${s}"; a pass can never be disallowed)`);
      }
      statuses.push(s);
    }
  }
  let maxWarnings: number | null = null;
  if (lr.maxWarningsPerCandidate !== undefined && lr.maxWarningsPerCandidate !== null) {
    const n = lr.maxWarningsPerCandidate;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new SniperPolicyConfigV2Error("policy.riskLimits.maxWarningsPerCandidate must be a non-negative integer or null");
    }
    maxWarnings = n;
  }
  const optBool = (v: unknown, name: string, fallback: boolean): boolean => {
    if (v === undefined || v === null) return fallback;
    if (typeof v !== "boolean") throw new SniperPolicyConfigV2Error(`policy.riskLimits.${name} must be a boolean when present`);
    return v;
  };
  const requireRiskPresent = optBool(lr.requireRiskPresent, "requireRiskPresent", v1.failClosedOnMissingRisk);
  const requireInspectionPresent = optBool(lr.requireInspectionPresent, "requireInspectionPresent", false);
  const requirePreflightInputArtifact = optBool(lr.requirePreflightInputArtifact, "requirePreflightInputArtifact", false);

  if (requireRiskPresent && !v1.failClosedOnMissingRisk) {
    throw new SniperPolicyConfigV2Error(
      "policy.riskLimits.requireRiskPresent=true contradicts failClosedOnMissingRisk=false (a required risk section must fail closed)",
    );
  }

  const riskLimits: SniperPolicyV2RiskLimits = {
    disallowedReasonCodes: [...new Set(codes)].sort() as SniperDecisionReasonCode[],
    disallowedPreflightStatuses: [...new Set(statuses)].sort(),
    maxWarningsPerCandidate: maxWarnings,
    requireRiskPresent,
    requireInspectionPresent,
    requirePreflightInputArtifact,
  };

  return {
    ...v1,
    schemaVersion: SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
    banner: SNIPER_POLICY_CONFIG_V2_BANNER,
    disclaimers: [...SNIPER_POLICY_CONFIG_V2_DISCLAIMERS],
    policyMode,
    riskLimits,
    notes: [
      ...v1.notes,
      `policy mode: ${policyMode} (${modeRaw === undefined ? "derived from the switches" : "explicit, consistency-checked"}).`,
      "The maximum paper-enter count limit is paperSizing.maxCandidatesToPaperEnter (carried from v1, not duplicated).",
    ],
  };
}

// --- v1 → v2 adapter ----------------------------------------------------------

/**
 * Lift an existing canonical `sniper.policy.config.v1` into a v2 config. Pure and lossless: every v1
 * field is carried verbatim, `policyMode` is DERIVED from the v1 switches (research-only when
 * paper-enter is off; conservative when all fail-closed switches are on; balanced-paper otherwise),
 * and the new risk limits start at their conservative-neutral defaults (`requireRiskPresent` mirrors
 * `failClosedOnMissingRisk`; nothing else is disallowed/required). Throws
 * {@link SniperPolicyConfigV2Error} when the input is not a valid v1 config.
 */
export function upgradeSniperPolicyConfigV1ToV2(value: unknown): SniperPolicyConfigV2 {
  let v1: SniperPolicyConfig;
  try {
    v1 = validateSniperPolicyConfig(value);
  } catch (err) {
    throw new SniperPolicyConfigV2Error(`v1 policy config is invalid: ${(err as Error).message}`);
  }
  return {
    ...v1,
    schemaVersion: SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
    banner: SNIPER_POLICY_CONFIG_V2_BANNER,
    disclaimers: [...SNIPER_POLICY_CONFIG_V2_DISCLAIMERS],
    policyMode: deriveMode(v1),
    riskLimits: {
      disallowedReasonCodes: [],
      disallowedPreflightStatuses: [],
      maxWarningsPerCandidate: null,
      requireRiskPresent: v1.failClosedOnMissingRisk,
      requireInspectionPresent: false,
      requirePreflightInputArtifact: false,
    },
    notes: [
      ...v1.notes,
      "Upgraded from v1: the policy mode was derived from the v1 switches and the v2 risk limits start at conservative-neutral defaults.",
    ],
  };
}

// --- projection (v2 → v1 view, for reusing the v1 enforcement) ----------------

/**
 * Project a v2 config onto its exact v1 surface (schema/banner/disclaimers swapped to v1; every v1
 * field carried verbatim). INTERNAL building block for reusing the v1 tighten-only enforcement —
 * the v2-only limits are intentionally NOT expressible here and are applied by
 * {@link enforceSniperPolicyV2WithReasonCodes} afterwards. Pure.
 */
export function projectSniperPolicyConfigV2ToV1(policy: SniperPolicyConfigV2): SniperPolicyConfig {
  const {
    schemaVersion: _schemaVersion,
    banner: _banner,
    disclaimers: _disclaimers,
    policyMode: _policyMode,
    riskLimits: _riskLimits,
    ...rest
  } = policy;
  return validateSniperPolicyConfig(
    normalizeSniperPolicyConfig({
      policyLabel: rest.policyLabel,
      operatorLabels: rest.operatorLabels,
      requirePreflightPass: rest.requirePreflightPass,
      maxRiskScore: rest.maxRiskScore,
      minObservedLiquidityUsd: rest.minObservedLiquidityUsd,
      denyMints: rest.denyMints,
      allowPaperEnter: rest.allowPaperEnter,
      failClosedOnUnknownPreflight: rest.failClosedOnUnknownPreflight,
      failClosedOnMissingRisk: rest.failClosedOnMissingRisk,
      disallowedRiskFlags: rest.disallowedRiskFlags,
      maxCandidatesPerRun: rest.maxCandidatesPerRun,
      duplicateMintPolicy: rest.duplicateMintPolicy,
      paperSizing: rest.paperSizing,
    }),
  );
}

/** Project a v2 policy's base-rule fields onto the decision rules the builder consumes. Pure. */
export function deriveSniperDecisionRulesFromV2(policy: SniperPolicyConfigV2): SniperDecisionRules {
  return {
    requirePreflightPass: policy.requirePreflightPass,
    maxRiskScore: policy.maxRiskScore,
    minObservedLiquidityUsd: policy.minObservedLiquidityUsd,
    denyMints: [...policy.denyMints],
  };
}

// --- enforcement (tighten-only; v1 enforcement + v2 risk limits) ---------------

/** Options for {@link enforceSniperPolicyV2WithReasonCodes}. */
export interface EnforceSniperPolicyV2Options extends EnforceSniperPolicyOptions {
  /**
   * candidateId → the candidate's reason-code trail so far (cause codes + earlier policy codes).
   * Powers `disallowedReasonCodes`. Optional: without trails that limit can only see the codes the
   * v2 transforms themselves add.
   */
  trailsById?: Record<string, SniperDecisionReasonCode[]>;
}

/** The enforced report plus the v2 policy reason codes (mirrors the v1 analysis shape). */
export interface SniperPolicyV2EnforcementAnalysis {
  report: SniperPaperDecisionReport;
  policyReasonCodesById: Record<string, SniperDecisionReasonCode[]>;
  reportReasonCodes: SniperDecisionReasonCode[];
}

/**
 * Apply a {@link SniperPolicyConfigV2} to a built decision report: the v1 tighten-only enforcement
 * runs FIRST (via the exact v1 projection), then the v2 risk limits — disallowed preflight statuses
 * (reject), the per-candidate warning cap (paper-enter → watch), required risk/inspection sections
 * (surface + downgrade a paper-enter), and finally disallowed reason codes (reject), which see the
 * full trail including the codes added by the earlier transforms. Strictly tighten-only; never
 * enables live behaviour. Pure. Throws {@link SniperPolicyConfigV2Error} on invalid input.
 */
export function enforceSniperPolicyV2WithReasonCodes(
  reportInput: unknown,
  policyInput: unknown,
  opts: EnforceSniperPolicyV2Options = {},
): SniperPolicyV2EnforcementAnalysis {
  const policy = validateSniperPolicyConfigV2(policyInput);

  // 1) The v1 enforcement, unchanged, via the exact v1 projection.
  const v1View = projectSniperPolicyConfigV2ToV1(policy);
  let v1Result;
  try {
    v1Result = enforceSniperPolicyWithReasonCodes(reportInput, v1View, { preflight: opts.preflight });
  } catch (err) {
    throw new SniperPolicyConfigV2Error((err as Error).message);
  }

  let preflightById = new Map<string, SniperPreflightEntry>();
  if (opts.preflight !== undefined && opts.preflight !== null) {
    let pf: SniperTokenPreflightReport;
    try {
      pf = validateSniperTokenPreflightReport(opts.preflight);
    } catch (err) {
      throw new SniperPolicyConfigV2Error(`preflight report is invalid: ${(err as Error).message}`);
    }
    preflightById = new Map(pf.candidates.map((e) => [e.candidateId, e]));
  }

  const limits = policy.riskLimits;
  const policyReasonCodesById: Record<string, SniperDecisionReasonCode[]> = {};
  const extraWarnings: string[] = [];

  const adjusted: SniperDecisionEntry[] = v1Result.report.decisions.map((entry) => {
    let decision = entry.decision;
    const reasons = [...entry.reasons];
    const codes: SniperDecisionReasonCode[] = [...(v1Result.policyReasonCodesById[entry.candidateId] ?? [])];
    const pf = preflightById.get(entry.candidateId);

    const downgrade = (to: typeof decision, reason: string, code: SniperDecisionReasonCode): void => {
      decision = to;
      reasons.push(`policy ⛔ ${reason}`);
      codes.push(code);
    };

    // 2) Disallowed preflight statuses → paper-reject (skips stay skipped).
    if (
      decision !== "skip" &&
      decision !== "paper-reject" &&
      entry.preflightStatus !== null &&
      limits.disallowedPreflightStatuses.includes(entry.preflightStatus)
    ) {
      downgrade("paper-reject", `preflight status "${entry.preflightStatus}" is disallowed by policy v2`, "policy-disallowed-preflight-status");
    }

    // 3) Warning cap: a (still) paper-enter with too many preflight warnings → watch.
    if (decision === "paper-enter" && limits.maxWarningsPerCandidate !== null && pf && pf.warnings.length > limits.maxWarningsPerCandidate) {
      downgrade("watch", `preflight warning count ${pf.warnings.length} exceeds the policy v2 cap of ${limits.maxWarningsPerCandidate}`, "policy-max-warnings-exceeded");
    }

    // 4) Required sections: surface missing risk/inspection; a paper-enter among them → watch.
    if (decision !== "skip" && decision !== "paper-reject") {
      if (limits.requireRiskPresent && (!pf || pf.risk === null)) {
        if (decision === "paper-enter") {
          downgrade("watch", "policy v2 requires risk data and this candidate has none", "policy-missing-risk");
        } else if (!codes.includes("policy-missing-risk")) {
          reasons.push("policy ⚠ policy v2 requires risk data and this candidate has none");
          codes.push("policy-missing-risk");
        }
      }
      if (limits.requireInspectionPresent && (!pf || pf.inspection === null)) {
        if (decision === "paper-enter") {
          downgrade("watch", "policy v2 requires inspection data and this candidate has none", "policy-missing-inspection");
        } else if (!codes.includes("policy-missing-inspection")) {
          reasons.push("policy ⚠ policy v2 requires inspection data and this candidate has none");
          codes.push("policy-missing-inspection");
        }
      }
    }

    // 5) Disallowed reason codes — checked LAST so it sees the full trail (causes + policy codes).
    if (decision !== "skip" && decision !== "paper-reject" && limits.disallowedReasonCodes.length > 0) {
      const trail = [...(opts.trailsById?.[entry.candidateId] ?? []), ...codes];
      const hit = limits.disallowedReasonCodes.filter((c) => trail.includes(c));
      if (hit.length > 0) {
        downgrade("paper-reject", `reason code(s) disallowed by policy v2: ${hit.join(", ")}`, "policy-disallowed-reason-code");
      }
    }

    // `policy-allowed-paper-enter` means "survived EVERY tighten-only check" — if a v2 limit
    // downgraded the entry after the v1 pass allowed it, that code no longer holds: drop it.
    policyReasonCodesById[entry.candidateId] =
      decision === "paper-enter" ? codes : codes.filter((c) => c !== "policy-allowed-paper-enter");
    return decision === entry.decision && reasons.length === entry.reasons.length
      ? entry
      : { ...entry, decision, reasons };
  });

  // Recompute the aggregates exactly the way the v1 enforcement does (reuse via a second pass would
  // re-run transforms; instead recompute inline with the same rules the v1 module uses).
  const count = (d: SniperDecisionEntry["decision"]): number => adjusted.filter((e) => e.decision === d).length;
  const paperEnterCount = count("paper-enter");
  const paperRejectCount = count("paper-reject");
  const hasPaperEnter = paperEnterCount > 0;
  const hasRiskReject = adjusted.some((d) => d.decision === "paper-reject" && d.blockingRiskFlags.length > 0);
  const ciFailReasons: string[] = [];
  if (hasPaperEnter) {
    ciFailReasons.push(`${paperEnterCount} candidate(s) would paper-enter: ${adjusted.filter((d) => d.decision === "paper-enter").map((d) => d.candidateId).join(", ")}`);
  }
  if (hasRiskReject) {
    ciFailReasons.push(`${adjusted.filter((d) => d.decision === "paper-reject" && d.blockingRiskFlags.length > 0).length} candidate(s) rejected on risk`);
  }

  const report: SniperPaperDecisionReport = {
    ...v1Result.report,
    decisions: adjusted,
    skipCount: count("skip"),
    watchCount: count("watch"),
    paperEnterCount,
    paperRejectCount,
    unknownCount: count("unknown"),
    hasPaperEnter,
    hasPaperReject: paperRejectCount > 0,
    hasRiskReject,
    wouldFailOnPaperEnter: hasPaperEnter,
    wouldFailOnRisk: hasRiskReject,
    ciFailReasons,
    warnings: [...v1Result.report.warnings, ...extraWarnings],
    notes: [...v1Result.report.notes, `policy v2 risk limits applied (mode: ${policy.policyMode}; tighten-only).`],
  };

  return {
    report,
    policyReasonCodesById,
    reportReasonCodes: v1Result.reportReasonCodes,
  };
}

/** Convenience wrapper returning only the enforced report. Pure. */
export function enforceSniperPolicyV2(
  reportInput: unknown,
  policyInput: unknown,
  opts: EnforceSniperPolicyV2Options = {},
): SniperPaperDecisionReport {
  return enforceSniperPolicyV2WithReasonCodes(reportInput, policyInput, opts).report;
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a canonical {@link SniperPolicyConfigV2} and return it narrowed. The
 * v1 surface is validated by PROJECTING onto v1 and running the real v1 validator; the v2 additions
 * (mode + risk limits) are validated here, including the mode-consistency contract. Throws
 * {@link SniperPolicyConfigV2Error} on the first problem. Pure.
 */
export function validateSniperPolicyConfigV2(value: unknown): SniperPolicyConfigV2 {
  if (!isObject(value)) throw new SniperPolicyConfigV2Error("policy config v2 must be a JSON object");
  if (value.schemaVersion !== SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION) {
    throw new SniperPolicyConfigV2Error(`policy config v2.schemaVersion must be "${SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_POLICY_CONFIG_V2_BANNER) {
    throw new SniperPolicyConfigV2Error(`policy config v2.banner must be "${SNIPER_POLICY_CONFIG_V2_BANNER}"`);
  }
  // Validate the v1 surface with the REAL v1 validator (on a v1-shaped view).
  try {
    validateSniperPolicyConfig({
      ...value,
      schemaVersion: SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
      banner: SNIPER_POLICY_CONFIG_BANNER,
    });
  } catch (err) {
    throw new SniperPolicyConfigV2Error((err as Error).message);
  }
  if (typeof value.policyMode !== "string" || !SNIPER_POLICY_MODES.includes(value.policyMode as SniperPolicyMode)) {
    throw new SniperPolicyConfigV2Error('policy config v2.policyMode must be "conservative" | "balanced-paper" | "research-only"');
  }
  if (!isObject(value.riskLimits)) throw new SniperPolicyConfigV2Error("policy config v2.riskLimits must be an object");
  const lr = value.riskLimits as Record<string, unknown>;
  if (!Array.isArray(lr.disallowedReasonCodes) || lr.disallowedReasonCodes.some((c) => !isSniperDecisionReasonCode(c))) {
    throw new SniperPolicyConfigV2Error("policy config v2.riskLimits.disallowedReasonCodes must be an array of known reason codes");
  }
  if (!Array.isArray(lr.disallowedPreflightStatuses) || lr.disallowedPreflightStatuses.some((s) => typeof s !== "string" || !DISALLOWABLE_STATUSES.has(s))) {
    throw new SniperPolicyConfigV2Error("policy config v2.riskLimits.disallowedPreflightStatuses may only contain warn|unknown|fail");
  }
  if (lr.maxWarningsPerCandidate !== null && (typeof lr.maxWarningsPerCandidate !== "number" || !Number.isInteger(lr.maxWarningsPerCandidate) || (lr.maxWarningsPerCandidate as number) < 0)) {
    throw new SniperPolicyConfigV2Error("policy config v2.riskLimits.maxWarningsPerCandidate must be a non-negative integer or null");
  }
  for (const f of ["requireRiskPresent", "requireInspectionPresent", "requirePreflightInputArtifact"] as const) {
    if (typeof lr[f] !== "boolean") throw new SniperPolicyConfigV2Error(`policy config v2.riskLimits.${f} must be a boolean`);
  }
  // The mode-consistency contract holds for stored artifacts too (fail-closed).
  const asV1 = value as unknown as SniperPolicyConfig;
  try {
    checkModeConsistency(value.policyMode as SniperPolicyMode, asV1);
  } catch (err) {
    throw new SniperPolicyConfigV2Error((err as Error).message);
  }
  if ((lr.requireRiskPresent as boolean) && !asV1.failClosedOnMissingRisk) {
    throw new SniperPolicyConfigV2Error("policy config v2.riskLimits.requireRiskPresent=true contradicts failClosedOnMissingRisk=false");
  }
  return value as unknown as SniperPolicyConfigV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperPolicyConfigV2}. */
export interface FormatSniperPolicyConfigV2Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable v2 policy config. Deterministic and path-stable. Leads
 * with the PAPER-ONLY banner + the policy mode, lists the v1 sections (rules / enforcement / guards /
 * paper sizing) and the v2 risk limits, and closes with the tighten-only disclaimers. The whole
 * output is passed through the redactor.
 */
export function formatSniperPolicyConfigV2(
  config: SniperPolicyConfigV2,
  opts: FormatSniperPolicyConfigV2Options = {},
): string {
  const header = `${config.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:   ${opts.label}`);
  lines.push(`policy:  ${config.policyLabel ?? "(unlabeled)"}`);
  lines.push(`mode:    ${config.policyMode}`);
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
  lines.push("Risk limits (v2; tighten-only):");
  lines.push(`- disallowedReasonCodes:        ${config.riskLimits.disallowedReasonCodes.length > 0 ? config.riskLimits.disallowedReasonCodes.join(", ") : "(none)"}`);
  lines.push(`- disallowedPreflightStatuses:  ${config.riskLimits.disallowedPreflightStatuses.length > 0 ? config.riskLimits.disallowedPreflightStatuses.join(", ") : "(none)"}`);
  lines.push(`- maxWarningsPerCandidate:      ${config.riskLimits.maxWarningsPerCandidate ?? "(none)"}`);
  lines.push(`- requireRiskPresent:           ${config.riskLimits.requireRiskPresent}`);
  lines.push(`- requireInspectionPresent:     ${config.riskLimits.requireInspectionPresent}`);
  lines.push(`- requirePreflightInputArtifact: ${config.riskLimits.requirePreflightInputArtifact} (declarative; the safety gates enforce it)`);

  lines.push("");
  lines.push("Candidate-list guards:");
  lines.push(`- maxCandidatesPerRun:  ${config.maxCandidatesPerRun ?? "(none)"}`);
  lines.push(`- duplicateMintPolicy:  ${config.duplicateMintPolicy}`);

  lines.push("");
  lines.push("Paper sizing assumptions (labels / simulated units — NOT currency or profit):");
  lines.push(`- budgetLabel:                ${config.paperSizing.budgetLabel ?? "(none)"}`);
  lines.push(`- maxPaperPositionUnits:      ${config.paperSizing.maxPaperPositionUnits ?? "(none)"}`);
  lines.push(`- maxCandidatesToPaperEnter:  ${config.paperSizing.maxCandidatesToPaperEnter ?? "(none)"} (the maximum paper-enter count)`);

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
