/**
 * Deterministic, **no-send** SNIPER DRY-RUN CAMPAIGN DIFF artifact (Sprint 105-A alpha layer).
 *
 * A diff compares TWO validated campaigns (a `before` and an `after`) candidate-by-candidate, keyed by
 * canonical MINT, and reports what moved: added / removed / unchanged / changed candidates, the
 * per-candidate score delta, verdict transition, and risk / quote / build / simulation / blocker
 * changes. It NEVER re-derives a verdict — it reads each campaign's own re-derived verdict as ground
 * truth — and it is structurally incapable of authorizing a live path or faking a movement:
 *
 *   - `liveSendStatus` is the literal `"disabled"` and `authorizesLiveTrading` is pinned `false`;
 *   - the schema is CLOSED and refuses any `signature` / `txid` / `sendResult` field;
 *   - improved / worsened are only counted when BOTH verdicts are present (a one-sided add / remove
 *     is never an improvement or a regression — no fake movement when evidence is missing).
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI reads + validates both
 * campaigns and hands the objects here. The summary counts are RE-DERIVED and the validator recomputes
 * them independently.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "./mint-address.js";
import { SNIPER_CAMPAIGN_CANDIDATE_VERDICTS, type SniperDryRunCampaign, type SniperDryRunCampaignCandidate } from "./dryrun-campaign.js";

/** Stable schema identifier for the campaign diff artifact. Bump only on a breaking change. */
export const SNIPER_DRYRUN_CAMPAIGN_DIFF_SCHEMA_VERSION = "sniper.dryrun.campaign.diff.v1";

/** The banner that prefixes every campaign diff (required label). */
export const SNIPER_DRYRUN_CAMPAIGN_DIFF_BANNER =
  "SNIPER DRY-RUN CAMPAIGN DIFF — a no-send comparison of two campaigns. It reports movement only; it authorizes nothing. LIVE TRADING IS DISABLED.";

/** Closed per-candidate change status set. */
export const SNIPER_CAMPAIGN_DIFF_STATUSES = ["added", "removed", "unchanged", "changed"] as const;
export type SniperCampaignDiffStatus = (typeof SNIPER_CAMPAIGN_DIFF_STATUSES)[number];

/** The fixed live-send status. There is no input that can change it. */
export const SNIPER_DRYRUN_CAMPAIGN_DIFF_LIVE_SEND_STATUS = "disabled";

/** Required disclaimer statements carried by every campaign diff (stable order). */
export const SNIPER_DRYRUN_CAMPAIGN_DIFF_DISCLAIMERS: readonly string[] = [
  "SNIPER DRY-RUN CAMPAIGN DIFF — a no-send comparison of two campaigns; it reports what moved and authorizes nothing.",
  "Live trading is DISABLED. This artifact is structurally incapable of reporting a live send, a signature, or an armed state.",
  "A diff never re-derives or overrides a campaign verdict — it reads each campaign's own re-derived verdict as ground truth.",
  "Improved / worsened are counted only when both verdicts are present; a one-sided add / remove is never a fake improvement or regression.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this diff.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

const DEFAULT_CAVEATS: readonly string[] = [
  "A diff compares two campaigns; it never trades, never sends, and never authorizes a live path.",
  "Candidates are paired by canonical mint; if a campaign carries the same mint on more than one entry, the first occurrence is compared.",
  "A score delta is shown only when both campaigns scored the candidate — a missing score is never treated as a movement.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

const MAX_LABEL_LEN = 200;
const MAX_LIST = 64;

/** Verdict rank for improved / worsened detection (higher is better). */
const VERDICT_RANK: Record<string, number> = {
  blocked: 0,
  "insufficient-evidence": 1,
  review: 2,
  watch: 3,
};

/** Thrown when a campaign diff INPUT or produced artifact is structurally invalid. */
export class SniperDryRunCampaignDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperDryRunCampaignDiffError";
  }
}

// --- input / artifact model --------------------------------------------------

/** Everything {@link diffSniperDryRunCampaigns} accepts. Both campaigns must already be validated. */
export interface DiffSniperDryRunCampaignsInput {
  diffId?: string | null;
  comparedAt?: string | null;
  before: SniperDryRunCampaign;
  after: SniperDryRunCampaign;
  beforeCampaignRef?: string | null;
  afterCampaignRef?: string | null;
  caveats?: string[];
}

