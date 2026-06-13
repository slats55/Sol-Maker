/**
 * Deterministic, **read-only** PHASE 7 LIVE-AUTHORIZATION AUDIT artifact (Sprint 103).
 *
 * `phase7.authorization.audit.v1` is the written, versioned answer to a single question: *is the
 * repository ready to proceed to a SEPARATELY-approved S104 controlled mainnet micro-trade?* It
 * folds the evidence an auditor gathers — the fourteen-condition live gate, the no-send invariant,
 * the signer / Rust / redaction / reconciliation boundaries, the command surface, and the open
 * micro-trade prerequisites — into one auditable verdict.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work. The orchestrator gathers the
 * evidence (machine-checking the cheap structural facts and recording declared test references) and
 * hands it here. The builder never authorizes live trading and is structurally incapable of doing so:
 *
 *   - `auditedMode` is the literal `"phase7-live-authorization-review"`;
 *   - `liveExecutionAuthorized` / `authorizesLiveTrading` are pinned false, `neverSends` pinned true,
 *     `phase7LiveTradingReady` false, `requiresSeparateApproval` true;
 *   - the VERDICT is RE-DERIVED from the structured evidence alone — it DEFAULTS to `not-authorized`
 *     and reaches the best state only when every safety invariant is verified.
 *
 * The closed verdict set is, in increasing readiness (and NONE of them ever executes a trade):
 *
 *   - `not-authorized`                              — at least one required safety check is missing,
 *     unverified, failed, or a blocker remains;
 *   - `authorized-for-design-only`                  — every safety invariant is verified, but at least
 *     one operational micro-trade prerequisite is still open (e.g. a devnet broadcast never landed);
 *   - `ready-for-separate-microtrade-authorization` — every safety invariant verified AND every
 *     micro-trade prerequisite met. This is the BEST outcome and still authorizes NOTHING: it means
 *     "the repo is ready to be CONSIDERED for a separately, explicitly approved S104 micro-trade."
 *
 * The gate set supplied by the auditor is cross-checked against the REAL fourteen-condition gate ids
 * from {@link evaluateMainnetLiveGate}: if a future sprint adds or removes a gate condition, this
 * audit refuses to build until the dossier is updated to match.
 */

import { redactString } from "@soulmaker/security";
import { evaluateMainnetLiveGate } from "./live-gate.js";

/** Stable schema identifier. Bump only on a breaking change. */
export const PHASE7_AUTHORIZATION_AUDIT_SCHEMA_VERSION = "phase7.authorization.audit.v1";

/** The banner that prefixes every audit artifact (required label). */
export const PHASE7_AUTHORIZATION_AUDIT_BANNER =
  "PHASE 7 LIVE-AUTHORIZATION AUDIT — a read-only security review. THIS DOCUMENT AUTHORIZES NO LIVE TRADING.";

/** The fixed audited mode. There is no input that can change it. */
export const PHASE7_AUTHORIZATION_AUDIT_MODE = "phase7-live-authorization-review";

/** Required disclaimer statements carried by every audit artifact (stable order). */
export const PHASE7_AUTHORIZATION_AUDIT_DISCLAIMERS: readonly string[] = [
  "PHASE 7 LIVE-AUTHORIZATION AUDIT — a read-only review of the repository's no-send invariant, execution gates, and boundaries.",
  "This artifact authorizes NO live trading and executes NO trade. It is structurally incapable of arming, signing, or sending.",
  "The best possible verdict, 'ready-for-separate-microtrade-authorization', means the repo is ready to be CONSIDERED for a micro-trade — never that one is approved.",
  "A controlled S104 mainnet micro-trade requires a separate, explicit, written user authorization AFTER this audit; this document is not that authorization.",
  "Not a live result. Not a trade signal. Not financial advice. Not a profitability claim.",
];

