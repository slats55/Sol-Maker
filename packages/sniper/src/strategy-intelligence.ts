/**
 * Deterministic, **no-send** SNIPER STRATEGY INTELLIGENCE artifact (Sprint 106 alpha layer).
 *
 * The campaign and the alpha report tell an operator WHAT each candidate's verdict is. This module
 * adds the read-only "WHY" and "what to study next": it projects a validated campaign (the verdict
 * spine) together with the per-mint `token:risk` reports the operator already gathered into a
 * per-candidate intelligence card —
 *
 *   - the specific notable risk flags by NAME (freeze / mint authority, Token-2022 extension risks,
 *     holder concentration, mutable metadata, thin liquidity) that the campaign only counts;
 *   - a mint class (wrapped-SOL / stablecoin / other) so well-known mints are handled honestly;
 *   - a confidence label (high / medium / low) derived from evidence completeness;
 *   - a closed set of machine-readable reason codes;
 *   - a plain-English "why this matters" and "what to study next" — never a buy signal.
 *
 * It is a faithful PROJECTION: candidate verdicts come from the campaign's own re-derivation (a score
 * can never override a blocker), and a flag is surfaced ONLY when its risk report actually carries it.
 * It is **pure** (no filesystem / network / RPC / wallet) and structurally incapable of claiming a
 * live send or live readiness: `liveTradingStatus` is the literal "disabled", `authorizesLiveTrading`
 * / `notAProfitabilityClaim` are pinned, and the schema is CLOSED.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "./mint-address.js";
import {
  SNIPER_CAMPAIGN_CANDIDATE_VERDICTS,
  type SniperDryRunCampaign,
  type SniperCampaignCandidateVerdict,
} from "./dryrun-campaign.js";
import {
  SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE,
  type SniperAlphaRunEvidenceProvenance,
} from "./alpha-run-report.js";

/** Stable schema identifier for the strategy intelligence artifact. Bump only on a breaking change. */
export const SNIPER_STRATEGY_INTELLIGENCE_SCHEMA_VERSION = "sniper.strategy_intelligence.v1";

/** The banner that prefixes every strategy intelligence artifact (required label). */
export const SNIPER_STRATEGY_INTELLIGENCE_BANNER =
  "SNIPER STRATEGY INTELLIGENCE — read-only no-send candidate intelligence (why a verdict + what to study next). NOT a buy signal, NOT a profitability claim. LIVE TRADING IS DISABLED.";

/** The fixed live-trading status. There is no input that can change it. */
export const SNIPER_STRATEGY_INTELLIGENCE_LIVE_TRADING_STATUS = "disabled";

/** Closed mint-class set (well-known mints handled honestly; everything else is `other`). */
export const SNIPER_STRATEGY_MINT_CLASSES = ["wrapped-sol", "stablecoin", "other"] as const;
export type SniperStrategyMintClass = (typeof SNIPER_STRATEGY_MINT_CLASSES)[number];

/** Closed confidence set, derived from evidence completeness (never a price prediction). */
export const SNIPER_STRATEGY_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type SniperStrategyConfidence = (typeof SNIPER_STRATEGY_CONFIDENCE_LEVELS)[number];

/** Closed machine-readable reason-code set for the intelligence layer. Append-only. */
export const SNIPER_STRATEGY_REASON_CODES = [
  "risk-rejected",
  "risk-caution",
  "risk-clean",
  "risk-missing",
  "authority-freeze-present",
  "authority-mint-present",
  "token2022-extension-risk",
  "holder-concentration-risk",
  "metadata-mutable",
  "liquidity-thin",
  "verdict-blocked",
  "verdict-monitor",
  "evidence-incomplete",
] as const;
export type SniperStrategyReasonCode = (typeof SNIPER_STRATEGY_REASON_CODES)[number];

/** Closed risk-decision set (mirrors @soulmaker/risk). */
const RISK_DECISIONS: ReadonlySet<string> = new Set(["REJECT", "CAUTION", "PASS_FOR_PAPER_EVALUATION"]);
const RISK_SEVERITIES: ReadonlySet<string> = new Set(["info", "low", "medium", "high", "critical"]);
const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Well-known mint classification (read-only; data only, never a recommendation). */
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLECOIN_MINTS: ReadonlySet<string> = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

/** Risk flag ids that signal a Token-2022 extension concern (critical / high severity). */
const TOKEN2022_FLAG_IDS: ReadonlySet<string> = new Set([
  "token-2022-program",
  "token-2022-extensions-unknown",
  "transfer-hook-present",
  "permanent-delegate-present",
  "non-transferable-token",
  "default-account-state-frozen",
  "pausable-token",
  "transfer-fee-present",
  "transfer-fee-extreme",
  "mint-close-authority-present",
  "confidential-transfers-enabled",
  "scaled-ui-amount-present",
  "interest-bearing-token",
  "metadata-pointer-present",
  "token-2022-unexamined-extension",
]);

