/**
 * Deterministic, **read-only** PHASE 7 HUMAN SIGN-OFF record (Sprint 103-B).
 *
 * `phase7.human_signoff.record.v1` is the clean mechanism for a FUTURE human to record an explicit,
 * written Phase 7 authorization — WITHOUT this repository ever self-authorizing live trading. The
 * default record is a `template-only` checklist; a record only reaches a SIGNED status when every
 * required acknowledgement for the target scope is explicitly supplied along with an operator label,
 * a signed-at label, and (for a controlled micro-trade) a bounded max-spend.
 *
 * It is **pure** and authorizes NOTHING by construction:
 *
 *   - the safety requirements are pinned literals (`manualConfirmationRequired` / `burnerWalletRequired`
 *     / `oneTradeOnly` / `noAutonomousTrading` / `killSwitchRequired` / `reconciliationRequired` all
 *     true; `authorizesLiveExecution` false; `requiresSeparateExecutionSprint` true; `neverSends` true);
 *   - `signoffStatus` is RE-DERIVED from the supplied acknowledgements/labels and DEFAULTS to
 *     `template-only`; the validator independently re-derives it and refuses a tampered status;
 *   - `grantedScope` is RE-DERIVED from the status and can never exceed
 *     `controlled-mainnet-microtrade-only` (there is no broader scope in the closed set);
 *   - even the strongest record, `signed-for-controlled-microtrade`, is EVIDENCE only — it never
 *     creates a mainnet send, and a controlled micro-trade still needs the full fourteen-condition
 *     live gate and a separate, reviewed execution sprint.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier. Bump only on a breaking change. */
export const PHASE7_HUMAN_SIGNOFF_SCHEMA_VERSION = "phase7.human_signoff.record.v1";

/** The banner that prefixes every sign-off record (required label). */
export const PHASE7_HUMAN_SIGNOFF_BANNER =
  "PHASE 7 HUMAN SIGN-OFF — a written authorization RECORD. It authorizes no live trade by itself; even when fully signed it is evidence only and a controlled micro-trade still needs the fourteen-condition live gate and a separate, reviewed execution sprint.";

/** Required disclaimer statements carried by every record (stable order). */
export const PHASE7_HUMAN_SIGNOFF_DISCLAIMERS: readonly string[] = [
  "This record does not send, sign, or arm anything. It is structurally incapable of executing a trade.",
  "A SIGNED record is EVIDENCE that a human approved the design/scope — never that a trade is approved to run here and now.",
  "A controlled mainnet micro-trade additionally requires the full fourteen-condition live gate to pass with real evidence and a separate, reviewed S104 sprint.",
  "Live trading stays DISABLED. No flag, env var, or config in this repo can substitute for a fresh human decision at execution time.",
];

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * The micro-trade spend ceiling (0.05 SOL). The dossier requires "a few dollars at most"; a
 * controlled-microtrade sign-off that names a larger max-spend is structurally refused.
 */
export const PHASE7_MICROTRADE_MAX_SPEND_LAMPORTS = 50_000_000;

/** Closed sign-off status set, least → most committed. */
export const PHASE7_SIGNOFF_STATUSES = [
  "not-signed",
  "template-only",
  "signed-for-s104-design",
  "signed-for-controlled-microtrade",
] as const;
export type Phase7SignoffStatus = (typeof PHASE7_SIGNOFF_STATUSES)[number];

/** Closed target/authorization scope set. `none` is only ever a DERIVED (granted) value. */
export const PHASE7_SIGNOFF_SCOPES = ["none", "design-review-only", "controlled-mainnet-microtrade-only"] as const;
export type Phase7SignoffScope = (typeof PHASE7_SIGNOFF_SCOPES)[number];