/** Closed verdict set, in precedence order (least ready first). */
export const PHASE7_AUTHORIZATION_AUDIT_VERDICTS = [
  "not-authorized",
  "authorized-for-design-only",
  "ready-for-separate-microtrade-authorization",
] as const;
export type Phase7AuthorizationAuditVerdict = (typeof PHASE7_AUTHORIZATION_AUDIT_VERDICTS)[number];

/** The closed status set an invariant / gate may carry. */
export const PHASE7_AUDIT_CHECK_STATUSES = ["verified", "unverified", "failed"] as const;
export type Phase7AuditCheckStatus = (typeof PHASE7_AUDIT_CHECK_STATUSES)[number];

/** The closed command-surface verdict. */
export const PHASE7_AUDIT_SURFACE_STATUSES = ["safe", "unsafe"] as const;
export type Phase7AuditSurfaceStatus = (typeof PHASE7_AUDIT_SURFACE_STATUSES)[number];

const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;

/** Thrown when an audit INPUT or produced artifact is structurally invalid. */
export class Phase7AuthorizationAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase7AuthorizationAuditError";
  }
}

// --- evidence model ----------------------------------------------------------

/** One of the fourteen live-gate conditions, audited. */
export interface Phase7AuditGate {
  gateId: string;
  name: string;
  defaultState: string;
  evidenceSource: string;
  failClosedProven: boolean;
  testCoverageRef: string | null;
  status: Phase7AuditCheckStatus;
  blocker: string | null;
}

/** A single boundary / invariant, audited. */
export interface Phase7AuditInvariant {
  status: Phase7AuditCheckStatus;
  evidence: string;
  detail: string | null;
}

/** The command-surface conclusion. */
export interface Phase7AuditCommandSurface {
  status: Phase7AuditSurfaceStatus;
  evidence: string;
  detail: string | null;
}

/** One operational prerequisite for *considering* a controlled micro-trade. */
export interface Phase7AuditPrerequisite {
  id: string;
  description: string;
  met: boolean;
  detail: string | null;
}

/** Everything {@link buildPhase7AuthorizationAudit} accepts. */
export interface BuildPhase7AuthorizationAuditInput {
  auditId: string;
  repoSha: string;
  auditedAt?: string | null;
  gates: Phase7AuditGate[];
  noSendInvariant: Phase7AuditInvariant;
  signerBoundary: Phase7AuditInvariant;
  rustBoundary: Phase7AuditInvariant;
  artifactRedaction: Phase7AuditInvariant;
  releaseCandidate: Phase7AuditInvariant;
  reconciliationWall: Phase7AuditInvariant;
  commandSurface: Phase7AuditCommandSurface;
  microTradePrerequisites: Phase7AuditPrerequisite[];
  additionalBlockers?: string[];
  caveats?: string[];
}

// --- artifact model ----------------------------------------------------------

/** The full, deterministic, JSON-serializable Phase 7 authorization audit artifact. */
export interface Phase7AuthorizationAudit {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  auditId: string;
  repoSha: string;
  auditedAt: string | null;
  auditedMode: "phase7-live-authorization-review";
  verdict: Phase7AuthorizationAuditVerdict;
  gateCount: number;
  gates: Phase7AuditGate[];
  noSendInvariant: Phase7AuditInvariant;
  signerBoundary: Phase7AuditInvariant;
  rustBoundary: Phase7AuditInvariant;
  artifactRedaction: Phase7AuditInvariant;
  releaseCandidate: Phase7AuditInvariant;
  reconciliationWall: Phase7AuditInvariant;
  commandSurface: Phase7AuditCommandSurface;
  microTradePrerequisites: Phase7AuditPrerequisite[];
  remainingBlockers: string[];
  nextSafeAction: string;
  caveats: string[];
  /** Pinned safety locks the validator refuses to see flipped. */
  liveExecutionAuthorized: false;
  authorizesLiveTrading: false;
  requiresSeparateApproval: true;
  neverSends: true;
  phase7LiveTradingReady: false;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reject any string carrying a control character / NUL / DEL / C1 control / BOM / line-or-paragraph
 * separator (terminal-injection + corruption vectors). Implemented with charCodeAt rather than a
 * regex literal so no control byte is ever embedded in this source file.
 */
function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new Phase7AuthorizationAuditError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new Phase7AuthorizationAuditError(`${name} is required`);
  }
  if (typeof value !== "string") throw new Phase7AuthorizationAuditError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new Phase7AuthorizationAuditError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new Phase7AuthorizationAuditError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new Phase7AuthorizationAuditError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