const FREEZE_AUTHORITY_FLAG = "freeze-authority-present";
const MINT_AUTHORITY_FLAG = "mint-authority-present";
const HOLDER_CONCENTRATION_FLAGS: ReadonlySet<string> = new Set(["holder-concentration-extreme", "holder-concentration-elevated"]);
const METADATA_MUTABLE_FLAG = "metadata-mutable";
const LIQUIDITY_THIN_FLAGS: ReadonlySet<string> = new Set(["liquidity-very-thin", "liquidity-thin"]);

/** Required disclaimer statements carried by every strategy intelligence artifact (stable order). */
export const SNIPER_STRATEGY_INTELLIGENCE_DISCLAIMERS: readonly string[] = [
  "SNIPER STRATEGY INTELLIGENCE — read-only no-send candidate intelligence projected from a campaign + token:risk reports.",
  "Live trading is DISABLED. This artifact is structurally incapable of reporting a live send, a signature, or an armed state; mainnet sending has NO CLI surface.",
  "Candidate verdicts come from the campaign's own re-derivation (a high score can never override a blocker); this layer only explains and ranks them.",
  "A confidence label measures EVIDENCE COMPLETENESS, never price direction. A flag is surfaced ONLY when its risk report actually carries it.",
  "'watch' is the best a candidate reaches — keep monitoring, never ready or safe to trade.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this artifact.",
  "Not a buy signal.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
];

const DEFAULT_CAVEATS: readonly string[] = [
  "Intelligence explains evidence; it never trades, never sends, and never authorizes a live path.",
  "A notable flag is read VERBATIM from the candidate's token:risk report — a missing report is shown as low confidence, never faked.",
  "'why this matters' / 'what to study next' are deterministic operator guidance, never a recommendation to buy or sell.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;
const MAX_NOTABLE_FLAGS = 6;
const MAX_TOP_CONCERNS = 16;

/** Thrown when a strategy intelligence INPUT or produced artifact is structurally invalid. */
export class SniperStrategyIntelligenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperStrategyIntelligenceError";
  }
}

// --- input model -------------------------------------------------------------

/** One operator-supplied token:risk report paired to its candidate mint. */
export interface SniperStrategyRiskInput {
  mint: string;
  /** The parsed token:risk report object (decision / score / flags). */
  report: unknown;
}

/** Everything {@link buildSniperStrategyIntelligence} accepts. */
export interface BuildSniperStrategyIntelligenceInput {
  intelligenceId?: string | null;
  generatedAt?: string | null;
  /** The validated campaign (the verdict + candidate spine). */
  campaign: SniperDryRunCampaign;
  campaignRef?: string | null;
  /** Per-mint token:risk reports (optional enrichment; a candidate without one reads low-confidence). */
  riskReports?: SniperStrategyRiskInput[];
  evidenceProvenance?: string | null;
  caveats?: string[];
}

// --- artifact model ----------------------------------------------------------

/** One notable risk flag surfaced for a candidate (read verbatim from its risk report). */
export interface SniperStrategyNotableFlag {
  id: string;
  severity: string;
  title: string;
}

/** Per-candidate intelligence card. */
export interface SniperStrategyCandidateIntel {
  candidateId: string;
  mint: string;
  mintClass: SniperStrategyMintClass;
  verdict: SniperCampaignCandidateVerdict;
  score: number | null;
  riskDecision: string | null;
  riskScore: number | null;
  hasRiskReport: boolean;
  notableFlags: SniperStrategyNotableFlag[];
  confidence: SniperStrategyConfidence;
  reasonCodes: SniperStrategyReasonCode[];
  whyItMatters: string;
  whatToStudyNext: string;
}

/** Per-verdict tally (copied from the campaign's own re-derivation). */
export interface SniperStrategyVerdictCounts {
  watch: number;
  review: number;
  blocked: number;
  insufficientEvidence: number;
}

/** Confidence distribution across the candidate set. */
export interface SniperStrategyConfidenceCounts {
  high: number;
  medium: number;
  low: number;
}

/** Mint-class distribution across the candidate set. */
export interface SniperStrategyMintClassCounts {
  wrappedSol: number;
  stablecoin: number;
  other: number;
}

/** One concern (risk flag id) and how many candidates carry it (sorted by frequency). */
export interface SniperStrategyConcern {
  flagId: string;
  severity: string;
  candidateCount: number;
}