/** The scope a record is worked TOWARD (a template defaults to the full micro-trade checklist). */
export const PHASE7_SIGNOFF_TARGET_SCOPES = ["design-review-only", "controlled-mainnet-microtrade-only"] as const;
export type Phase7SignoffTargetScope = (typeof PHASE7_SIGNOFF_TARGET_SCOPES)[number];

/** One required acknowledgement. `tier` "design" acks are required for BOTH scopes. */
export interface Phase7SignoffAcknowledgement {
  id: string;
  text: string;
}

interface CanonicalAck extends Phase7SignoffAcknowledgement {
  tier: "design" | "microtrade";
}

/** The canonical acknowledgement checklist (design acks + the dossier §12 micro-trade controls). */
const CANONICAL_ACKNOWLEDGEMENTS: readonly CanonicalAck[] = [
  {
    id: "read-dossier",
    tier: "design",
    text: "I have read docs/PHASE7_AUTHORIZATION_DOSSIER.md and understand this repo is paper/devnet only with live trading disabled.",
  },
  {
    id: "authorizes-nothing-by-itself",
    tier: "design",
    text: "I understand this sign-off is evidence only and authorizes no live trade by itself; a separate, reviewed execution sprint and the full fourteen-condition live gate are still required.",
  },
  {
    id: "no-autonomous-trading",
    tier: "design",
    text: "I understand there is no autonomous, looped, or scheduled trading; any future trade is a single, human-initiated attempt.",
  },
  {
    id: "burner-wallet-only",
    tier: "microtrade",
    text: "Any controlled micro-trade uses a dedicated burner wallet funded with a tiny, disposable amount — never a primary or treasury wallet.",
  },
  {
    id: "one-trade-tiny-manual",
    tier: "microtrade",
    text: "One trade only (maxTradesPerSession = 1), a tiny capped spend, and an explicit manual confirmation at send time.",
  },
  {
    id: "quote-sim-risk-gates",
    tier: "microtrade",
    text: "A fresh quote, a passing simulation of the exact unsigned envelope, an under-cap advisory risk, and Token-2022 blocker refusal are all required immediately before send.",
  },
  {
    id: "kill-switch-and-reconcile",
    tier: "microtrade",
    text: "The kill switch / emergency stop must be clear, and post-trade reconciliation is required before the continuation wall reopens.",
  },
];

const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 32;

/** Thrown when a sign-off INPUT or produced record is structurally invalid. */
export class Phase7HumanSignoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase7HumanSignoffError";
  }
}

/** Everything {@link buildPhase7HumanSignoff} accepts. */
export interface BuildPhase7HumanSignoffInput {
  recordId?: string;
  repoSha?: string;
  auditArtifactRef?: string | null;
  /** The scope the record is worked toward (default the full controlled-microtrade checklist). */
  targetScope?: Phase7SignoffTargetScope;
  /** The acknowledgement ids a human explicitly checked. */
  acknowledgedIds?: string[];
  operatorLabel?: string | null;
  signedAtLabel?: string | null;
  maxSpendLamports?: number | null;
  caveats?: string[];
}

/** The full, deterministic, JSON-serializable Phase 7 human sign-off record. */
export interface Phase7HumanSignoffRecord {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  recordId: string;
  repoSha: string;
  auditArtifactRef: string | null;
  targetScope: Phase7SignoffTargetScope;
  signoffStatus: Phase7SignoffStatus;
  grantedScope: Phase7SignoffScope;
  requiredAcknowledgements: Phase7SignoffAcknowledgement[];
  acknowledgedAcknowledgementIds: string[];
  missingAcknowledgements: string[];
  operatorLabel: string | null;
  signedAtLabel: string | null;
  maxSpendLamports: number | null;
  maxSpendSol: number | null;
  nextSafeAction: string;
  caveats: string[];
  /** Pinned safety locks the validator refuses to see flipped. */
  manualConfirmationRequired: true;
  burnerWalletRequired: true;
  oneTradeOnly: true;
  noAutonomousTrading: true;
  killSwitchRequired: true;
  reconciliationRequired: true;
  authorizesLiveExecution: false;
  requiresSeparateExecutionSprint: true;
  neverSends: true;
  phase7LiveTradingReady: false;
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
      throw new Phase7HumanSignoffError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new Phase7HumanSignoffError(`${name} is required`);
  }
  if (typeof value !== "string") throw new Phase7HumanSignoffError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new Phase7HumanSignoffError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new Phase7HumanSignoffError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new Phase7HumanSignoffError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Phase7HumanSignoffError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new Phase7HumanSignoffError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string" || s.trim().length === 0) throw new Phase7HumanSignoffError(`${name}[${i}] must be a non-empty string`);
    const trimmed = s.trim();
    if (trimmed.length > MAX_LINE_LEN) throw new Phase7HumanSignoffError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    return redactString(trimmed);
  });
}