/**
 * Like {@link safeLabel} but for descriptive PROSE (detail / blocker lines): instead of refusing a
 * string the redactor would touch, it stores the REDACTED form. Idempotent, so the validator's
 * re-normalization yields the same string. Use for free text, never for identifiers / paths.
 */
function safeProse(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new Phase7AuthorizationAuditError(`${name} is required`);
  }
  if (typeof value !== "string") throw new Phase7AuthorizationAuditError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new Phase7AuthorizationAuditError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new Phase7AuthorizationAuditError(`${name} exceeds ${max} characters`);
  return redactString(trimmed);
}

function reqBool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Phase7AuthorizationAuditError(`${name} must be a boolean`);
  return value;
}

function reqStatus(value: unknown, name: string): Phase7AuditCheckStatus {
  if (typeof value !== "string" || !(PHASE7_AUDIT_CHECK_STATUSES as readonly string[]).includes(value)) {
    throw new Phase7AuthorizationAuditError(`${name} must be one of: ${PHASE7_AUDIT_CHECK_STATUSES.join(", ")}`);
  }
  return value as Phase7AuditCheckStatus;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Phase7AuthorizationAuditError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new Phase7AuthorizationAuditError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string" || s.trim().length === 0) {
      throw new Phase7AuthorizationAuditError(`${name}[${i}] must be a non-empty string`);
    }
    const trimmed = s.trim();
    if (trimmed.length > MAX_LINE_LEN) throw new Phase7AuthorizationAuditError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    return redactString(trimmed);
  });
}

function normalizeInvariant(raw: unknown, name: string): Phase7AuditInvariant {
  if (!isObject(raw)) throw new Phase7AuthorizationAuditError(`${name} must be an object`);
  return {
    status: reqStatus(raw.status, `${name}.status`),
    evidence: safeLabel(raw.evidence, `${name}.evidence`, MAX_LABEL_LEN, false) as string,
    detail: safeProse(raw.detail, `${name}.detail`, MAX_LINE_LEN, true),
  };
}

function normalizeGate(raw: unknown, index: number): Phase7AuditGate {
  if (!isObject(raw)) throw new Phase7AuthorizationAuditError(`gates[${index}] must be an object`);
  return {
    gateId: safeLabel(raw.gateId, `gates[${index}].gateId`, 64, false) as string,
    name: safeLabel(raw.name, `gates[${index}].name`, MAX_LABEL_LEN, false) as string,
    defaultState: safeLabel(raw.defaultState, `gates[${index}].defaultState`, 64, false) as string,
    evidenceSource: safeLabel(raw.evidenceSource, `gates[${index}].evidenceSource`, MAX_LABEL_LEN, false) as string,
    failClosedProven: reqBool(raw.failClosedProven, `gates[${index}].failClosedProven`),
    testCoverageRef: safeLabel(raw.testCoverageRef, `gates[${index}].testCoverageRef`, MAX_LABEL_LEN, true),
    status: reqStatus(raw.status, `gates[${index}].status`),
    blocker: safeProse(raw.blocker, `gates[${index}].blocker`, MAX_LINE_LEN, true),
  };
}

function normalizePrerequisite(raw: unknown, index: number): Phase7AuditPrerequisite {
  if (!isObject(raw)) throw new Phase7AuthorizationAuditError(`microTradePrerequisites[${index}] must be an object`);
  return {
    id: safeLabel(raw.id, `microTradePrerequisites[${index}].id`, 64, false) as string,
    description: safeProse(raw.description, `microTradePrerequisites[${index}].description`, MAX_LINE_LEN, false) as string,
    met: reqBool(raw.met, `microTradePrerequisites[${index}].met`),
    detail: safeProse(raw.detail, `microTradePrerequisites[${index}].detail`, MAX_LINE_LEN, true),
  };
}