/** One candidate's change record (keyed by mint). */
export interface SniperCampaignCandidateChange {
  mint: string;
  status: SniperCampaignDiffStatus;
  scoreDelta: number | null;
  verdictBefore: string | null;
  verdictAfter: string | null;
  riskChange: string | null;
  quoteChange: string | null;
  buildChange: string | null;
  simulationChange: string | null;
  blockerChanges: string[];
  nextSafeAction: string;
}

/** Re-derived diff summary tallies. */
export interface SniperCampaignDiffSummary {
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  changedCount: number;
  improvedCount: number;
  worsenedCount: number;
  newlyBlockedCount: number;
  newlyWatchCount: number;
}

/** The full, deterministic, JSON-serializable campaign diff artifact. */
export interface SniperDryRunCampaignDiff {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  diffId: string;
  comparedAt: string | null;
  beforeCampaignRef: string | null;
  afterCampaignRef: string | null;
  candidateChanges: SniperCampaignCandidateChange[];
  summary: SniperCampaignDiffSummary;
  liveSendStatus: "disabled";
  authorizesLiveTrading: false;
  caveats: string[];
  redactionApplied: true;
  neverSends: true;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new SniperDryRunCampaignDiffError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperDryRunCampaignDiffError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperDryRunCampaignDiffError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperDryRunCampaignDiffError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperDryRunCampaignDiffError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperDryRunCampaignDiffError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperDryRunCampaignDiffError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperDryRunCampaignDiffError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperDryRunCampaignDiffError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperDryRunCampaignDiffError(`${name}[${i}] must be a non-empty string`);
    return trimmed;
  });
}

/** First-occurrence map of mint -> candidate (deterministic by campaign input order). */
function indexByMint(campaign: SniperDryRunCampaign): Map<string, SniperDryRunCampaignCandidate> {
  const out = new Map<string, SniperDryRunCampaignCandidate>();
  if (!Array.isArray(campaign.candidates)) return out;
  for (const c of campaign.candidates) {
    if (!out.has(c.mint)) out.set(c.mint, c);
  }
  return out;
}

function fieldChange(before: string | null, after: string | null): string | null {
  if (before === after) return null;
  return `${before ?? "—"} -> ${after ?? "—"}`;
}

function blockerChanges(before: readonly string[], after: readonly string[]): string[] {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const changes: string[] = [];
  for (const b of after) if (!beforeSet.has(b)) changes.push(`added: ${b}`);
  for (const b of before) if (!afterSet.has(b)) changes.push(`removed: ${b}`);
  return changes;
}

// --- diff a single candidate -------------------------------------------------

function diffCandidate(mint: string, before: SniperDryRunCampaignCandidate | undefined, after: SniperDryRunCampaignCandidate | undefined): SniperCampaignCandidateChange {
  if (before === undefined && after !== undefined) {
    return {
      mint,
      status: "added",
      scoreDelta: null,
      verdictBefore: null,
      verdictAfter: after.finalOperatorVerdict,
      riskChange: null,
      quoteChange: null,
      buildChange: null,
      simulationChange: null,
      blockerChanges: after.blockers.map((b) => `added: ${b}`),
      nextSafeAction: `ADDED in the after campaign with verdict ${after.finalOperatorVerdict}. ${after.nextSafeAction}`,
    };
  }
  if (before !== undefined && after === undefined) {
    return {
      mint,
      status: "removed",
      scoreDelta: null,
      verdictBefore: before.finalOperatorVerdict,
      verdictAfter: null,
      riskChange: null,
      quoteChange: null,
      buildChange: null,
      simulationChange: null,
      blockerChanges: before.blockers.map((b) => `removed: ${b}`),
      nextSafeAction: "REMOVED from the after campaign — it is no longer compared. Live trading stays disabled.",
    };
  }
  // Both present.
  const b = before as SniperDryRunCampaignCandidate;
  const a = after as SniperDryRunCampaignCandidate;
  const scoreDelta = b.score !== null && a.score !== null ? a.score - b.score : null;
  const riskChange = fieldChange(b.riskDecision, a.riskDecision);
  const quoteChange = fieldChange(b.quoteStatus, a.quoteStatus);
  const buildChange = fieldChange(b.buildStatus, a.buildStatus);
  const simulationChange = fieldChange(b.simulationStatus, a.simulationStatus);
  const blockers = blockerChanges(b.blockers, a.blockers);
  const verdictChanged = b.finalOperatorVerdict !== a.finalOperatorVerdict;
  const changed =
    verdictChanged ||
    (scoreDelta !== null && scoreDelta !== 0) ||
    riskChange !== null ||
    quoteChange !== null ||
    buildChange !== null ||
    simulationChange !== null ||
    blockers.length > 0;

  let nextSafeAction: string;
  if (!changed) {
    nextSafeAction = `Unchanged (verdict ${a.finalOperatorVerdict}). No movement on the current evidence.`;
  } else if (verdictChanged) {
    const beforeRank = VERDICT_RANK[b.finalOperatorVerdict] ?? -1;
    const afterRank = VERDICT_RANK[a.finalOperatorVerdict] ?? -1;
    const dir = afterRank > beforeRank ? "IMPROVED" : afterRank < beforeRank ? "WORSENED" : "CHANGED";
    nextSafeAction = `${dir}: verdict ${b.finalOperatorVerdict} -> ${a.finalOperatorVerdict}. ${a.nextSafeAction}`;
  } else {
    nextSafeAction = `Evidence changed (verdict still ${a.finalOperatorVerdict}). Re-check the changed stage(s); live trading stays disabled.`;
  }

  return {
    mint,
    status: changed ? "changed" : "unchanged",
    scoreDelta,
    verdictBefore: b.finalOperatorVerdict,
    verdictAfter: a.finalOperatorVerdict,
    riskChange,
    quoteChange,
    buildChange,
    simulationChange,
    blockerChanges: blockers,
    nextSafeAction,
  };
}