/** The full, deterministic, JSON-serializable strategy intelligence artifact. */
export interface SniperStrategyIntelligence {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  intelligenceId: string;
  generatedAt: string | null;
  campaignRef: string | null;
  evidenceProvenance: SniperAlphaRunEvidenceProvenance;
  candidateCount: number;
  verdictCounts: SniperStrategyVerdictCounts;
  confidenceCounts: SniperStrategyConfidenceCounts;
  mintClassCounts: SniperStrategyMintClassCounts;
  topConcerns: SniperStrategyConcern[];
  candidates: SniperStrategyCandidateIntel[];
  strategyNotes: string[];
  nextSafeActions: string[];
  caveats: string[];
  liveTradingStatus: "disabled";
  authorizesLiveTrading: false;
  redactionApplied: true;
  neverSends: true;
  phase7LiveTradingReady: false;
  notAProfitabilityClaim: true;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new SniperStrategyIntelligenceError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperStrategyIntelligenceError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperStrategyIntelligenceError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperStrategyIntelligenceError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperStrategyIntelligenceError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperStrategyIntelligenceError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function optEnum(value: unknown, name: string, allowed: readonly string[], fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new SniperStrategyIntelligenceError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperStrategyIntelligenceError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperStrategyIntelligenceError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperStrategyIntelligenceError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperStrategyIntelligenceError(`${name}[${i}] must be a non-empty string`);
    if (trimmed.length > MAX_LINE_LEN) throw new SniperStrategyIntelligenceError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    if (redactString(trimmed) !== trimmed) throw new SniperStrategyIntelligenceError(`${name}[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

// --- risk projection ---------------------------------------------------------

interface ProjectedRisk {
  present: boolean;
  decision: string | null;
  score: number | null;
  flags: SniperStrategyNotableFlag[];
}

/** Project a parsed token:risk report onto the fields the intelligence layer reads. Pure, defensive. */
function projectRisk(report: unknown): ProjectedRisk {
  if (!isObject(report)) return { present: false, decision: null, score: null, flags: [] };
  const decision = typeof report.decision === "string" && RISK_DECISIONS.has(report.decision) ? report.decision : null;
  const score = typeof report.score === "number" && Number.isFinite(report.score) ? report.score : null;
  const rawFlags = Array.isArray(report.flags) ? report.flags : [];
  const flags: SniperStrategyNotableFlag[] = rawFlags
    .filter(isObject)
    .map((f) => ({
      id: typeof f.id === "string" && f.id.trim().length > 0 ? f.id.trim() : "(unknown)",
      severity: typeof f.severity === "string" && RISK_SEVERITIES.has(f.severity) ? f.severity : "info",
      title: typeof f.title === "string" && f.title.trim().length > 0 ? f.title.trim() : "(untitled)",
    }))
    .map((f) => ({ id: f.id, severity: f.severity, title: f.title }));
  return { present: true, decision, score, flags };
}

function classifyMint(mint: string): SniperStrategyMintClass {
  if (mint === WRAPPED_SOL_MINT) return "wrapped-sol";
  if (STABLECOIN_MINTS.has(mint)) return "stablecoin";
  return "other";
}

/** Severity rank at which a flag becomes "notable" (medium and above). */
const NOTABLE_SEVERITY_RANK = 2;

/** Notable flags = the highest-severity flags that matter for intelligence (deterministic order). */
function notableFlags(flags: readonly SniperStrategyNotableFlag[]): SniperStrategyNotableFlag[] {
  return [...flags]
    .filter((f) => (SEVERITY_RANK[f.severity] ?? 0) >= NOTABLE_SEVERITY_RANK)
    .sort((a, b) => {
      const rb = SEVERITY_RANK[b.severity] ?? 0;
      const ra = SEVERITY_RANK[a.severity] ?? 0;
      if (rb !== ra) return rb - ra;
      return compareString(a.id, b.id);
    })
    .slice(0, MAX_NOTABLE_FLAGS);
}

// --- per-candidate intelligence ----------------------------------------------

function deriveReasonCodes(verdict: SniperCampaignCandidateVerdict, risk: ProjectedRisk): SniperStrategyReasonCode[] {
  const codes = new Set<SniperStrategyReasonCode>();
  if (!risk.present) {
    codes.add("risk-missing");
  } else if (risk.decision === "REJECT") {
    codes.add("risk-rejected");
  } else if (risk.decision === "CAUTION") {
    codes.add("risk-caution");
  } else if (risk.decision === "PASS_FOR_PAPER_EVALUATION") {
    codes.add("risk-clean");
  }
  const flagIds = new Set(risk.flags.map((f) => f.id));
  if (flagIds.has(FREEZE_AUTHORITY_FLAG)) codes.add("authority-freeze-present");
  if (flagIds.has(MINT_AUTHORITY_FLAG)) codes.add("authority-mint-present");
  if (risk.flags.some((f) => TOKEN2022_FLAG_IDS.has(f.id) && (f.severity === "critical" || f.severity === "high"))) {
    codes.add("token2022-extension-risk");
  }
  if (risk.flags.some((f) => HOLDER_CONCENTRATION_FLAGS.has(f.id))) codes.add("holder-concentration-risk");
  if (flagIds.has(METADATA_MUTABLE_FLAG)) codes.add("metadata-mutable");
  if (risk.flags.some((f) => LIQUIDITY_THIN_FLAGS.has(f.id))) codes.add("liquidity-thin");
  if (verdict === "blocked") codes.add("verdict-blocked");
  if (verdict === "watch" || verdict === "review") codes.add("verdict-monitor");
  if (verdict === "insufficient-evidence") codes.add("evidence-incomplete");
  // Stable order: emit in the canonical reason-code order.
  return SNIPER_STRATEGY_REASON_CODES.filter((c) => codes.has(c));
}

function deriveConfidence(verdict: SniperCampaignCandidateVerdict, risk: ProjectedRisk): SniperStrategyConfidence {
  if (!risk.present || verdict === "insufficient-evidence") return "low";
  if (verdict === "blocked") return "high"; // we know exactly why it is out
  if (verdict === "review") return "medium";
  // watch
  return risk.decision === "PASS_FOR_PAPER_EVALUATION" ? "high" : "medium";
}

function deriveWhyItMatters(
  verdict: SniperCampaignCandidateVerdict,
  mintClass: SniperStrategyMintClass,
  risk: ProjectedRisk,
  notable: readonly SniperStrategyNotableFlag[],
): string {
  const classNote =
    mintClass === "wrapped-sol"
      ? "This is wrapped SOL — a well-known utility mint, not a memecoin opportunity. "
      : mintClass === "stablecoin"
        ? "This is a well-known stablecoin, not a memecoin opportunity. "
        : "";
  const flagNote = notable.length > 0 ? `Notable read-only concerns: ${notable.map((f) => `${f.title} (${f.severity})`).join("; ")}. ` : "";
  switch (verdict) {
    case "blocked":
      return `${classNote}${flagNote}This candidate failed a read-only gate and is BLOCKED — a high score can never override it. Nothing here trades.`;
    case "review":
      return `${classNote}${flagNote}This candidate has a concern or is missing a positive clean signal — study it further before any next step. Live trading stays disabled.`;
    case "insufficient-evidence":
      return `${classNote}Evidence is missing for this candidate, so no honest read-only verdict can be formed yet. Gather deep risk before drawing any conclusion.`;
    case "watch":
      return `${classNote}${flagNote || "No notable read-only concerns surfaced on the current evidence. "}This candidate is clean-to-watch — keep monitoring. This is NOT a buy signal; live trading stays disabled.`;
  }
}

function deriveWhatToStudyNext(verdict: SniperCampaignCandidateVerdict, risk: ProjectedRisk): string {
  if (!risk.present) {
    return "Run `token:risk --deep` for this mint and re-run the campaign; without it the candidate stays low-confidence.";
  }
  switch (verdict) {
    case "blocked":
      return "Drop or deprioritize; re-checking a blocked candidate is rarely worthwhile. Never override a risk gate.";
    case "review":
      return "Re-read the deep risk flags and the route quote; confirm whether the concern is structural before spending more time.";
    case "insufficient-evidence":
      return "Gather the missing evidence (deep risk / a fresh quote / a dry-run release candidate), then re-run the campaign.";
    case "watch":
      return "Keep it on the watchlist and re-run the campaign periodically; a clean read-only verdict is monitoring guidance, never a buy.";
  }
}

// --- aggregate derivation ----------------------------------------------------

function deriveVerdictCounts(candidates: readonly SniperStrategyCandidateIntel[]): SniperStrategyVerdictCounts {
  return {
    watch: candidates.filter((c) => c.verdict === "watch").length,
    review: candidates.filter((c) => c.verdict === "review").length,
    blocked: candidates.filter((c) => c.verdict === "blocked").length,
    insufficientEvidence: candidates.filter((c) => c.verdict === "insufficient-evidence").length,
  };
}

function deriveConfidenceCounts(candidates: readonly SniperStrategyCandidateIntel[]): SniperStrategyConfidenceCounts {
  return {
    high: candidates.filter((c) => c.confidence === "high").length,
    medium: candidates.filter((c) => c.confidence === "medium").length,
    low: candidates.filter((c) => c.confidence === "low").length,
  };
}

function deriveMintClassCounts(candidates: readonly SniperStrategyCandidateIntel[]): SniperStrategyMintClassCounts {
  return {
    wrappedSol: candidates.filter((c) => c.mintClass === "wrapped-sol").length,
    stablecoin: candidates.filter((c) => c.mintClass === "stablecoin").length,
    other: candidates.filter((c) => c.mintClass === "other").length,
  };
}

function deriveTopConcerns(candidates: readonly SniperStrategyCandidateIntel[]): SniperStrategyConcern[] {
  const counts = new Map<string, { severity: string; candidateCount: number }>();
  for (const c of candidates) {
    const seen = new Set<string>();
    for (const f of c.notableFlags) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const prev = counts.get(f.id);
      if (prev === undefined) {
        counts.set(f.id, { severity: f.severity, candidateCount: 1 });
      } else {
        prev.candidateCount += 1;
        // Keep the highest severity seen for this flag id.
        if ((SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[prev.severity] ?? 0)) prev.severity = f.severity;
      }
    }
  }
  return [...counts.entries()]
    .map(([flagId, v]) => ({ flagId, severity: v.severity, candidateCount: v.candidateCount }))
    .sort((a, b) => (b.candidateCount !== a.candidateCount ? b.candidateCount - a.candidateCount : compareString(a.flagId, b.flagId)))
    .slice(0, MAX_TOP_CONCERNS);
}

function deriveStrategyNotes(
  candidates: readonly SniperStrategyCandidateIntel[],
  verdicts: SniperStrategyVerdictCounts,
  concerns: readonly SniperStrategyConcern[],
  mintClasses: SniperStrategyMintClassCounts,
): string[] {
  const notes: string[] = [];
  if (candidates.length === 0) {
    notes.push("No candidates were supplied — nothing to study.");
    return notes;
  }
  const monitorable = verdicts.watch + verdicts.review;
  notes.push(`${monitorable} of ${candidates.length} candidate(s) are monitorable (watch / review); ${verdicts.blocked} blocked, ${verdicts.insufficientEvidence} need more evidence.`);
  if (concerns.length > 0) {
    const top = concerns[0]!;
    notes.push(`Most common read-only concern: "${top.flagId}" in ${top.candidateCount} candidate(s) (${top.severity}). Prioritize mints without it.`);
  }
  if (mintClasses.wrappedSol + mintClasses.stablecoin > 0) {
    notes.push(`${mintClasses.wrappedSol + mintClasses.stablecoin} candidate(s) are well-known utility / stablecoin mints — not memecoin opportunities; they appear as deterministic examples, not targets.`);
  }
  const lowConfidence = candidates.filter((c) => c.confidence === "low").length;
  if (lowConfidence > 0) {
    notes.push(`${lowConfidence} candidate(s) are low-confidence (missing deep risk or insufficient evidence) — gather token:risk --deep before studying them further.`);
  }
  notes.push("This intelligence is read-only study guidance. It is never a buy list, never a profitability claim, and live trading stays disabled.");
  return notes;
}

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link SniperStrategyIntelligence} from a validated campaign and the operator's
 * per-mint token:risk reports. Pure, non-mutating, deterministic. Candidate verdicts come from the
 * campaign; notable flags / reason codes / confidence / guidance are derived per candidate; the
 * aggregates are re-derived; the live-trading / safety literals are pinned. Throws
 * {@link SniperStrategyIntelligenceError} on any structural problem.
 */
export function buildSniperStrategyIntelligence(input: BuildSniperStrategyIntelligenceInput): SniperStrategyIntelligence {
  if (!isObject(input)) throw new SniperStrategyIntelligenceError("strategy intelligence input must be an object");
  const campaign = input.campaign;
  if (!isObject(campaign) || !Array.isArray(campaign.candidates)) {
    throw new SniperStrategyIntelligenceError("input.campaign must be a validated campaign object with a candidates array");
  }
  if (campaign.liveSendStatus !== "disabled" || campaign.neverSends !== true) {
    throw new SniperStrategyIntelligenceError("input.campaign is not live-disabled — refused");
  }

  const intelligenceId = (safeLabel(input.intelligenceId, "intelligenceId", 128, true) as string | null) ?? "sniper-strategy-intelligence";
  const generatedAt = safeLabel(input.generatedAt, "generatedAt", 40, true);
  const campaignRef = safeLabel(input.campaignRef, "campaignRef", MAX_LABEL_LEN, true);
  const evidenceProvenance = optEnum(input.evidenceProvenance, "evidenceProvenance", SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE, "mixed") as SniperAlphaRunEvidenceProvenance;

  // Index the supplied risk reports by validated mint.
  const riskByMint = new Map<string, ProjectedRisk>();
  if (input.riskReports !== undefined && input.riskReports !== null) {
    if (!Array.isArray(input.riskReports)) throw new SniperStrategyIntelligenceError("riskReports must be an array");
    if (input.riskReports.length > 4096) throw new SniperStrategyIntelligenceError("riskReports exceeds 4096 entries");
    for (let i = 0; i < input.riskReports.length; i++) {
      const r = input.riskReports[i]!;
      if (!isObject(r)) throw new SniperStrategyIntelligenceError(`riskReports[${i}] must be an object`);
      let mint: string;
      try {
        mint = parseMintAddress(r.mint);
      } catch (err) {
        throw new SniperStrategyIntelligenceError(`riskReports[${i}]: ${(err as Error).message}`);
      }
      riskByMint.set(mint, projectRisk(r.report));
    }
  }

  const candidates: SniperStrategyCandidateIntel[] = (campaign.candidates as unknown[]).map((raw, i) => {
    const c = raw as Record<string, unknown>;
    const candidateId = safeLabel(c.candidateId, `campaign.candidates[${i}].candidateId`, 128, false) as string;
    let mint: string;
    try {
      mint = parseMintAddress(c.mint);
    } catch (err) {
      throw new SniperStrategyIntelligenceError(`campaign.candidates[${i}]: ${(err as Error).message}`);
    }
    const verdict = c.finalOperatorVerdict as SniperCampaignCandidateVerdict;
    if (!(SNIPER_CAMPAIGN_CANDIDATE_VERDICTS as readonly string[]).includes(verdict)) {
      throw new SniperStrategyIntelligenceError(`campaign.candidates[${i}].finalOperatorVerdict is not a known verdict`);
    }
    const risk = riskByMint.get(mint) ?? { present: false, decision: null, score: null, flags: [] };
    const mintClass = classifyMint(mint);
    const notable = notableFlags(risk.flags);
    const confidence = deriveConfidence(verdict, risk);
    const reasonCodes = deriveReasonCodes(verdict, risk);
    return {
      candidateId,
      mint,
      mintClass,
      verdict,
      score: typeof c.score === "number" ? c.score : null,
      riskDecision: risk.decision,
      riskScore: risk.score,
      hasRiskReport: risk.present,
      notableFlags: notable,
      confidence,
      reasonCodes,
      whyItMatters: deriveWhyItMatters(verdict, mintClass, risk, notable),
      whatToStudyNext: deriveWhatToStudyNext(verdict, risk),
    };
  });

  const verdictCounts = deriveVerdictCounts(candidates);
  const confidenceCounts = deriveConfidenceCounts(candidates);
  const mintClassCounts = deriveMintClassCounts(candidates);
  const topConcerns = deriveTopConcerns(candidates);
  const strategyNotes = deriveStrategyNotes(candidates, verdictCounts, topConcerns, mintClassCounts);

  const nextSafeActions: string[] = [];
  if (verdictCounts.blocked > 0) nextSafeActions.push(`${verdictCounts.blocked} candidate(s) BLOCKED — review their reason codes; never override a read-only gate.`);
  if (confidenceCounts.low > 0) nextSafeActions.push(`${confidenceCounts.low} candidate(s) are low-confidence — gather token:risk --deep and re-run.`);
  if (verdictCounts.watch + verdictCounts.review > 0) nextSafeActions.push(`${verdictCounts.watch + verdictCounts.review} candidate(s) are monitorable — study the highest-confidence ones first. This is NOT a buy list.`);
  nextSafeActions.push("Live trading stays DISABLED. The Phase 7 path requires a separate, explicit written human sign-off and a separate authorization sprint — nothing here authorizes it.");

  const extraCaveats = normalizeStringList(input.caveats, "caveats", MAX_LIST);

  return {
    schemaVersion: SNIPER_STRATEGY_INTELLIGENCE_SCHEMA_VERSION,
    banner: SNIPER_STRATEGY_INTELLIGENCE_BANNER,
    disclaimers: [...SNIPER_STRATEGY_INTELLIGENCE_DISCLAIMERS],
    intelligenceId,
    generatedAt,
    campaignRef,
    evidenceProvenance,
    candidateCount: candidates.length,
    verdictCounts,
    confidenceCounts,
    mintClassCounts,
    topConcerns,
    candidates,
    strategyNotes,
    nextSafeActions,
    caveats: [...DEFAULT_CAVEATS, ...extraCaveats],
    liveTradingStatus: SNIPER_STRATEGY_INTELLIGENCE_LIVE_TRADING_STATUS,
    authorizesLiveTrading: false,
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    notAProfitabilityClaim: true,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "intelligenceId",
  "generatedAt",
  "campaignRef",
  "evidenceProvenance",
  "candidateCount",
  "verdictCounts",
  "confidenceCounts",
  "mintClassCounts",
  "topConcerns",
  "candidates",
  "strategyNotes",
  "nextSafeActions",
  "caveats",
  "liveTradingStatus",
  "authorizesLiveTrading",
  "redactionApplied",
  "neverSends",
  "phase7LiveTradingReady",
  "notAProfitabilityClaim",
] as const;

const EXPECTED_CANDIDATE_KEYS = [
  "candidateId",
  "mint",
  "mintClass",
  "verdict",
  "score",
  "riskDecision",
  "riskScore",
  "hasRiskReport",
  "notableFlags",
  "confidence",
  "reasonCodes",
  "whyItMatters",
  "whatToStudyNext",
] as const;

function validateCandidate(value: unknown, where: string): SniperStrategyCandidateIntel {
  if (!isObject(value)) throw new SniperStrategyIntelligenceError(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_CANDIDATE_KEYS as readonly string[]).includes(key)) {
      throw new SniperStrategyIntelligenceError(`${where} has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_CANDIDATE_KEYS) {
    if (!(key in value)) throw new SniperStrategyIntelligenceError(`${where} is missing field "${key}"`);
  }
  safeLabel(value.candidateId, `${where}.candidateId`, 128, false);
  try {
    parseMintAddress(value.mint);
  } catch (err) {
    throw new SniperStrategyIntelligenceError(`${where}.mint: ${(err as Error).message}`);
  }
  if (!(SNIPER_STRATEGY_MINT_CLASSES as readonly string[]).includes(value.mintClass as string)) {
    throw new SniperStrategyIntelligenceError(`${where}.mintClass must be one of: ${SNIPER_STRATEGY_MINT_CLASSES.join(", ")}`);
  }
  if (!(SNIPER_CAMPAIGN_CANDIDATE_VERDICTS as readonly string[]).includes(value.verdict as string)) {
    throw new SniperStrategyIntelligenceError(`${where}.verdict must be a known campaign verdict`);
  }
  if (!(SNIPER_STRATEGY_CONFIDENCE_LEVELS as readonly string[]).includes(value.confidence as string)) {
    throw new SniperStrategyIntelligenceError(`${where}.confidence must be one of: ${SNIPER_STRATEGY_CONFIDENCE_LEVELS.join(", ")}`);
  }
  if (typeof value.hasRiskReport !== "boolean") throw new SniperStrategyIntelligenceError(`${where}.hasRiskReport must be a boolean`);
  if (!Array.isArray(value.notableFlags)) throw new SniperStrategyIntelligenceError(`${where}.notableFlags must be an array`);
  for (const f of value.notableFlags as unknown[]) {
    if (!isObject(f) || typeof f.id !== "string" || typeof f.severity !== "string" || typeof f.title !== "string") {
      throw new SniperStrategyIntelligenceError(`${where}.notableFlags entries must have string id/severity/title`);
    }
  }
  if (!Array.isArray(value.reasonCodes) || (value.reasonCodes as unknown[]).some((c) => !(SNIPER_STRATEGY_REASON_CODES as readonly string[]).includes(c as string))) {
    throw new SniperStrategyIntelligenceError(`${where}.reasonCodes must be a subset of the closed reason-code set`);
  }
  for (const k of ["whyItMatters", "whatToStudyNext"] as const) {
    if (typeof value[k] !== "string" || (value[k] as string).trim().length === 0) {
      throw new SniperStrategyIntelligenceError(`${where}.${k} must be a non-empty string`);
    }
  }
  return value as unknown as SniperStrategyCandidateIntel;
}

/**
 * Strictly validate a value as a canonical {@link SniperStrategyIntelligence}. A backstop AND a parity
 * wall: the key set is CLOSED (no `signature` / `txid` / `sendResult` field can appear); the banner /
 * live-trading / safety literals are pinned; every candidate is re-validated (closed keys, known
 * verdict / mint-class / confidence, reason codes within the closed set); and the verdict / confidence
 * / mint-class / concern aggregates are INDEPENDENTLY re-derived from the candidates and must match.
 * Throws {@link SniperStrategyIntelligenceError} on the first problem. Pure.
 */
export function validateSniperStrategyIntelligence(value: unknown): SniperStrategyIntelligence {
  if (!isObject(value)) throw new SniperStrategyIntelligenceError("strategy intelligence must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperStrategyIntelligenceError(`strategy intelligence has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperStrategyIntelligenceError(`strategy intelligence is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_STRATEGY_INTELLIGENCE_SCHEMA_VERSION) {
    throw new SniperStrategyIntelligenceError(`schemaVersion must be "${SNIPER_STRATEGY_INTELLIGENCE_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_STRATEGY_INTELLIGENCE_BANNER) throw new SniperStrategyIntelligenceError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperStrategyIntelligenceError("disclaimers must be a non-empty array");
  }
  safeLabel(value.intelligenceId, "intelligenceId", 128, false);
  safeLabel(value.generatedAt, "generatedAt", 40, true);
  safeLabel(value.campaignRef, "campaignRef", MAX_LABEL_LEN, true);
  if (!(SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE as readonly string[]).includes(value.evidenceProvenance as string)) {
    throw new SniperStrategyIntelligenceError(`evidenceProvenance must be one of: ${SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE.join(", ")}`);
  }

  if (!Array.isArray(value.candidates)) throw new SniperStrategyIntelligenceError("candidates must be an array");
  const candidates = (value.candidates as unknown[]).map((c, i) => validateCandidate(c, `candidates[${i}]`));
  if (value.candidateCount !== candidates.length) throw new SniperStrategyIntelligenceError("candidateCount must equal candidates.length");

  if (JSON.stringify(value.verdictCounts) !== JSON.stringify(deriveVerdictCounts(candidates))) {
    throw new SniperStrategyIntelligenceError("verdictCounts must be re-derived from the candidates");
  }
  if (JSON.stringify(value.confidenceCounts) !== JSON.stringify(deriveConfidenceCounts(candidates))) {
    throw new SniperStrategyIntelligenceError("confidenceCounts must be re-derived from the candidates");
  }
  if (JSON.stringify(value.mintClassCounts) !== JSON.stringify(deriveMintClassCounts(candidates))) {
    throw new SniperStrategyIntelligenceError("mintClassCounts must be re-derived from the candidates");
  }
  if (JSON.stringify(value.topConcerns) !== JSON.stringify(deriveTopConcerns(candidates))) {
    throw new SniperStrategyIntelligenceError("topConcerns must be re-derived from the candidates");
  }

  for (const field of ["strategyNotes", "nextSafeActions", "caveats"] as const) {
    if (!Array.isArray(value[field])) throw new SniperStrategyIntelligenceError(`${field} must be an array`);
  }
  if ((value.caveats as unknown[]).length === 0) throw new SniperStrategyIntelligenceError("caveats must be non-empty");

  if (value.liveTradingStatus !== SNIPER_STRATEGY_INTELLIGENCE_LIVE_TRADING_STATUS) {
    throw new SniperStrategyIntelligenceError(`liveTradingStatus must literally be "${SNIPER_STRATEGY_INTELLIGENCE_LIVE_TRADING_STATUS}"`);
  }
  for (const [field, expected] of [
    ["authorizesLiveTrading", false],
    ["redactionApplied", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
    ["notAProfitabilityClaim", true],
  ] as const) {
    if (value[field] !== expected) throw new SniperStrategyIntelligenceError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as SniperStrategyIntelligence;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperStrategyIntelligence}. */
export interface FormatSniperStrategyIntelligenceOptions {
  label?: string;
  /** Cap on the number of candidate cards printed (default 50; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable strategy intelligence summary. Deterministic and
 * path-stable. The whole output passes through the redactor.
 */
export function formatSniperStrategyIntelligence(intel: SniperStrategyIntelligence, opts: FormatSniperStrategyIntelligenceOptions = {}): string {
  const maxRows = opts.maxRows ?? 50;
  const header = `${intel.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`id:         ${intel.intelligenceId}`);
  lines.push(`live:       ${intel.liveTradingStatus.toUpperCase()} (authorizes live trading: ${String(intel.authorizesLiveTrading)})`);
  lines.push(`candidates: ${intel.candidateCount}`);
  lines.push(`verdicts:   watch ${intel.verdictCounts.watch} · review ${intel.verdictCounts.review} · BLOCKED ${intel.verdictCounts.blocked} · insufficient ${intel.verdictCounts.insufficientEvidence}`);
  lines.push(`confidence: high ${intel.confidenceCounts.high} · medium ${intel.confidenceCounts.medium} · low ${intel.confidenceCounts.low}`);

  lines.push("");
  lines.push("Candidates:");
  for (const c of intel.candidates.slice(0, maxRows)) {
    lines.push(`[${c.verdict}] ${c.candidateId}  ${c.mint}  (${c.mintClass}; confidence=${c.confidence}; risk=${c.riskDecision ?? "—"})`);
    if (c.reasonCodes.length > 0) lines.push(`    reasons: ${c.reasonCodes.join(", ")}`);
    if (c.notableFlags.length > 0) lines.push(`    flags: ${c.notableFlags.map((f) => `${f.id}(${f.severity})`).join("; ")}`);
    lines.push(`    why: ${c.whyItMatters}`);
    lines.push(`    next: ${c.whatToStudyNext}`);
  }
  const hidden = intel.candidates.length - Math.min(intel.candidates.length, maxRows);
  if (hidden > 0) lines.push(`… and ${hidden} more (summarized; see the JSON for the full set)`);
  if (intel.candidates.length === 0) lines.push("(no candidates)");

  if (intel.topConcerns.length > 0) {
    lines.push("");
    lines.push("Top read-only concerns:");
    for (const c of intel.topConcerns) lines.push(`- ${c.flagId} (${c.severity}) in ${c.candidateCount} candidate(s)`);
  }

  lines.push("");
  lines.push("Strategy notes:");
  for (const n of intel.strategyNotes) lines.push(`- ${n}`);
  lines.push("");
  lines.push("Next safe actions:");
  for (const a of intel.nextSafeActions) lines.push(`- ${a}`);
  lines.push("");
  lines.push("Caveats:");
  for (const c of intel.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of intel.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