function normalizeCommandSurface(raw: unknown): Phase7AuditCommandSurface {
  if (!isObject(raw)) throw new Phase7AuthorizationAuditError("commandSurface must be an object");
  if (typeof raw.status !== "string" || !(PHASE7_AUDIT_SURFACE_STATUSES as readonly string[]).includes(raw.status)) {
    throw new Phase7AuthorizationAuditError(`commandSurface.status must be one of: ${PHASE7_AUDIT_SURFACE_STATUSES.join(", ")}`);
  }
  return {
    status: raw.status as Phase7AuditSurfaceStatus,
    evidence: safeLabel(raw.evidence, "commandSurface.evidence", MAX_LABEL_LEN, false) as string,
    detail: safeProse(raw.detail, "commandSurface.detail", MAX_LINE_LEN, true),
  };
}

// --- verdict derivation (the parity heart) -----------------------------------

/** Inputs the verdict derivation reads. Pure; default / missing evidence → not-authorized. */
export interface Phase7VerdictEvidence {
  commandSurfaceSafe: boolean;
  invariantsVerified: boolean;
  gatesCoverCanonicalFourteen: boolean;
  gatesAllVerified: boolean;
  noOpenBlockers: boolean;
  prerequisitesPresent: boolean;
  prerequisitesAllMet: boolean;
}

/**
 * Re-derive the closed verdict from structured evidence ALONE. DEFAULTS to `not-authorized`: the
 * best states require EVERY safety invariant verified. A complete release-candidate, a high score,
 * or any single passing check can never reach a non-`not-authorized` verdict on its own. Pure.
 */
export function derivePhase7AuthorizationVerdict(ev: Phase7VerdictEvidence): Phase7AuthorizationAuditVerdict {
  const safetyVerified =
    ev.commandSurfaceSafe &&
    ev.invariantsVerified &&
    ev.gatesCoverCanonicalFourteen &&
    ev.gatesAllVerified &&
    ev.noOpenBlockers;
  if (!safetyVerified) return "not-authorized";
  if (ev.prerequisitesPresent && ev.prerequisitesAllMet) return "ready-for-separate-microtrade-authorization";
  return "authorized-for-design-only";
}

/** The REAL fourteen canonical gate ids, taken from the live gate itself. */
export function canonicalLiveGateIds(): string[] {
  return evaluateMainnetLiveGate({}).checks.map((c) => c.gate);
}

function verdictEvidenceFromArtifact(a: {
  gates: Phase7AuditGate[];
  invariants: Phase7AuditInvariant[];
  commandSurface: Phase7AuditCommandSurface;
  microTradePrerequisites: Phase7AuditPrerequisite[];
  remainingBlockers: string[];
}): Phase7VerdictEvidence {
  const canonical = canonicalLiveGateIds();
  const suppliedIds = a.gates.map((g) => g.gateId);
  const gatesCoverCanonicalFourteen =
    suppliedIds.length === canonical.length &&
    canonical.every((id) => suppliedIds.includes(id)) &&
    new Set(suppliedIds).size === suppliedIds.length;
  return {
    commandSurfaceSafe: a.commandSurface.status === "safe",
    invariantsVerified: a.invariants.every((i) => i.status === "verified"),
    gatesCoverCanonicalFourteen,
    gatesAllVerified: a.gates.every(
      (g) => g.status === "verified" && g.failClosedProven && g.testCoverageRef !== null && g.blocker === null,
    ),
    noOpenBlockers: a.remainingBlockers.length === 0,
    prerequisitesPresent: a.microTradePrerequisites.length > 0,
    prerequisitesAllMet: a.microTradePrerequisites.every((p) => p.met),
  };
}

// --- next-safe-action derivation ---------------------------------------------