function deriveSummary(changes: readonly SniperCampaignCandidateChange[]): SniperCampaignDiffSummary {
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;
  let changedCount = 0;
  let improvedCount = 0;
  let worsenedCount = 0;
  let newlyBlockedCount = 0;
  let newlyWatchCount = 0;
  for (const c of changes) {
    if (c.status === "added") addedCount++;
    else if (c.status === "removed") removedCount++;
    else if (c.status === "unchanged") unchangedCount++;
    else changedCount++;
    // improved / worsened only when BOTH verdicts present (no fake movement).
    if (c.verdictBefore !== null && c.verdictAfter !== null && c.verdictBefore !== c.verdictAfter) {
      const beforeRank = VERDICT_RANK[c.verdictBefore] ?? -1;
      const afterRank = VERDICT_RANK[c.verdictAfter] ?? -1;
      if (afterRank > beforeRank) improvedCount++;
      else if (afterRank < beforeRank) worsenedCount++;
      if (c.verdictAfter === "blocked") newlyBlockedCount++;
      if (c.verdictAfter === "watch") newlyWatchCount++;
    }
  }
  return { addedCount, removedCount, unchangedCount, changedCount, improvedCount, worsenedCount, newlyBlockedCount, newlyWatchCount };
}

// --- build -------------------------------------------------------------------

/**
 * Diff two validated campaigns into a canonical {@link SniperDryRunCampaignDiff}. Pure, non-mutating,
 * deterministic. Candidates are paired by canonical mint; the per-candidate change records and the
 * summary tallies are RE-DERIVED; the live-send / authorization literals are pinned. Throws
 * {@link SniperDryRunCampaignDiffError} on any structural problem.
 */