function reqTargetScope(value: unknown): Phase7SignoffTargetScope {
  const scope = value ?? "controlled-mainnet-microtrade-only";
  if (typeof scope !== "string" || !(PHASE7_SIGNOFF_TARGET_SCOPES as readonly string[]).includes(scope)) {
    throw new Phase7HumanSignoffError(`targetScope must be one of: ${PHASE7_SIGNOFF_TARGET_SCOPES.join(", ")}`);
  }
  return scope as Phase7SignoffTargetScope;
}

/** Validate + dedupe the acknowledged ids against the canonical checklist (unknown id is refused). */
function normalizeAcknowledgedIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Phase7HumanSignoffError("acknowledgedIds must be an array of strings");
  if (value.length > MAX_LIST) throw new Phase7HumanSignoffError(`acknowledgedIds exceeds ${MAX_LIST} entries`);
  const known = new Set(CANONICAL_ACKNOWLEDGEMENTS.map((a) => a.id));
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") throw new Phase7HumanSignoffError("acknowledgedIds entries must be strings");
    const id = raw.trim();
    if (!known.has(id)) throw new Phase7HumanSignoffError(`acknowledgedIds contains an unknown acknowledgement id "${redactString(id).slice(0, 64)}"`);
    seen.add(id);
  }
  // Return in canonical order for determinism.
  return CANONICAL_ACKNOWLEDGEMENTS.filter((a) => seen.has(a.id)).map((a) => a.id);
}

// --- derivation (the parity heart) -------------------------------------------

/** The required acknowledgement ids for a target scope: design acks always; micro acks for micro. */
export function requiredAcknowledgementsFor(targetScope: Phase7SignoffTargetScope): Phase7SignoffAcknowledgement[] {
  return CANONICAL_ACKNOWLEDGEMENTS.filter(
    (a) => a.tier === "design" || targetScope === "controlled-mainnet-microtrade-only",
  ).map((a) => ({ id: a.id, text: a.text }));
}

/** Inputs the status derivation reads. Pure; defaults to `template-only`. */
export interface Phase7SignoffEvidence {
  targetScope: Phase7SignoffTargetScope;
  acknowledgedIds: string[];
  operatorPresent: boolean;
  signedAtPresent: boolean;
  maxSpendPresent: boolean;
  anyInputSupplied: boolean;
}

/**
 * Re-derive the closed sign-off status from the supplied evidence ALONE. DEFAULTS to `template-only`
 * when nothing was supplied; only reaches a SIGNED status when every required acknowledgement for the
 * target scope is present along with the operator + signed-at labels (and, for micro, a max-spend).
 * Pure.
 */
export function derivePhase7SignoffStatus(ev: Phase7SignoffEvidence): Phase7SignoffStatus {
  if (!ev.anyInputSupplied) return "template-only";
  const required = requiredAcknowledgementsFor(ev.targetScope).map((a) => a.id);
  const acknowledged = new Set(ev.acknowledgedIds);
  const allAcked = required.every((id) => acknowledged.has(id));
  const microSpendOk = ev.targetScope !== "controlled-mainnet-microtrade-only" || ev.maxSpendPresent;
  const complete = allAcked && ev.operatorPresent && ev.signedAtPresent && microSpendOk;
  if (!complete) return "not-signed";
  return ev.targetScope === "controlled-mainnet-microtrade-only" ? "signed-for-controlled-microtrade" : "signed-for-s104-design";
}