function deriveNextSafeAction(verdict: Phase7AuthorizationAuditVerdict, openPrereqs: Phase7AuditPrerequisite[]): string {
  switch (verdict) {
    case "not-authorized":
      return "Resolve every unverified/failed safety check and open blocker named in this audit; Phase 7 stays NOT AUTHORIZED until they are clean. Do not implement a mainnet send.";
    case "authorized-for-design-only":
      return `The safety architecture is verified, but ${openPrereqs.length} operational prerequisite(s) remain open (${openPrereqs.map((p) => p.id).join(", ") || "see prerequisites"}). Close them; Phase 7 live execution stays unauthorized.`;
    case "ready-for-separate-microtrade-authorization":
      return "The repo is ready to be CONSIDERED for a controlled S104 micro-trade. This requires a separate, explicit, written user authorization first; nothing here executes a trade.";
  }
}

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link Phase7AuthorizationAudit} from gathered evidence. Pure, non-mutating,
 * deterministic. The verdict is RE-DERIVED from the evidence and DEFAULTS to `not-authorized`; the
 * supplied gate set must cover EXACTLY the fourteen canonical live-gate ids. Throws
 * {@link Phase7AuthorizationAuditError} on any structural problem.
 */
export function buildPhase7AuthorizationAudit(input: BuildPhase7AuthorizationAuditInput): Phase7AuthorizationAudit {
  if (!isObject(input)) throw new Phase7AuthorizationAuditError("audit input must be an object");

  const auditId = safeLabel(input.auditId, "auditId", 128, false) as string;
  const repoSha = safeLabel(input.repoSha, "repoSha", 64, false) as string;
  const auditedAt = safeLabel(input.auditedAt, "auditedAt", 40, true);

  if (!Array.isArray(input.gates)) throw new Phase7AuthorizationAuditError("gates must be an array");
  if (input.gates.length > MAX_LIST) throw new Phase7AuthorizationAuditError(`gates exceeds ${MAX_LIST} entries`);
  const gates = input.gates.map((g, i) => normalizeGate(g, i));

  const noSendInvariant = normalizeInvariant(input.noSendInvariant, "noSendInvariant");
  const signerBoundary = normalizeInvariant(input.signerBoundary, "signerBoundary");
  const rustBoundary = normalizeInvariant(input.rustBoundary, "rustBoundary");
  const artifactRedaction = normalizeInvariant(input.artifactRedaction, "artifactRedaction");
  const releaseCandidate = normalizeInvariant(input.releaseCandidate, "releaseCandidate");
  const reconciliationWall = normalizeInvariant(input.reconciliationWall, "reconciliationWall");
  const commandSurface = normalizeCommandSurface(input.commandSurface);

  if (!Array.isArray(input.microTradePrerequisites)) {
    throw new Phase7AuthorizationAuditError("microTradePrerequisites must be an array");
  }
  if (input.microTradePrerequisites.length > MAX_LIST) {
    throw new Phase7AuthorizationAuditError(`microTradePrerequisites exceeds ${MAX_LIST} entries`);
  }
  const microTradePrerequisites = input.microTradePrerequisites.map((p, i) => normalizePrerequisite(p, i));

  // Remaining blockers: explicit input blockers + every gate/invariant/prereq that is not clean.
  const derivedBlockers: string[] = [];
  for (const g of gates) {
    if (g.status !== "verified") derivedBlockers.push(`gate ${g.gateId}: ${g.blocker ?? `status is ${g.status}`}`);
    else if (!g.failClosedProven) derivedBlockers.push(`gate ${g.gateId}: fail-closed behavior not proven`);
    else if (g.testCoverageRef === null) derivedBlockers.push(`gate ${g.gateId}: no test coverage reference`);
  }
  const invariantPairs: Array<[string, Phase7AuditInvariant]> = [
    ["no-send-invariant", noSendInvariant],
    ["signer-boundary", signerBoundary],
    ["rust-boundary", rustBoundary],
    ["artifact-redaction", artifactRedaction],
    ["release-candidate", releaseCandidate],
    ["reconciliation-wall", reconciliationWall],
  ];
  for (const [id, inv] of invariantPairs) {
    if (inv.status !== "verified") derivedBlockers.push(`${id}: status is ${inv.status}${inv.detail ? ` (${inv.detail})` : ""}`);
  }
  if (commandSurface.status !== "safe") {
    derivedBlockers.push(`command-surface: ${commandSurface.detail ?? "unsafe surface detected"}`);
  }
  const explicitBlockers = normalizeStringList(input.additionalBlockers, "additionalBlockers", MAX_LIST);
  const remainingBlockers = [...explicitBlockers, ...derivedBlockers].slice(0, MAX_LIST);

  const verdict = derivePhase7AuthorizationVerdict(
    verdictEvidenceFromArtifact({
      gates,
      invariants: invariantPairs.map(([, inv]) => inv),
      commandSurface,
      microTradePrerequisites,
      remainingBlockers,
    }),
  );

  const openPrereqs = microTradePrerequisites.filter((p) => !p.met);
  const nextSafeAction = deriveNextSafeAction(verdict, openPrereqs);

  const caveats = normalizeStringList(
    input.caveats ?? [
      "Every gate/invariant status here is a declaration plus the cheap structural fact the auditor could machine-check; read the named test references for the full proof.",
      "A 'verified' status means the structural check passed and the named test guards it — it is never a claim that live trading is safe.",
      "Even the best verdict authorizes nothing: a controlled S104 micro-trade needs a separate, explicit, written authorization.",
    ],
    "caveats",
    MAX_LIST,
  );

  return {
    schemaVersion: PHASE7_AUTHORIZATION_AUDIT_SCHEMA_VERSION,
    banner: PHASE7_AUTHORIZATION_AUDIT_BANNER,
    disclaimers: [...PHASE7_AUTHORIZATION_AUDIT_DISCLAIMERS],
    auditId,
    repoSha,
    auditedAt,
    auditedMode: PHASE7_AUTHORIZATION_AUDIT_MODE,
    verdict,
    gateCount: gates.length,
    gates,
    noSendInvariant,
    signerBoundary,
    rustBoundary,
    artifactRedaction,
    releaseCandidate,
    reconciliationWall,
    commandSurface,
    microTradePrerequisites,
    remainingBlockers,
    nextSafeAction,
    caveats,
    liveExecutionAuthorized: false,
    authorizesLiveTrading: false,
    requiresSeparateApproval: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "auditId",
  "repoSha",
  "auditedAt",
  "auditedMode",
  "verdict",
  "gateCount",
  "gates",
  "noSendInvariant",
  "signerBoundary",
  "rustBoundary",
  "artifactRedaction",
  "releaseCandidate",
  "reconciliationWall",
  "commandSurface",
  "microTradePrerequisites",
  "remainingBlockers",
  "nextSafeAction",
  "caveats",
  "liveExecutionAuthorized",
  "authorizesLiveTrading",
  "requiresSeparateApproval",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

/**
 * Strictly validate a value as a canonical {@link Phase7AuthorizationAudit} and return it narrowed.
 * A backstop AND a parity wall: the key set is CLOSED; the audited-mode and safety literals are
 * pinned; the verdict is INDEPENDENTLY re-derived from the echoed evidence and must match — so no
 * tampered status can promote the verdict past what the evidence supports. Throws
 * {@link Phase7AuthorizationAuditError} on the first problem. Pure.
 */
export function validatePhase7AuthorizationAudit(value: unknown): Phase7AuthorizationAudit {
  if (!isObject(value)) throw new Phase7AuthorizationAuditError("audit must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new Phase7AuthorizationAuditError(`audit has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new Phase7AuthorizationAuditError(`audit is missing field "${key}"`);
  }

  if (value.schemaVersion !== PHASE7_AUTHORIZATION_AUDIT_SCHEMA_VERSION) {
    throw new Phase7AuthorizationAuditError(`schemaVersion must be "${PHASE7_AUTHORIZATION_AUDIT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE7_AUTHORIZATION_AUDIT_BANNER) {
    throw new Phase7AuthorizationAuditError("banner must be the canonical banner");
  }
  if (value.auditedMode !== PHASE7_AUTHORIZATION_AUDIT_MODE) {
    throw new Phase7AuthorizationAuditError(`auditedMode must literally be "${PHASE7_AUTHORIZATION_AUDIT_MODE}"`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase7AuthorizationAuditError("disclaimers must be a non-empty array");
  }
  if (!(PHASE7_AUTHORIZATION_AUDIT_VERDICTS as readonly string[]).includes(value.verdict as string)) {
    throw new Phase7AuthorizationAuditError(`verdict must be one of: ${PHASE7_AUTHORIZATION_AUDIT_VERDICTS.join(", ")}`);
  }

  // Re-validate the top-level identifier/metadata fields (control chars / secret-shaped / length)
  // so a post-build tamper cannot ride in under auditId / repoSha / auditedAt.
  safeLabel(value.auditId, "auditId", 128, false);
  safeLabel(value.repoSha, "repoSha", 64, false);
  safeLabel(value.auditedAt, "auditedAt", 40, true);

  // Re-normalize every nested structure (validates each field) and re-derive the verdict.
  if (!Array.isArray(value.gates)) throw new Phase7AuthorizationAuditError("gates must be an array");
  const gates = (value.gates as unknown[]).map((g, i) => normalizeGate(g, i));
  if (value.gateCount !== gates.length) throw new Phase7AuthorizationAuditError("gateCount must equal gates.length");

  const noSendInvariant = normalizeInvariant(value.noSendInvariant, "noSendInvariant");
  const signerBoundary = normalizeInvariant(value.signerBoundary, "signerBoundary");
  const rustBoundary = normalizeInvariant(value.rustBoundary, "rustBoundary");
  const artifactRedaction = normalizeInvariant(value.artifactRedaction, "artifactRedaction");
  const releaseCandidate = normalizeInvariant(value.releaseCandidate, "releaseCandidate");
  const reconciliationWall = normalizeInvariant(value.reconciliationWall, "reconciliationWall");
  const commandSurface = normalizeCommandSurface(value.commandSurface);

  if (!Array.isArray(value.microTradePrerequisites)) {
    throw new Phase7AuthorizationAuditError("microTradePrerequisites must be an array");
  }
  const microTradePrerequisites = (value.microTradePrerequisites as unknown[]).map((p, i) => normalizePrerequisite(p, i));
  if (!Array.isArray(value.remainingBlockers)) throw new Phase7AuthorizationAuditError("remainingBlockers must be an array");
  const remainingBlockers = normalizeStringList(value.remainingBlockers, "remainingBlockers", MAX_LIST);

  const expectedVerdict = derivePhase7AuthorizationVerdict(
    verdictEvidenceFromArtifact({
      gates,
      invariants: [noSendInvariant, signerBoundary, rustBoundary, artifactRedaction, releaseCandidate, reconciliationWall],
      commandSurface,
      microTradePrerequisites,
      remainingBlockers,
    }),
  );
  if (value.verdict !== expectedVerdict) {
    throw new Phase7AuthorizationAuditError(
      `verdict must be ${JSON.stringify(expectedVerdict)} (re-derived from the echoed evidence), got ${JSON.stringify(value.verdict)}`,
    );
  }

  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new Phase7AuthorizationAuditError("nextSafeAction must be a non-empty string");
  }
  if (!Array.isArray(value.caveats) || value.caveats.length === 0) {
    throw new Phase7AuthorizationAuditError("caveats must be a non-empty array");
  }

  for (const [field, expected] of [
    ["liveExecutionAuthorized", false],
    ["authorizesLiveTrading", false],
    ["requiresSeparateApproval", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) throw new Phase7AuthorizationAuditError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as Phase7AuthorizationAudit;
}