export function diffSniperDryRunCampaigns(input: DiffSniperDryRunCampaignsInput): SniperDryRunCampaignDiff {
  if (!isObject(input)) throw new SniperDryRunCampaignDiffError("diff input must be an object");
  if (!isObject(input.before) || !Array.isArray(input.before.candidates)) {
    throw new SniperDryRunCampaignDiffError("input.before must be a campaign object with a candidates array");
  }
  if (!isObject(input.after) || !Array.isArray(input.after.candidates)) {
    throw new SniperDryRunCampaignDiffError("input.after must be a campaign object with a candidates array");
  }

  const diffId = (safeLabel(input.diffId, "diffId", 128, true) as string | null) ?? "sniper-dryrun-campaign-diff";
  const comparedAt = safeLabel(input.comparedAt, "comparedAt", 40, true);
  const beforeCampaignRef = safeLabel(input.beforeCampaignRef, "beforeCampaignRef", MAX_LABEL_LEN, true);
  const afterCampaignRef = safeLabel(input.afterCampaignRef, "afterCampaignRef", MAX_LABEL_LEN, true);

  const beforeByMint = indexByMint(input.before);
  const afterByMint = indexByMint(input.after);
  const mints = [...new Set([...beforeByMint.keys(), ...afterByMint.keys()])].sort();

  const candidateChanges = mints.map((mint) => diffCandidate(mint, beforeByMint.get(mint), afterByMint.get(mint)));
  const summary = deriveSummary(candidateChanges);

  const extraCaveats = normalizeStringList(input.caveats, "caveats", MAX_LIST);

  return {
    schemaVersion: SNIPER_DRYRUN_CAMPAIGN_DIFF_SCHEMA_VERSION,
    banner: SNIPER_DRYRUN_CAMPAIGN_DIFF_BANNER,
    disclaimers: [...SNIPER_DRYRUN_CAMPAIGN_DIFF_DISCLAIMERS],
    diffId,
    comparedAt,
    beforeCampaignRef,
    afterCampaignRef,
    candidateChanges,
    summary,
    liveSendStatus: SNIPER_DRYRUN_CAMPAIGN_DIFF_LIVE_SEND_STATUS,
    authorizesLiveTrading: false,
    caveats: [...DEFAULT_CAVEATS, ...extraCaveats],
    redactionApplied: true,
    neverSends: true,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "diffId",
  "comparedAt",
  "beforeCampaignRef",
  "afterCampaignRef",
  "candidateChanges",
  "summary",
  "liveSendStatus",
  "authorizesLiveTrading",
  "caveats",
  "redactionApplied",
  "neverSends",
] as const;

const EXPECTED_CHANGE_KEYS = [
  "mint",
  "status",
  "scoreDelta",
  "verdictBefore",
  "verdictAfter",
  "riskChange",
  "quoteChange",
  "buildChange",
  "simulationChange",
  "blockerChanges",
  "nextSafeAction",
] as const;

const EXPECTED_SUMMARY_KEYS = [
  "addedCount",
  "removedCount",
  "unchangedCount",
  "changedCount",
  "improvedCount",
  "worsenedCount",
  "newlyBlockedCount",
  "newlyWatchCount",
] as const;

function validateChange(value: unknown, i: number): SniperCampaignCandidateChange {
  if (!isObject(value)) throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}] must be an object`);
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_CHANGE_KEYS as readonly string[]).includes(key)) {
      throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}] has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  try {
    parseMintAddress(value.mint);
  } catch (err) {
    throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}].mint: ${(err as Error).message}`);
  }
  if (!(SNIPER_CAMPAIGN_DIFF_STATUSES as readonly string[]).includes(value.status as string)) {
    throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}].status must be one of: ${SNIPER_CAMPAIGN_DIFF_STATUSES.join(", ")}`);
  }
  for (const v of ["verdictBefore", "verdictAfter"] as const) {
    const vv = value[v];
    if (vv !== null && !(SNIPER_CAMPAIGN_CANDIDATE_VERDICTS as readonly string[]).includes(vv as string)) {
      throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}].${v} must be null or a known campaign verdict`);
    }
  }
  if (value.scoreDelta !== null && typeof value.scoreDelta !== "number") {
    throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}].scoreDelta must be a number or null`);
  }
  if (!Array.isArray(value.blockerChanges) || (value.blockerChanges as unknown[]).some((b) => typeof b !== "string")) {
    throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}].blockerChanges must be an array of strings`);
  }
  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}].nextSafeAction must be a non-empty string`);
  }
  // Cross-check the status against the verdict presence (added=after only, removed=before only).
  if (value.status === "added" && value.verdictBefore !== null) {
    throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}] is added but has a verdictBefore`);
  }
  if (value.status === "removed" && value.verdictAfter !== null) {
    throw new SniperDryRunCampaignDiffError(`candidateChanges[${i}] is removed but has a verdictAfter`);
  }
  return value as unknown as SniperCampaignCandidateChange;
}

/**
 * Strictly validate a value as a canonical {@link SniperDryRunCampaignDiff}. A backstop AND a parity
 * wall: the key set is CLOSED (no `signature` / `txid` / `sendResult` field can appear); the banner /
 * live-send / authorization literals are pinned; each candidate change is well-formed; the summary
 * tallies are INDEPENDENTLY re-derived from the candidate changes and must match. Throws
 * {@link SniperDryRunCampaignDiffError} on the first problem. Pure.
 */