/** The granted scope is DERIVED from the status — it can never exceed controlled-microtrade. */
export function grantedScopeFor(status: Phase7SignoffStatus): Phase7SignoffScope {
  switch (status) {
    case "signed-for-s104-design":
      return "design-review-only";
    case "signed-for-controlled-microtrade":
      return "controlled-mainnet-microtrade-only";
    default:
      return "none";
  }
}

function deriveNextSafeAction(status: Phase7SignoffStatus, missing: string[]): string {
  switch (status) {
    case "template-only":
      return "This is a blank Phase 7 sign-off template. A human must read the dossier and re-run paper:phase7:signoff:template with --acknowledge <id> for every required acknowledgement, --operator-label, --signed-at, and (for a micro-trade) --max-spend-sol. Nothing is authorized.";
    case "not-signed":
      return `Incomplete: ${missing.length} acknowledgement(s) still missing (${missing.join(", ") || "see requiredAcknowledgements"}), or the operator/signed-at/max-spend labels are absent. The record stays unsigned and authorizes nothing.`;
    case "signed-for-s104-design":
      return "Design-review sign-off recorded. This does NOT satisfy the controlled-micro-trade prerequisite — it authorizes a design review only, never a live trade.";
    case "signed-for-controlled-microtrade":
      return "Controlled micro-trade sign-off recorded as EVIDENCE. A trade still requires the full fourteen-condition live gate with real evidence AND a separate, reviewed S104 execution sprint. This record never sends.";
  }
}

const DEFAULT_CAVEATS: readonly string[] = [
  "A signed record is human approval of scope/design — never an instruction to execute a trade now.",
  "Live trading stays disabled here; this record creates no mainnet send command and arms no gate.",
  "Even a controlled micro-trade sign-off is one of several prerequisites; the fourteen-condition live gate must still pass with real evidence in a separate sprint.",
];

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link Phase7HumanSignoffRecord}. Pure, non-mutating, deterministic. The status
 * and scope are RE-DERIVED from the supplied acknowledgements/labels and DEFAULT to `template-only`;
 * a controlled-microtrade record that names a max-spend above the micro ceiling is refused. Throws
 * {@link Phase7HumanSignoffError} on any structural problem.
 */