export function validateSniperDryRunCampaignDiff(value: unknown): SniperDryRunCampaignDiff {
  if (!isObject(value)) throw new SniperDryRunCampaignDiffError("diff must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperDryRunCampaignDiffError(`diff has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperDryRunCampaignDiffError(`diff is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_DRYRUN_CAMPAIGN_DIFF_SCHEMA_VERSION) {
    throw new SniperDryRunCampaignDiffError(`schemaVersion must be "${SNIPER_DRYRUN_CAMPAIGN_DIFF_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_DRYRUN_CAMPAIGN_DIFF_BANNER) throw new SniperDryRunCampaignDiffError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperDryRunCampaignDiffError("disclaimers must be a non-empty array");
  }
  safeLabel(value.diffId, "diffId", 128, false);
  safeLabel(value.comparedAt, "comparedAt", 40, true);
  safeLabel(value.beforeCampaignRef, "beforeCampaignRef", MAX_LABEL_LEN, true);
  safeLabel(value.afterCampaignRef, "afterCampaignRef", MAX_LABEL_LEN, true);

  if (!Array.isArray(value.candidateChanges)) throw new SniperDryRunCampaignDiffError("candidateChanges must be an array");
  const changes = (value.candidateChanges as unknown[]).map((c, i) => validateChange(c, i));

  if (!isObject(value.summary)) throw new SniperDryRunCampaignDiffError("summary must be an object");
  for (const key of Object.keys(value.summary)) {
    if (!(EXPECTED_SUMMARY_KEYS as readonly string[]).includes(key)) {
      throw new SniperDryRunCampaignDiffError(`summary has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  const summary = deriveSummary(changes);
  if (JSON.stringify(value.summary) !== JSON.stringify(summary)) {
    throw new SniperDryRunCampaignDiffError("summary must be re-derived from the candidate changes");
  }

  if (!Array.isArray(value.caveats) || (value.caveats as unknown[]).length === 0) {
    throw new SniperDryRunCampaignDiffError("caveats must be a non-empty array");
  }

  if (value.liveSendStatus !== SNIPER_DRYRUN_CAMPAIGN_DIFF_LIVE_SEND_STATUS) {
    throw new SniperDryRunCampaignDiffError(`liveSendStatus must literally be "${SNIPER_DRYRUN_CAMPAIGN_DIFF_LIVE_SEND_STATUS}" — a diff can never report live enabled`);
  }
  for (const [field, expected] of [
    ["authorizesLiveTrading", false],
    ["redactionApplied", true],
    ["neverSends", true],
  ] as const) {
    if (value[field] !== expected) throw new SniperDryRunCampaignDiffError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as SniperDryRunCampaignDiff;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperDryRunCampaignDiff}. */
export interface FormatSniperDryRunCampaignDiffOptions {
  label?: string;
  /** Cap on the number of change rows printed (default 100). */
  maxRows?: number;
}

/** Render a redacted, stable, human-readable diff summary. Deterministic. */
export function formatSniperDryRunCampaignDiff(diff: SniperDryRunCampaignDiff, opts: FormatSniperDryRunCampaignDiffOptions = {}): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${diff.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`id:       ${diff.diffId}`);
  lines.push(`live:     ${diff.liveSendStatus.toUpperCase()} (authorizes live trading: ${String(diff.authorizesLiveTrading)})`);
  const s = diff.summary;
  lines.push(`summary:  +${s.addedCount} added · -${s.removedCount} removed · ${s.changedCount} changed · ${s.unchangedCount} unchanged`);
  lines.push(`movement: ${s.improvedCount} improved · ${s.worsenedCount} worsened · ${s.newlyBlockedCount} newly-blocked · ${s.newlyWatchCount} newly-watch`);

  lines.push("");
  lines.push("Changes:");
  const shown = diff.candidateChanges.filter((c) => c.status !== "unchanged").slice(0, maxRows);
  for (const c of shown) {
    const bits: string[] = [];
    if (c.scoreDelta !== null && c.scoreDelta !== 0) bits.push(`score ${c.scoreDelta > 0 ? "+" : ""}${c.scoreDelta}`);
    if (c.riskChange !== null) bits.push(`risk ${c.riskChange}`);
    if (c.quoteChange !== null) bits.push(`quote ${c.quoteChange}`);
    if (c.buildChange !== null) bits.push(`build ${c.buildChange}`);
    if (c.simulationChange !== null) bits.push(`sim ${c.simulationChange}`);
    const verdict = c.verdictBefore !== null || c.verdictAfter !== null ? ` [${c.verdictBefore ?? "—"} -> ${c.verdictAfter ?? "—"}]` : "";
    lines.push(`[${c.status}] ${c.mint}${verdict}${bits.length > 0 ? `  (${bits.join("; ")})` : ""}`);
    for (const b of c.blockerChanges) lines.push(`    blocker ${b}`);
  }
  if (shown.length === 0) lines.push("(no changes)");

  lines.push("");
  lines.push("Caveats:");
  for (const c of diff.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of diff.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