export function buildPhase7HumanSignoff(input: BuildPhase7HumanSignoffInput = {}): Phase7HumanSignoffRecord {
  if (!isObject(input)) throw new Phase7HumanSignoffError("sign-off input must be an object");

  const recordId = (safeLabel(input.recordId, "recordId", 128, true) as string | null) ?? "phase7-human-signoff-template";
  const repoSha = (safeLabel(input.repoSha, "repoSha", 64, true) as string | null) ?? "unspecified";
  const auditArtifactRef = safeLabel(input.auditArtifactRef, "auditArtifactRef", MAX_LABEL_LEN, true);
  const targetScope = reqTargetScope(input.targetScope);
  const acknowledgedIds = normalizeAcknowledgedIds(input.acknowledgedIds);
  const operatorLabel = safeLabel(input.operatorLabel, "operatorLabel", MAX_LABEL_LEN, true);
  const signedAtLabel = safeLabel(input.signedAtLabel, "signedAtLabel", 40, true);

  let maxSpendLamports: number | null = null;
  if (input.maxSpendLamports !== undefined && input.maxSpendLamports !== null) {
    if (typeof input.maxSpendLamports !== "number" || !Number.isInteger(input.maxSpendLamports) || input.maxSpendLamports <= 0) {
      throw new Phase7HumanSignoffError("maxSpendLamports must be a positive integer (lamports)");
    }
    if (targetScope !== "controlled-mainnet-microtrade-only") {
      throw new Phase7HumanSignoffError("maxSpendLamports is only meaningful for a controlled-mainnet-microtrade-only sign-off");
    }
    if (input.maxSpendLamports > PHASE7_MICROTRADE_MAX_SPEND_LAMPORTS) {
      throw new Phase7HumanSignoffError(`maxSpendLamports exceeds the micro-trade ceiling of ${PHASE7_MICROTRADE_MAX_SPEND_LAMPORTS} lamports (${PHASE7_MICROTRADE_MAX_SPEND_LAMPORTS / LAMPORTS_PER_SOL} SOL)`);
    }
    maxSpendLamports = input.maxSpendLamports;
  }

  const requiredAcknowledgements = requiredAcknowledgementsFor(targetScope);
  const requiredIds = requiredAcknowledgements.map((a) => a.id);
  const acknowledgedSet = new Set(acknowledgedIds);
  const missingAcknowledgements = requiredIds.filter((id) => !acknowledgedSet.has(id));

  const anyInputSupplied =
    acknowledgedIds.length > 0 || operatorLabel !== null || signedAtLabel !== null || maxSpendLamports !== null;
  const signoffStatus = derivePhase7SignoffStatus({
    targetScope,
    acknowledgedIds,
    operatorPresent: operatorLabel !== null,
    signedAtPresent: signedAtLabel !== null,
    maxSpendPresent: maxSpendLamports !== null,
    anyInputSupplied,
  });
  const grantedScope = grantedScopeFor(signoffStatus);

  // max-spend is only retained on a fully-signed controlled-microtrade record.
  const recordedMaxSpend = signoffStatus === "signed-for-controlled-microtrade" ? maxSpendLamports : null;
  const recordedMaxSpendSol = recordedMaxSpend === null ? null : recordedMaxSpend / LAMPORTS_PER_SOL;

  const nextSafeAction = deriveNextSafeAction(signoffStatus, missingAcknowledgements);
  const caveats = normalizeStringList(input.caveats ?? [...DEFAULT_CAVEATS], "caveats", MAX_LIST);

  return {
    schemaVersion: PHASE7_HUMAN_SIGNOFF_SCHEMA_VERSION,
    banner: PHASE7_HUMAN_SIGNOFF_BANNER,
    disclaimers: [...PHASE7_HUMAN_SIGNOFF_DISCLAIMERS],
    recordId,
    repoSha,
    auditArtifactRef,
    targetScope,
    signoffStatus,
    grantedScope,
    requiredAcknowledgements,
    acknowledgedAcknowledgementIds: acknowledgedIds,
    missingAcknowledgements,
    operatorLabel,
    signedAtLabel,
    maxSpendLamports: recordedMaxSpend,
    maxSpendSol: recordedMaxSpendSol,
    nextSafeAction,
    caveats,
    manualConfirmationRequired: true,
    burnerWalletRequired: true,
    oneTradeOnly: true,
    noAutonomousTrading: true,
    killSwitchRequired: true,
    reconciliationRequired: true,
    authorizesLiveExecution: false,
    requiresSeparateExecutionSprint: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "recordId",
  "repoSha",
  "auditArtifactRef",
  "targetScope",
  "signoffStatus",
  "grantedScope",
  "requiredAcknowledgements",
  "acknowledgedAcknowledgementIds",
  "missingAcknowledgements",
  "operatorLabel",
  "signedAtLabel",
  "maxSpendLamports",
  "maxSpendSol",
  "nextSafeAction",
  "caveats",
  "manualConfirmationRequired",
  "burnerWalletRequired",
  "oneTradeOnly",
  "noAutonomousTrading",
  "killSwitchRequired",
  "reconciliationRequired",
  "authorizesLiveExecution",
  "requiresSeparateExecutionSprint",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const PINNED_LOCKS = [
  ["manualConfirmationRequired", true],
  ["burnerWalletRequired", true],
  ["oneTradeOnly", true],
  ["noAutonomousTrading", true],
  ["killSwitchRequired", true],
  ["reconciliationRequired", true],
  ["authorizesLiveExecution", false],
  ["requiresSeparateExecutionSprint", true],
  ["neverSends", true],
  ["phase7LiveTradingReady", false],
] as const;

/**
 * Strictly validate a value as a canonical {@link Phase7HumanSignoffRecord} and return it narrowed.
 * A backstop AND a parity wall: the key set is CLOSED; the safety locks are pinned literals; the
 * sign-off status, granted scope, required/missing acknowledgement sets, and the max-spend are
 * INDEPENDENTLY re-derived from the echoed evidence and must match — so no tampered status can claim
 * a stronger authorization than the acknowledgements support. Throws {@link Phase7HumanSignoffError}.
 * Pure.
 */
export function validatePhase7HumanSignoff(value: unknown): Phase7HumanSignoffRecord {
  if (!isObject(value)) throw new Phase7HumanSignoffError("sign-off must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new Phase7HumanSignoffError(`sign-off has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new Phase7HumanSignoffError(`sign-off is missing field "${key}"`);
  }

  if (value.schemaVersion !== PHASE7_HUMAN_SIGNOFF_SCHEMA_VERSION) {
    throw new Phase7HumanSignoffError(`schemaVersion must be "${PHASE7_HUMAN_SIGNOFF_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE7_HUMAN_SIGNOFF_BANNER) throw new Phase7HumanSignoffError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase7HumanSignoffError("disclaimers must be a non-empty array");
  }

  safeLabel(value.recordId, "recordId", 128, false);
  safeLabel(value.repoSha, "repoSha", 64, false);
  safeLabel(value.auditArtifactRef, "auditArtifactRef", MAX_LABEL_LEN, true);

  if (typeof value.targetScope !== "string" || !(PHASE7_SIGNOFF_TARGET_SCOPES as readonly string[]).includes(value.targetScope)) {
    throw new Phase7HumanSignoffError(`targetScope must be one of: ${PHASE7_SIGNOFF_TARGET_SCOPES.join(", ")}`);
  }
  const targetScope = value.targetScope as Phase7SignoffTargetScope;

  if (!(PHASE7_SIGNOFF_STATUSES as readonly string[]).includes(value.signoffStatus as string)) {
    throw new Phase7HumanSignoffError(`signoffStatus must be one of: ${PHASE7_SIGNOFF_STATUSES.join(", ")}`);
  }
  if (!(PHASE7_SIGNOFF_SCOPES as readonly string[]).includes(value.grantedScope as string)) {
    throw new Phase7HumanSignoffError(`grantedScope must be one of: ${PHASE7_SIGNOFF_SCOPES.join(", ")}`);
  }

  // Re-derive the required acknowledgement set and cross-check it against the echoed list.
  const expectedRequired = requiredAcknowledgementsFor(targetScope);
  if (!Array.isArray(value.requiredAcknowledgements) || value.requiredAcknowledgements.length !== expectedRequired.length) {
    throw new Phase7HumanSignoffError("requiredAcknowledgements does not match the canonical set for the target scope");
  }
  for (let i = 0; i < expectedRequired.length; i++) {
    const got = value.requiredAcknowledgements[i];
    if (!isObject(got) || got.id !== expectedRequired[i]!.id || got.text !== expectedRequired[i]!.text) {
      throw new Phase7HumanSignoffError(`requiredAcknowledgements[${i}] does not match the canonical acknowledgement`);
    }
  }

  const acknowledgedIds = normalizeAcknowledgedIds(value.acknowledgedAcknowledgementIds);
  // The stored order/content must already be canonical (no duplicates, known ids, canonical order).
  const storedAckIds = Array.isArray(value.acknowledgedAcknowledgementIds) ? (value.acknowledgedAcknowledgementIds as unknown[]) : null;
  if (storedAckIds === null || storedAckIds.length !== acknowledgedIds.length || acknowledgedIds.some((id, i) => storedAckIds[i] !== id)) {
    throw new Phase7HumanSignoffError("acknowledgedAcknowledgementIds must be the canonical, de-duplicated id list");
  }

  const operatorPresent = safeLabel(value.operatorLabel, "operatorLabel", MAX_LABEL_LEN, true) !== null;
  const signedAtPresent = safeLabel(value.signedAtLabel, "signedAtLabel", 40, true) !== null;

  // Re-validate + re-derive the max-spend.
  if (value.maxSpendLamports !== null) {
    if (typeof value.maxSpendLamports !== "number" || !Number.isInteger(value.maxSpendLamports) || value.maxSpendLamports <= 0) {
      throw new Phase7HumanSignoffError("maxSpendLamports must be null or a positive integer");
    }
    if (value.maxSpendLamports > PHASE7_MICROTRADE_MAX_SPEND_LAMPORTS) {
      throw new Phase7HumanSignoffError("maxSpendLamports exceeds the micro-trade ceiling");
    }
  }
  const expectedSol = value.maxSpendLamports === null ? null : (value.maxSpendLamports as number) / LAMPORTS_PER_SOL;
  if (value.maxSpendSol !== expectedSol) throw new Phase7HumanSignoffError("maxSpendSol must equal maxSpendLamports / 1e9 (re-derived)");

  // Re-derive the status from the echoed evidence and require a match (the parity wall).
  const anyInputSupplied =
    acknowledgedIds.length > 0 || operatorPresent || signedAtPresent || value.maxSpendLamports !== null;
  const expectedStatus = derivePhase7SignoffStatus({
    targetScope,
    acknowledgedIds,
    operatorPresent,
    signedAtPresent,
    maxSpendPresent: value.maxSpendLamports !== null,
    anyInputSupplied,
  });
  if (value.signoffStatus !== expectedStatus) {
    throw new Phase7HumanSignoffError(`signoffStatus must be ${JSON.stringify(expectedStatus)} (re-derived from the echoed evidence), got ${JSON.stringify(value.signoffStatus)}`);
  }
  const expectedScope = grantedScopeFor(expectedStatus);
  if (value.grantedScope !== expectedScope) {
    throw new Phase7HumanSignoffError(`grantedScope must be ${JSON.stringify(expectedScope)} (re-derived from the status), got ${JSON.stringify(value.grantedScope)}`);
  }
  // A max-spend can only be retained on a fully-signed controlled-microtrade record.
  if (expectedStatus !== "signed-for-controlled-microtrade" && value.maxSpendLamports !== null) {
    throw new Phase7HumanSignoffError("maxSpendLamports must be null unless the record is signed-for-controlled-microtrade");
  }

  const expectedMissing = expectedRequired.map((a) => a.id).filter((id) => !acknowledgedIds.includes(id));
  const storedMissing = Array.isArray(value.missingAcknowledgements) ? (value.missingAcknowledgements as unknown[]) : null;
  if (storedMissing === null || storedMissing.length !== expectedMissing.length || expectedMissing.some((id, i) => storedMissing[i] !== id)) {
    throw new Phase7HumanSignoffError("missingAcknowledgements must be the re-derived set of unmet required acknowledgements");
  }

  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new Phase7HumanSignoffError("nextSafeAction must be a non-empty string");
  }
  if (!Array.isArray(value.caveats) || value.caveats.length === 0) throw new Phase7HumanSignoffError("caveats must be a non-empty array");

  for (const [field, expected] of PINNED_LOCKS) {
    if (value[field] !== expected) throw new Phase7HumanSignoffError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as Phase7HumanSignoffRecord;
}
