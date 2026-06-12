/**
 * Deterministic, offline **SIMULATION ROUTE RESOLUTION V1** (`simulation.route.resolution.v1`,
 * Sprint 85 — the provenance layer the dry-run boundary design names as its FIRST prerequisite).
 *
 * `PHASE6_DRY_RUN_BOUNDARY.md` is explicit: what blocks a real dry-run is not the absence of a
 * signature — it is UNRESOLVED INPUTS. No validated route, destination, or fee data exists
 * anywhere in the paper chain, and the pipeline never invents any. This artifact is the honest,
 * auditable, per-entry record of exactly that state:
 *
 *   - It consumes a strictly-validated `simulation.intent.plan.v2` and records, for every preview
 *     entry, whether a route / destination / fee fact exists (`resolved-as-label`) or does not
 *     (`unresolved`) — never an operator-typed address accepted silently, never a value invented.
 *   - Inside THIS package no route-resolution capability exists (and none can: the import
 *     allowlist refuses every network/chain module), so the canonical builder records every entry
 *     as UNAVAILABLE under the fixed {@link SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID}
 *     resolver id. A future, separately-reviewed-and-authorized resolution layer would produce
 *     artifacts that pass THIS validator with label-resolved facts — and the validator then
 *     REQUIRES the live-state caveat, because real route facts can only come from live chain
 *     state and must never be mistaken for deterministic fixtures.
 *   - Fail-closed: a missing/invalid/blocked plan or a declared stop-simulation switch BLOCKS the
 *     artifact (stable reason codes; zero entries). `resolved` is REFUSED unless every required
 *     route/destination/fee fact is present. Every mirror (status, tallies, the three reason-code
 *     trails, the caveat, the next safe action) is RECOMPUTED by the validator — a contradictory
 *     mirror is refused, never trusted. The v1 schema is CLOSED: an unknown, sensitive-named, or
 *     execution-shaped field is refused outright.
 *
 * The artifact carries the four literal safety locks and an ALWAYS-false
 * `phase7LiveTradingReady`. It is not live trading, not a buy recommendation, and not a
 * transaction approval. Pure: no I/O, no network, no wallet, no wall-clock.
 */

import { redactString, isSensitiveKey } from "@soulmaker/security";
import {
  SIMULATION_PACKAGE_DISCLAIMERS,
  SIMULATION_OPERATOR_SAFETY_LINE,
  SIMULATION_SAFETY_LITERALS,
  assertSimulationSafetyLiterals,
} from "./safety.js";
import {
  SIMULATION_REASON_CODE_DEFINITIONS,
  dedupeSimulationReasonCodes,
  isSimulationReasonCode,
  type SimulationReasonCode,
} from "./reason-codes.js";
import {
  validateSimulationIntentPlanV2,
  SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
  type SimulationIntentPlanV2,
  type SimulationPreviewField,
} from "./intent-plan.js";

/** Stable schema identifier for the v1 route-resolution artifact. Bump only on a breaking change. */
export const SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION = "simulation.route.resolution.v1";

/** The banner that prefixes every route-resolution artifact (required label). */
export const SIMULATION_ROUTE_RESOLUTION_V1_BANNER =
  "SIMULATION ROUTE RESOLUTION V1 (ROUTE PROVENANCE ONLY — NOT LIVE TRADING, NOT A BUY RECOMMENDATION, NOT A TRANSACTION APPROVAL; NEVER SIGNS, NEVER SENDS)";

/** The fixed `generatedBy` marker (deterministic provenance; never an operator value). */
export const SIMULATION_ROUTE_RESOLUTION_V1_GENERATED_BY = "@soulmaker/simulation";

/** The canonical resolver id when NO route-resolution capability exists (the only id this
 * package's builder can ever emit — it can never claim an attempt). */
export const SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID = "unavailable-no-route-resolver";

/** Required disclaimer statements carried by every route-resolution artifact (stable order). */
export const SIMULATION_ROUTE_RESOLUTION_V1_DISCLAIMERS: readonly string[] = [
  "SIMULATION ROUTE RESOLUTION V1 — the honest per-entry record of which route/destination/fee facts exist for a validated intent plan; an unresolved fact stays unresolved, never invented, and `resolved` is refused unless every required fact is present.",
  "Not live trading, not a buy recommendation, not a transaction approval: this artifact only DESCRIBES route-resolution state so a future, separately-authorized dry-run boundary can know what honestly exists.",
  "A label-resolved fact can only come from LIVE chain state — the artifact then carries an explicit live-state caveat and must never be mistaken for a deterministic fixture.",
  "phase7LiveTradingReady is ALWAYS false: a route-resolution artifact is structurally incapable of claiming live-trading readiness, and the validator refuses anything else.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when route-resolution INPUT or a produced artifact is structurally invalid. */
export class SimulationRouteResolutionV1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationRouteResolutionV1Error";
  }
}

// --- model -------------------------------------------------------------------

/** Per-entry resolution statuses (closed set). `unavailable` = no resolver could even attempt;
 * `unresolved` = a resolver attempted but required facts are still missing; `resolved` = EVERY
 * required route/destination/fee fact is label-resolved (anything less is refused). */
export const SIMULATION_ROUTE_RESOLUTION_ENTRY_STATUSES = ["resolved", "unresolved", "unavailable"] as const;

/** One of the per-entry resolution statuses. */
export type SimulationRouteResolutionEntryStatus = (typeof SIMULATION_ROUTE_RESOLUTION_ENTRY_STATUSES)[number];

/** Artifact-level statuses (closed set; conservative precedence — see the builder doc). */
export const SIMULATION_ROUTE_RESOLUTION_STATUSES = [
  "blocked",
  "no_entries",
  "unavailable",
  "unresolved",
  "resolved",
] as const;

/** One of the artifact-level statuses. */
export type SimulationRouteResolutionStatus = (typeof SIMULATION_ROUTE_RESOLUTION_STATUSES)[number];

/** What this artifact knows about its source plan (presence/validity recorded, never invented). */
export interface SimulationRouteResolutionPlanRef {
  /** Always the v2 plan schema id — the only input route resolution accepts. */
  expectedSchemaVersion: string;
  present: boolean;
  /** null when absent; otherwise whether the strict plan validator accepted it. */
  valid: boolean | null;
  /** The sniffed schemaVersion of what was supplied (null when absent/unsniffable). */
  suppliedSchemaVersion: string | null;
  /** The plan's own labels/state, VERBATIM — null unless the plan strictly validated. */
  planLabel: string | null;
  operatorLabel: string | null;
  blocked: boolean | null;
  entryCount: number | null;
}

/** One plan entry's route-resolution record (label-only facts; nothing executable, ever). */
export interface SimulationRouteResolutionEntryV1 {
  candidateId: string;
  mint: string;
  routeResolutionStatus: SimulationRouteResolutionEntryStatus;
  /** Label-only facts ({@link SimulationPreviewField}): a fact either exists as a validated label
   * with provenance or is honestly unresolved — never a transaction, never an instruction. */
  routePreview: SimulationPreviewField;
  destinationPreview: SimulationPreviewField;
  feePreview: SimulationPreviewField;
  /** The names of the unresolved facts, stable order (route, destination, fee). */
  unresolvedFields: string[];
  reasonCodes: SimulationReasonCode[];
  operatorText: string;
}

/** The full, deterministic, JSON-serializable v1 route-resolution artifact. */
export interface SimulationRouteResolutionV1 {
  schemaVersion: string;
  banner: string;
  generatedBy: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  // --- the four literal safety locks (validated; can never be anything else) ---
  neverAuthorizesLiveTrading: true;
  neverSigns: true;
  neverSends: true;
  dryRunOnly: true;
  /** ALWAYS false — route resolution can never claim live-trading readiness (validated literal). */
  phase7LiveTradingReady: false;
  disclaimers: string[];
  operatorLabel: string | null;
  resolutionLabel: string | null;
  sourcePlanRef: SimulationRouteResolutionPlanRef;
  /** INERT metadata naming the resolver — kebab-case, never sensitive-named, never a capability. */
  routeResolverId: string;
  /** True iff a resolver actually attempted resolution. The canonical no-resolver id can NEVER
   * claim an attempt, and a blocked artifact never attempts anything. */
  routeResolverAttempted: boolean;
  /** The operator-declared stop-simulation switch state this artifact was built under. */
  stopSimulationDeclaredTripped: boolean;
  resolutionStatus: SimulationRouteResolutionStatus;
  /** True iff blockingReasonCodes is non-empty (a blocked artifact carries zero entries). */
  blocked: boolean;
  /** True iff ANY label-resolved fact is present — real route facts can only come from live chain
   * state, so this caveat is recomputed, surfaced as a warning code, and can never be omitted. */
  liveStateCaveat: boolean;
  blockingReasonCodes: SimulationReasonCode[];
  warningReasonCodes: SimulationReasonCode[];
  outcomeReasonCodes: SimulationReasonCode[];
  entries: SimulationRouteResolutionEntryV1[];
  entryCount: number;
  resolvedEntryCount: number;
  unresolvedEntryCount: number;
  unavailableEntryCount: number;
  /** One deterministic next safe action, recomputed from the artifact's own status. */
  nextSafeAction: string;
  notes: string[];
}

/** One label-only route fact a separately-validated quote layer supplies (Sprint 91). Labels are
 * INERT strings with provenance — never a transaction, never an instruction, never an address the
 * pipeline acts on. A missing label stays honestly unresolved. */
export interface SimulationRouteFactEntryInput {
  /** Must match a plan entry's candidateId exactly (a fact for an unknown candidate THROWS). */
  candidateId: string;
  /** Must match that plan entry's mint exactly (a contradiction THROWS — fail closed). */
  mint: string;
  routeLabel?: string | null;
  destinationLabel?: string | null;
  feeLabel?: string | null;
}

/** Quote-derived route facts for {@link buildSimulationRouteResolutionV1} (Sprint 91): an inert
 * provenance id plus per-candidate label facts. Supplying this NEVER unblocks a blocked chain —
 * a blocked plan still produces a blocked artifact with zero entries and no attempt recorded. */
export interface SimulationRouteFactsInput {
  /** Kebab-case provenance id (e.g. "routequote-operator-supplied"). It can never be the
   * canonical no-resolver id and can never look like key material. */
  resolverId: string;
  facts: SimulationRouteFactEntryInput[];
}

/** Everything {@link buildSimulationRouteResolutionV1} needs. Plan problems BLOCK (never throw). */
export interface BuildSimulationRouteResolutionV1Input {
  /** `simulation.intent.plan.v2` (required; missing/invalid/blocked BLOCKS the artifact). */
  intentPlan?: unknown;
  /** Operator-declared stop-simulation kill-switch state (default false; true BLOCKS). */
  stopSimulationTripped?: boolean;
  /** Optional operator label echoed into the artifact. */
  operatorLabel?: string | null;
  /** Optional resolution label echoed into the artifact. */
  resolutionLabel?: string | null;
  /** Optional quote-derived label facts (Sprint 91; strictly shape-validated — malformed facts,
   * a fact for a candidate not in the plan, a mint contradiction, or a duplicate THROW). */
  routeFacts?: SimulationRouteFactsInput | null;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sniffSchemaVersion(value: unknown): string | null {
  return isObject(value) && typeof value.schemaVersion === "string" ? value.schemaVersion : null;
}

/** The v1 schema is CLOSED. Refuse any sensitive-named key (pointedly) and any unknown key — a
 * transaction-, signing-, sending-, or key-shaped field can never ride along on this artifact. */
function assertClosedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      throw new SimulationRouteResolutionV1Error(
        `${where} carries sensitive-named field "${key}" — key material can never ride along on a route-resolution artifact`,
      );
    }
    if (!allowed.has(key)) {
      throw new SimulationRouteResolutionV1Error(
        `${where} carries unknown field "${key}" — the v1 route-resolution schema is CLOSED; transaction-, signing-, sending-, or any other foreign field is refused`,
      );
    }
  }
}

// --- route-facts input validation (Sprint 91) ----------------------------------

const ROUTE_FACTS_KEYS: ReadonlySet<string> = new Set(["resolverId", "facts"]);
const ROUTE_FACT_ENTRY_KEYS: ReadonlySet<string> = new Set([
  "candidateId",
  "mint",
  "routeLabel",
  "destinationLabel",
  "feeLabel",
]);

/** One canonical (null-normalized) route fact after strict shape validation. */
interface CanonicalRouteFact {
  candidateId: string;
  mint: string;
  routeLabel: string | null;
  destinationLabel: string | null;
  feeLabel: string | null;
}

/** Validate one optional fact label: a string must be non-empty and must survive the shared
 * redactor UNCHANGED — a secret-shaped value is refused and NEVER echoed back. */
function validateFactLabel(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new SimulationRouteResolutionV1Error(`${name} must be a non-empty string or null`);
  }
  if (redactString(value) !== value) {
    throw new SimulationRouteResolutionV1Error(`${name} carries a secret-shaped value — refused (and never echoed)`);
  }
  return value;
}

/** Strictly validate the optional quote-derived facts input SHAPE (throws — never downgrades). */
function validateRouteFactsInput(value: unknown): {
  resolverId: string;
  facts: CanonicalRouteFact[];
} {
  if (!isObject(value)) throw new SimulationRouteResolutionV1Error("route resolution input.routeFacts must be an object");
  assertClosedKeys(value, ROUTE_FACTS_KEYS, "route resolution input.routeFacts");
  if (typeof value.resolverId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.resolverId)) {
    throw new SimulationRouteResolutionV1Error("route resolution input.routeFacts.resolverId must be a kebab-case identifier");
  }
  if (isSensitiveKey(value.resolverId)) {
    throw new SimulationRouteResolutionV1Error(
      "route resolution input.routeFacts.resolverId is sensitive-shaped — a resolver id can never look like key material",
    );
  }
  if (value.resolverId === SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID) {
    throw new SimulationRouteResolutionV1Error(
      `route resolution input.routeFacts.resolverId can never be "${SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID}" — the no-resolver id can never supply facts`,
    );
  }
  if (!Array.isArray(value.facts)) {
    throw new SimulationRouteResolutionV1Error("route resolution input.routeFacts.facts must be an array");
  }
  const seen = new Set<string>();
  const facts = value.facts.map((raw, i) => {
    const where = `route resolution input.routeFacts.facts[${i}]`;
    if (!isObject(raw)) throw new SimulationRouteResolutionV1Error(`${where} must be an object`);
    assertClosedKeys(raw as unknown as Record<string, unknown>, ROUTE_FACT_ENTRY_KEYS, where);
    if (!nonEmptyString(raw.candidateId)) throw new SimulationRouteResolutionV1Error(`${where}.candidateId must be a non-empty string`);
    if (!nonEmptyString(raw.mint)) throw new SimulationRouteResolutionV1Error(`${where}.mint must be a non-empty string`);
    if (seen.has(raw.candidateId)) {
      throw new SimulationRouteResolutionV1Error(`${where} duplicates candidateId "${raw.candidateId}" — duplicate facts are refused`);
    }
    seen.add(raw.candidateId);
    return {
      candidateId: raw.candidateId,
      mint: raw.mint,
      routeLabel: validateFactLabel(raw.routeLabel, `${where}.routeLabel`),
      destinationLabel: validateFactLabel(raw.destinationLabel, `${where}.destinationLabel`),
      feeLabel: validateFactLabel(raw.feeLabel, `${where}.feeLabel`),
    };
  });
  return { resolverId: value.resolverId, facts };
}

// --- shared recomputation (single source for the builder AND the validator) ----

/** The artifact-level blocking codes, recomputed from the plan ref + the declared stop switch. */
function computeBlockingCodes(
  ref: Pick<SimulationRouteResolutionPlanRef, "present" | "valid" | "blocked">,
  stopTripped: boolean,
): SimulationReasonCode[] {
  return dedupeSimulationReasonCodes([
    ...(!ref.present ? (["simulation-route-resolution-missing-plan"] as SimulationReasonCode[]) : []),
    ...(ref.present && ref.valid !== true ? (["simulation-route-resolution-invalid-plan"] as SimulationReasonCode[]) : []),
    ...(ref.valid === true && ref.blocked === true ? (["simulation-route-resolution-blocked-plan"] as SimulationReasonCode[]) : []),
    ...(stopTripped ? (["simulation-blocked-kill-switch-stop"] as SimulationReasonCode[]) : []),
  ]);
}

interface ExpectedEntryState {
  status: SimulationRouteResolutionEntryStatus;
  unresolvedFields: string[];
  reasonCodes: SimulationReasonCode[];
}

/** One entry's expected status / unresolved fields / code trail, recomputed from its facts.
 * Returns null for the one contradiction no state can express: an unattempted resolution that
 * somehow carries a resolved fact. */
function computeEntryState(
  resolverAttempted: boolean,
  routePreview: SimulationPreviewField,
  destinationPreview: SimulationPreviewField,
  feePreview: SimulationPreviewField,
): ExpectedEntryState | null {
  const unresolvedFields = [
    ...(routePreview.status === "unresolved" ? ["route"] : []),
    ...(destinationPreview.status === "unresolved" ? ["destination"] : []),
    ...(feePreview.status === "unresolved" ? ["fee"] : []),
  ];
  if (!resolverAttempted) {
    if (unresolvedFields.length !== 3) return null;
    return {
      status: "unavailable",
      unresolvedFields,
      reasonCodes: ["simulation-route-resolution-unavailable-no-resolver"],
    };
  }
  if (unresolvedFields.length === 0) {
    return { status: "resolved", unresolvedFields, reasonCodes: ["simulation-route-resolution-entry-resolved"] };
  }
  const codeFor: Record<string, SimulationReasonCode> = {
    route: "simulation-route-resolution-unresolved-route",
    destination: "simulation-route-resolution-unresolved-destination",
    fee: "simulation-route-resolution-unresolved-fee",
  };
  return {
    status: "unresolved",
    unresolvedFields,
    reasonCodes: unresolvedFields.map((f) => codeFor[f]!),
  };
}

/** The artifact-level status, recomputed with conservative precedence (worst state wins). */
function computeArtifactStatus(
  blocked: boolean,
  entries: readonly SimulationRouteResolutionEntryV1[],
): SimulationRouteResolutionStatus {
  if (blocked) return "blocked";
  if (entries.length === 0) return "no_entries";
  if (entries.some((e) => e.routeResolutionStatus === "unavailable")) return "unavailable";
  if (entries.some((e) => e.routeResolutionStatus === "unresolved")) return "unresolved";
  return "resolved";
}

/** The live-state caveat, recomputed: true iff ANY label-resolved fact exists anywhere. */
function computeLiveStateCaveat(entries: readonly SimulationRouteResolutionEntryV1[]): boolean {
  return entries.some(
    (e) =>
      e.routePreview.status === "resolved-as-label" ||
      e.destinationPreview.status === "resolved-as-label" ||
      e.feePreview.status === "resolved-as-label",
  );
}

/** The warning trail, recomputed (caveat first — it is the loudest fact in the artifact). */
function computeWarningCodes(
  entries: readonly SimulationRouteResolutionEntryV1[],
  liveStateCaveat: boolean,
): SimulationReasonCode[] {
  return dedupeSimulationReasonCodes([
    ...(liveStateCaveat ? (["simulation-route-resolution-live-state-caveat"] as SimulationReasonCode[]) : []),
    ...entries.flatMap((e) => e.reasonCodes),
  ]).filter((c) => SIMULATION_REASON_CODE_DEFINITIONS[c].warning);
}

/** The outcome trail, recomputed (honest markers only — never a claim). */
function computeOutcomeCodes(
  blocked: boolean,
  entries: readonly SimulationRouteResolutionEntryV1[],
): SimulationReasonCode[] {
  return dedupeSimulationReasonCodes([
    ...entries.flatMap((e) => e.reasonCodes).filter((c) => SIMULATION_REASON_CODE_DEFINITIONS[c].severity === "info"),
    ...(!blocked && entries.length === 0 ? (["simulation-route-resolution-no-entries"] as SimulationReasonCode[]) : []),
    "simulation-route-resolution-validated",
  ]);
}

/** The deterministic next safe action (a pure function of the artifact-level status). */
function nextSafeActionOf(status: SimulationRouteResolutionStatus): string {
  switch (status) {
    case "blocked":
      return "Resolve the blocking reasons above (rebuild or repair the intent plan; reset a tripped stop switch), then rebuild this route-resolution artifact — nothing downstream may consume a blocked resolution.";
    case "no_entries":
      return "The plan carries zero preview entries, so there is nothing to resolve — build an intent plan with SIMULATED paper-enter previews first, then rebuild this artifact.";
    case "unavailable":
      return "Nothing to act on: no validated route-resolution capability exists inside this boundary, and every entry is honestly UNAVAILABLE. A future, separately-reviewed and explicitly-authorized resolution layer is the only path to resolved facts — never invent them by hand.";
    case "unresolved":
      return "Required route/destination/fee facts are still missing for at least one entry — they stay unresolved until a validated resolution layer supplies them; never type them in by hand.";
    case "resolved":
      return "Every entry is fully label-resolved (live-state caveat applies). Review each fact's provenance with the operator — still SIMULATION ONLY: this artifact never signs, never sends, never authorizes live trading, and never approves a transaction.";
  }
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SimulationRouteResolutionV1}. Pure and non-mutating. The plan is
 * STRICTLY validated in place; a missing/invalid/blocked plan or a declared stop-simulation
 * switch BLOCKS the artifact with stable reason codes and zero entries — fail-closed, never a
 * silent downgrade, never a throw. On an unblocked chain the builder records one entry per plan
 * preview entry. WITHOUT `routeFacts` (the only behavior before Sprint 91, and still the
 * default) — because NO route-resolution capability exists inside this boundary — every entry is
 * honestly UNAVAILABLE under the canonical {@link SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID}
 * (route, destination, and fee stay unresolved; nothing is invented). WITH `routeFacts`
 * (Sprint 91: label-only facts from a separately-validated READ-ONLY quote observation layer) the
 * builder records the supplied labels with provenance — a fact for a candidate not in the plan, a
 * mint contradiction, or a duplicate THROWS (fail closed, never applied loosely); a missing label
 * stays honestly unresolved; supplying facts NEVER unblocks a blocked chain (a blocked artifact
 * records no attempt and applies nothing); and any label-resolved fact forces the mandatory
 * live-state caveat. The produced artifact is self-validated before returning. Throws
 * {@link SimulationRouteResolutionV1Error} only on a malformed/contradictory input SHAPE.
 */
export function buildSimulationRouteResolutionV1(
  input: BuildSimulationRouteResolutionV1Input = {},
): SimulationRouteResolutionV1 {
  if (!isObject(input)) throw new SimulationRouteResolutionV1Error("route resolution input must be an object");
  for (const f of ["operatorLabel", "resolutionLabel"] as const) {
    if (input[f] !== undefined && input[f] !== null && typeof input[f] !== "string") {
      throw new SimulationRouteResolutionV1Error(`route resolution input.${f} must be a string or null when present`);
    }
  }
  if (input.stopSimulationTripped !== undefined && typeof input.stopSimulationTripped !== "boolean") {
    throw new SimulationRouteResolutionV1Error("route resolution input.stopSimulationTripped must be a boolean when present");
  }
  const routeFacts =
    input.routeFacts === undefined || input.routeFacts === null ? null : validateRouteFactsInput(input.routeFacts);

  // 1) Check the plan in place (fail-closed: problems become blocking codes, never throws).
  let plan: SimulationIntentPlanV2 | null = null;
  let sourcePlanRef: SimulationRouteResolutionPlanRef;
  if (input.intentPlan === undefined || input.intentPlan === null) {
    sourcePlanRef = {
      expectedSchemaVersion: SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
      present: false,
      valid: null,
      suppliedSchemaVersion: null,
      planLabel: null,
      operatorLabel: null,
      blocked: null,
      entryCount: null,
    };
  } else {
    const supplied = sniffSchemaVersion(input.intentPlan);
    try {
      plan = validateSimulationIntentPlanV2(input.intentPlan);
      sourcePlanRef = {
        expectedSchemaVersion: SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
        present: true,
        valid: true,
        suppliedSchemaVersion: supplied,
        planLabel: plan.planLabel,
        operatorLabel: plan.operatorLabel,
        blocked: plan.blocked,
        entryCount: plan.entryCount,
      };
    } catch {
      plan = null;
      sourcePlanRef = {
        expectedSchemaVersion: SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
        present: true,
        valid: false,
        suppliedSchemaVersion: supplied,
        planLabel: null,
        operatorLabel: null,
        blocked: null,
        entryCount: null,
      };
    }
  }

  const stopTripped = input.stopSimulationTripped === true;
  const blockingReasonCodes = computeBlockingCodes(sourcePlanRef, stopTripped);
  const blocked = blockingReasonCodes.length > 0;

  // 2) Entries — only over an unblocked chain; one per plan preview entry. Without quote facts
  //    every entry is honest UNAVAILABLE (this package holds no route-resolution capability and
  //    never invents a fact). With quote facts, supplied labels are recorded with provenance —
  //    a fact that contradicts the plan THROWS, and a missing label stays honestly unresolved.
  const attempted = routeFacts !== null && !blocked;
  const entries: SimulationRouteResolutionEntryV1[] = [];
  if (!blocked && plan !== null) {
    const factById = new Map<string, CanonicalRouteFact>();
    if (routeFacts !== null) {
      const planById = new Map(plan.entries.map((e) => [e.candidateId, e]));
      for (const f of routeFacts.facts) {
        const planEntry = planById.get(f.candidateId);
        if (planEntry === undefined) {
          throw new SimulationRouteResolutionV1Error(
            `route resolution input.routeFacts carries a fact for candidateId "${f.candidateId}" which is not in the plan — a quote that does not match the plan is refused (fail closed)`,
          );
        }
        if (planEntry.mint !== f.mint) {
          throw new SimulationRouteResolutionV1Error(
            `route resolution input.routeFacts fact for candidateId "${f.candidateId}" contradicts the plan's mint — refused (fail closed)`,
          );
        }
        factById.set(f.candidateId, f);
      }
    }
    for (const e of plan.entries) {
      const fact = factById.get(e.candidateId) ?? null;
      const toPreview = (label: string | null): SimulationPreviewField =>
        label !== null ? { status: "resolved-as-label", label } : { status: "unresolved", label: null };
      const routePreview = toPreview(fact?.routeLabel ?? null);
      const destinationPreview = toPreview(fact?.destinationLabel ?? null);
      const feePreview = toPreview(fact?.feeLabel ?? null);
      const state = computeEntryState(attempted, routePreview, destinationPreview, feePreview)!;
      const operatorText = !attempted
        ? `Route resolution for ${e.candidateId}: UNAVAILABLE — no validated route-resolution capability exists inside this boundary; route, destination, and fee stay unresolved (never invented).`
        : state.status === "resolved"
          ? `Route resolution for ${e.candidateId}: RESOLVED as label-only facts from a read-only quote observation (${routeFacts!.resolverId}) — never a transaction, never executable; the live-state caveat applies.`
          : fact !== null
            ? `Route resolution for ${e.candidateId}: UNRESOLVED — a read-only quote observation (${routeFacts!.resolverId}) supplied label-only facts, but ${state.unresolvedFields.join(", ")} ${state.unresolvedFields.length === 1 ? "stays" : "stay"} unresolved (never invented). Not executable; the live-state caveat applies.`
            : `Route resolution for ${e.candidateId}: UNRESOLVED — the quote layer (${routeFacts!.resolverId}) observed no quote for this candidate; route, destination, and fee stay unresolved (never invented).`;
      entries.push({
        candidateId: e.candidateId,
        mint: e.mint,
        routeResolutionStatus: state.status,
        routePreview,
        destinationPreview,
        feePreview,
        unresolvedFields: state.unresolvedFields,
        reasonCodes: state.reasonCodes,
        operatorText,
      });
    }
  }

  // 3) Verdicts — every one recomputed, nothing invented.
  const resolutionStatus = computeArtifactStatus(blocked, entries);
  const liveStateCaveat = computeLiveStateCaveat(entries);
  const warningReasonCodes = computeWarningCodes(entries, liveStateCaveat);
  const outcomeReasonCodes = computeOutcomeCodes(blocked, entries);
  const resolvedEntryCount = entries.filter((e) => e.routeResolutionStatus === "resolved").length;
  const unresolvedEntryCount = entries.filter((e) => e.routeResolutionStatus === "unresolved").length;
  const unavailableEntryCount = entries.filter((e) => e.routeResolutionStatus === "unavailable").length;

  const notes = blocked
    ? [
        `BLOCKED: ${blockingReasonCodes.length} blocking reason(s) — no route-resolution entries are recorded from a blocked chain.`,
        "Resolve every blocking reason and rebuild; the artifact never downgrades a blocker to a warning.",
      ]
    : [
        `${entries.length} entr${entries.length === 1 ? "y" : "ies"}: ${resolvedEntryCount} resolved / ${unresolvedEntryCount} unresolved / ${unavailableEntryCount} unavailable.`,
        "An unresolved fact stays unresolved — nothing here invents a route, destination, fee, pool, or address.",
        "Route-resolution provenance only: not live trading, not a buy recommendation, not a transaction approval.",
        ...(attempted
          ? [
              `Label facts come from a READ-ONLY quote observation layer ("${routeFacts!.resolverId}") — observation provenance only: a quote may have expired, slippage is not guaranteed, the route was never simulated, and nothing here is executable.`,
            ]
          : []),
      ];

  const artifact: SimulationRouteResolutionV1 = {
    schemaVersion: SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION,
    banner: SIMULATION_ROUTE_RESOLUTION_V1_BANNER,
    generatedBy: SIMULATION_ROUTE_RESOLUTION_V1_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    phase7LiveTradingReady: false,
    disclaimers: [...SIMULATION_ROUTE_RESOLUTION_V1_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    resolutionLabel: nonEmptyString(input.resolutionLabel) ? input.resolutionLabel : null,
    sourcePlanRef,
    routeResolverId: routeFacts !== null ? routeFacts.resolverId : SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID,
    routeResolverAttempted: attempted,
    stopSimulationDeclaredTripped: stopTripped,
    resolutionStatus,
    blocked,
    liveStateCaveat,
    blockingReasonCodes,
    warningReasonCodes,
    outcomeReasonCodes,
    entries,
    entryCount: entries.length,
    resolvedEntryCount,
    unresolvedEntryCount,
    unavailableEntryCount,
    nextSafeAction: nextSafeActionOf(resolutionStatus),
    notes,
  };
  // Self-check: the builder's own output must pass the strict validator (defense in depth).
  return validateSimulationRouteResolutionV1(artifact);
}

// --- validation (backstop) ---------------------------------------------------

const ARTIFACT_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "banner",
  "generatedBy",
  "paperOnly",
  "simulated",
  "notLiveResult",
  "notFinancialAdvice",
  "notProfitabilityClaim",
  "neverAuthorizesLiveTrading",
  "neverSigns",
  "neverSends",
  "dryRunOnly",
  "phase7LiveTradingReady",
  "disclaimers",
  "operatorLabel",
  "resolutionLabel",
  "sourcePlanRef",
  "routeResolverId",
  "routeResolverAttempted",
  "stopSimulationDeclaredTripped",
  "resolutionStatus",
  "blocked",
  "liveStateCaveat",
  "blockingReasonCodes",
  "warningReasonCodes",
  "outcomeReasonCodes",
  "entries",
  "entryCount",
  "resolvedEntryCount",
  "unresolvedEntryCount",
  "unavailableEntryCount",
  "nextSafeAction",
  "notes",
]);

const PLAN_REF_KEYS: ReadonlySet<string> = new Set([
  "expectedSchemaVersion",
  "present",
  "valid",
  "suppliedSchemaVersion",
  "planLabel",
  "operatorLabel",
  "blocked",
  "entryCount",
]);

const ENTRY_KEYS: ReadonlySet<string> = new Set([
  "candidateId",
  "mint",
  "routeResolutionStatus",
  "routePreview",
  "destinationPreview",
  "feePreview",
  "unresolvedFields",
  "reasonCodes",
  "operatorText",
]);

const PREVIEW_KEYS: ReadonlySet<string> = new Set(["status", "label"]);

const ENTRY_STATUS_SET: ReadonlySet<string> = new Set(SIMULATION_ROUTE_RESOLUTION_ENTRY_STATUSES);
const ARTIFACT_STATUS_SET: ReadonlySet<string> = new Set(SIMULATION_ROUTE_RESOLUTION_STATUSES);

function validatePreviewField(value: unknown, where: string): SimulationPreviewField {
  if (!isObject(value)) throw new SimulationRouteResolutionV1Error(`${where} must be an object`);
  assertClosedKeys(value, PREVIEW_KEYS, where);
  if (value.status !== "resolved-as-label" && value.status !== "unresolved") {
    throw new SimulationRouteResolutionV1Error(`${where}.status must be resolved-as-label|unresolved`);
  }
  if (value.status === "unresolved" && value.label !== null) {
    throw new SimulationRouteResolutionV1Error(`${where}.label must be null when unresolved`);
  }
  if (value.status === "resolved-as-label" && !nonEmptyString(value.label)) {
    throw new SimulationRouteResolutionV1Error(`${where}.label must be a non-empty string when resolved-as-label`);
  }
  return value as unknown as SimulationPreviewField;
}

function validatePlanRef(value: unknown): SimulationRouteResolutionPlanRef {
  const where = "route resolution.sourcePlanRef";
  if (!isObject(value)) throw new SimulationRouteResolutionV1Error(`${where} must be an object`);
  assertClosedKeys(value, PLAN_REF_KEYS, where);
  if (value.expectedSchemaVersion !== SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION) {
    throw new SimulationRouteResolutionV1Error(`${where}.expectedSchemaVersion must be "${SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION}"`);
  }
  if (typeof value.present !== "boolean") throw new SimulationRouteResolutionV1Error(`${where}.present must be a boolean`);
  if (value.valid !== null && typeof value.valid !== "boolean") {
    throw new SimulationRouteResolutionV1Error(`${where}.valid must be a boolean or null`);
  }
  if ((value.valid === null) !== (value.present === false)) {
    throw new SimulationRouteResolutionV1Error(`${where}.valid must be null exactly when the plan is absent`);
  }
  if (value.suppliedSchemaVersion !== null && typeof value.suppliedSchemaVersion !== "string") {
    throw new SimulationRouteResolutionV1Error(`${where}.suppliedSchemaVersion must be a string or null`);
  }
  if (value.present === false && value.suppliedSchemaVersion !== null) {
    throw new SimulationRouteResolutionV1Error(`${where}.suppliedSchemaVersion must be null when the plan is absent`);
  }
  if (value.valid === true) {
    for (const f of ["planLabel", "operatorLabel"] as const) {
      if (value[f] !== null && typeof value[f] !== "string") {
        throw new SimulationRouteResolutionV1Error(`${where}.${f} must be a string or null`);
      }
    }
    if (typeof value.blocked !== "boolean") throw new SimulationRouteResolutionV1Error(`${where}.blocked must be a boolean for a valid plan`);
    if (typeof value.entryCount !== "number" || !Number.isInteger(value.entryCount) || value.entryCount < 0) {
      throw new SimulationRouteResolutionV1Error(`${where}.entryCount must be a non-negative integer for a valid plan`);
    }
  } else {
    for (const f of ["planLabel", "operatorLabel", "blocked", "entryCount"] as const) {
      if (value[f] !== null) {
        throw new SimulationRouteResolutionV1Error(`${where}.${f} must be null when the plan is missing/invalid — state is never invented for it`);
      }
    }
  }
  return value as unknown as SimulationRouteResolutionPlanRef;
}

function validateEntry(value: unknown, resolverAttempted: boolean, where: string): SimulationRouteResolutionEntryV1 {
  if (!isObject(value)) throw new SimulationRouteResolutionV1Error(`${where} must be an object`);
  assertClosedKeys(value, ENTRY_KEYS, where);
  if (!nonEmptyString(value.candidateId)) throw new SimulationRouteResolutionV1Error(`${where}.candidateId must be a non-empty string`);
  if (!nonEmptyString(value.mint)) throw new SimulationRouteResolutionV1Error(`${where}.mint must be a non-empty string`);
  if (typeof value.routeResolutionStatus !== "string" || !ENTRY_STATUS_SET.has(value.routeResolutionStatus)) {
    throw new SimulationRouteResolutionV1Error(
      `${where}.routeResolutionStatus must be one of ${SIMULATION_ROUTE_RESOLUTION_ENTRY_STATUSES.join("|")}`,
    );
  }
  const route = validatePreviewField(value.routePreview, `${where}.routePreview`);
  const destination = validatePreviewField(value.destinationPreview, `${where}.destinationPreview`);
  const fee = validatePreviewField(value.feePreview, `${where}.feePreview`);
  const expected = computeEntryState(resolverAttempted, route, destination, fee);
  if (expected === null) {
    throw new SimulationRouteResolutionV1Error(
      `${where} carries a resolved fact while no resolver attempted resolution — an unattempted resolution can never carry resolved facts`,
    );
  }
  if (value.routeResolutionStatus !== expected.status) {
    throw new SimulationRouteResolutionV1Error(
      `${where}.routeResolutionStatus must be "${expected.status}" given its facts — a "resolved" claim with missing route/destination/fee facts is refused`,
    );
  }
  if (!Array.isArray(value.unresolvedFields) || (value.unresolvedFields as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationRouteResolutionV1Error(`${where}.unresolvedFields must be an array of strings`);
  }
  if ((value.unresolvedFields as string[]).join("|") !== expected.unresolvedFields.join("|")) {
    throw new SimulationRouteResolutionV1Error(
      `${where}.unresolvedFields must mirror the unresolved facts (${expected.unresolvedFields.join(", ") || "none"})`,
    );
  }
  if (!Array.isArray(value.reasonCodes) || (value.reasonCodes as unknown[]).some((x) => !isSimulationReasonCode(x))) {
    throw new SimulationRouteResolutionV1Error(`${where}.reasonCodes must be an array of known simulation reason codes`);
  }
  if ((value.reasonCodes as string[]).join("|") !== expected.reasonCodes.join("|")) {
    throw new SimulationRouteResolutionV1Error(`${where}.reasonCodes must equal the recomputed trail (${expected.reasonCodes.join(", ")})`);
  }
  if (!nonEmptyString(value.operatorText)) throw new SimulationRouteResolutionV1Error(`${where}.operatorText must be a non-empty string`);
  return value as unknown as SimulationRouteResolutionEntryV1;
}

/**
 * Strictly validate a value as a {@link SimulationRouteResolutionV1} and return it narrowed.
 * Enforces the literal safety locks (including the always-false `phase7LiveTradingReady`), the
 * CLOSED v1 key sets (unknown/sensitive-named/execution-shaped fields refused), and recomputes
 * EVERY mirror: the blocking trail from the plan ref + stop switch (so zero blocking codes over a
 * blocking source state is refused), blocked ⇔ status "blocked" ⇔ zero entries, per-entry
 * status/unresolved-fields/code trails from the facts ("resolved" with a missing fact is
 * refused), the artifact status precedence, the tallies, the live-state caveat (any resolved fact
 * REQUIRES the caveat and its warning code), the warning/outcome trails, and the deterministic
 * next safe action. Throws {@link SimulationRouteResolutionV1Error} (or a SimulationSafetyError
 * for a flipped lock) on the first problem. Pure.
 */
export function validateSimulationRouteResolutionV1(value: unknown): SimulationRouteResolutionV1 {
  if (!isObject(value)) throw new SimulationRouteResolutionV1Error("route resolution must be a JSON object");
  assertClosedKeys(value, ARTIFACT_KEYS, "route resolution");
  if (value.schemaVersion !== SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION) {
    throw new SimulationRouteResolutionV1Error(`route resolution.schemaVersion must be "${SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SIMULATION_ROUTE_RESOLUTION_V1_BANNER) {
    throw new SimulationRouteResolutionV1Error(`route resolution.banner must be "${SIMULATION_ROUTE_RESOLUTION_V1_BANNER}"`);
  }
  if (value.generatedBy !== SIMULATION_ROUTE_RESOLUTION_V1_GENERATED_BY) {
    throw new SimulationRouteResolutionV1Error(`route resolution.generatedBy must be "${SIMULATION_ROUTE_RESOLUTION_V1_GENERATED_BY}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SimulationRouteResolutionV1Error(`route resolution.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "route resolution");
  if (value.phase7LiveTradingReady !== false) {
    throw new SimulationRouteResolutionV1Error(
      "route resolution.phase7LiveTradingReady must be literally false — a route-resolution artifact can never claim live-trading readiness",
    );
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0 || (value.disclaimers as unknown[]).some((d) => typeof d !== "string")) {
    throw new SimulationRouteResolutionV1Error("route resolution.disclaimers must be a non-empty array of strings");
  }
  for (const f of ["operatorLabel", "resolutionLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SimulationRouteResolutionV1Error(`route resolution.${f} must be a string or null`);
    }
  }
  const sourcePlanRef = validatePlanRef(value.sourcePlanRef);

  if (typeof value.routeResolverId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.routeResolverId)) {
    throw new SimulationRouteResolutionV1Error("route resolution.routeResolverId must be a kebab-case identifier");
  }
  if (isSensitiveKey(value.routeResolverId)) {
    throw new SimulationRouteResolutionV1Error(
      "route resolution.routeResolverId is sensitive-shaped — a resolver id can never look like key material",
    );
  }
  for (const f of ["routeResolverAttempted", "stopSimulationDeclaredTripped", "blocked", "liveStateCaveat"] as const) {
    if (typeof value[f] !== "boolean") throw new SimulationRouteResolutionV1Error(`route resolution.${f} must be a boolean`);
  }

  // The blocking trail is fully recomputable — zero blocking codes over a blocking source state
  // (missing/invalid/blocked plan, tripped stop switch) is refused, never trusted.
  const expectedBlocking = computeBlockingCodes(sourcePlanRef, value.stopSimulationDeclaredTripped as boolean);
  for (const f of ["blockingReasonCodes", "warningReasonCodes", "outcomeReasonCodes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => !isSimulationReasonCode(x))) {
      throw new SimulationRouteResolutionV1Error(`route resolution.${f} must be an array of known simulation reason codes`);
    }
  }
  if (JSON.stringify(value.blockingReasonCodes) !== JSON.stringify(expectedBlocking)) {
    throw new SimulationRouteResolutionV1Error(
      `route resolution.blockingReasonCodes must equal the recomputed trail (${expectedBlocking.join(", ") || "empty"})`,
    );
  }
  const blocked = expectedBlocking.length > 0;
  if (value.blocked !== blocked) {
    throw new SimulationRouteResolutionV1Error("route resolution.blocked must be true exactly when blocking codes are present");
  }
  if (blocked && value.routeResolverAttempted === true) {
    throw new SimulationRouteResolutionV1Error("route resolution.routeResolverAttempted must be false when blocked — nothing is attempted over a blocked chain");
  }
  if (value.routeResolverId === SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID && value.routeResolverAttempted === true) {
    throw new SimulationRouteResolutionV1Error(
      `route resolution.routeResolverAttempted must be false under "${SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID}" — the no-resolver id can never claim an attempt`,
    );
  }

  if (!Array.isArray(value.entries)) throw new SimulationRouteResolutionV1Error("route resolution.entries must be an array");
  const entries = (value.entries as unknown[]).map((e, i) =>
    validateEntry(e, value.routeResolverAttempted as boolean, `route resolution.entries[${i}]`),
  );
  if (blocked && entries.length !== 0) {
    throw new SimulationRouteResolutionV1Error("route resolution must carry ZERO entries when blocked");
  }
  if (!blocked && sourcePlanRef.valid === true && entries.length !== sourcePlanRef.entryCount) {
    throw new SimulationRouteResolutionV1Error(
      `route resolution.entries must carry one record per plan entry (expected ${sourcePlanRef.entryCount}, got ${entries.length})`,
    );
  }
  if (value.entryCount !== entries.length) throw new SimulationRouteResolutionV1Error("route resolution.entryCount must equal entries length");
  const tallies: ReadonlyArray<readonly [string, SimulationRouteResolutionEntryStatus]> = [
    ["resolvedEntryCount", "resolved"],
    ["unresolvedEntryCount", "unresolved"],
    ["unavailableEntryCount", "unavailable"],
  ];
  for (const [field, status] of tallies) {
    const expected = entries.filter((e) => e.routeResolutionStatus === status).length;
    if (value[field] !== expected) {
      throw new SimulationRouteResolutionV1Error(`route resolution.${field} must equal the recomputed tally (${expected})`);
    }
  }

  if (typeof value.resolutionStatus !== "string" || !ARTIFACT_STATUS_SET.has(value.resolutionStatus)) {
    throw new SimulationRouteResolutionV1Error(`route resolution.resolutionStatus must be one of ${SIMULATION_ROUTE_RESOLUTION_STATUSES.join("|")}`);
  }
  const expectedStatus = computeArtifactStatus(blocked, entries);
  if (value.resolutionStatus !== expectedStatus) {
    throw new SimulationRouteResolutionV1Error(
      `route resolution.resolutionStatus must follow the conservative precedence ("${expectedStatus}")`,
    );
  }
  const expectedCaveat = computeLiveStateCaveat(entries);
  if (value.liveStateCaveat !== expectedCaveat) {
    throw new SimulationRouteResolutionV1Error(
      expectedCaveat
        ? "route resolution.liveStateCaveat must be true — a label-resolved fact can only come from live chain state and the caveat can never be omitted"
        : "route resolution.liveStateCaveat must be false — no label-resolved fact exists to caveat",
    );
  }
  const expectedWarnings = computeWarningCodes(entries, expectedCaveat);
  if (JSON.stringify(value.warningReasonCodes) !== JSON.stringify(expectedWarnings)) {
    throw new SimulationRouteResolutionV1Error(
      `route resolution.warningReasonCodes must equal the recomputed trail (${expectedWarnings.join(", ") || "empty"})`,
    );
  }
  const expectedOutcomes = computeOutcomeCodes(blocked, entries);
  if (JSON.stringify(value.outcomeReasonCodes) !== JSON.stringify(expectedOutcomes)) {
    throw new SimulationRouteResolutionV1Error(
      `route resolution.outcomeReasonCodes must equal the recomputed trail (${expectedOutcomes.join(", ")})`,
    );
  }
  if (value.nextSafeAction !== nextSafeActionOf(expectedStatus)) {
    throw new SimulationRouteResolutionV1Error("route resolution.nextSafeAction must equal the recomputed deterministic action");
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationRouteResolutionV1Error("route resolution.notes must be an array of strings");
  }
  return value as unknown as SimulationRouteResolutionV1;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSimulationRouteResolutionV1}. */
export interface FormatSimulationRouteResolutionV1Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable route-resolution artifact. Deterministic and
 * path-stable. Leads with the provenance-only framing (not live trading, not a buy
 * recommendation, not a transaction approval) and the resolution status, shows the source plan,
 * the inert resolver metadata, each entry's route/destination/fee facts (unresolved facts say
 * UNRESOLVED plainly — never greenwashed), the blocking and warning reasons with operator
 * messages, and the single deterministic next safe action. Passed through the shared redactor.
 */
export function formatSimulationRouteResolutionV1(
  artifact: SimulationRouteResolutionV1,
  opts: FormatSimulationRouteResolutionV1Options = {},
): string {
  const header =
    "SIMULATION ROUTE RESOLUTION — ROUTE PROVENANCE ONLY (not live trading; not a buy recommendation; not a transaction approval; never signs; never sends; never authorizes live trading)";
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(SIMULATION_OPERATOR_SAFETY_LINE);
  lines.push(`artifact: ${artifact.schemaVersion}`);
  if (opts.label) lines.push(`label:    ${opts.label}`);
  if (artifact.operatorLabel) lines.push(`operator: ${artifact.operatorLabel}`);
  lines.push(`resolution: ${artifact.resolutionLabel ?? "(unlabeled)"}`);
  const ref = artifact.sourcePlanRef;
  const planState = ref.present
    ? ref.valid
      ? `present, valid  [${ref.planLabel ?? "(unlabeled)"}; ${ref.blocked ? "BLOCKED" : "unblocked"}; ${ref.entryCount} entr${ref.entryCount === 1 ? "y" : "ies"}]`
      : `present, INVALID (supplied ${ref.suppliedSchemaVersion ?? "unknown"})`
    : "MISSING (classified, not invented)";
  lines.push(`plan:     ${planState}`);
  lines.push(`resolver: ${artifact.routeResolverId} (inert metadata; attempted: ${artifact.routeResolverAttempted ? "yes" : "NO"})`);
  lines.push(`status:   ${artifact.resolutionStatus.toUpperCase()}`);
  lines.push(
    `live-state caveat: ${artifact.liveStateCaveat ? "YES — label-resolved facts come from live chain state; never mistake this for a deterministic fixture" : "no (no label-resolved fact is present)"}`,
  );

  lines.push("");
  if (artifact.resolutionStatus === "blocked") {
    lines.push("BLOCKING reasons (nothing is resolved over a blocked chain):");
    for (const c of artifact.blockingReasonCodes) {
      lines.push(`✗ ${c}`);
      lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
    }
  } else {
    lines.push(
      `Entries (${artifact.entryCount}): ${artifact.resolvedEntryCount} resolved / ${artifact.unresolvedEntryCount} unresolved / ${artifact.unavailableEntryCount} unavailable`,
    );
    if (artifact.entries.length === 0) {
      lines.push("- (none — the plan carried no preview entries; there is nothing to resolve)");
    }
    for (const e of artifact.entries) {
      lines.push(`- ${e.candidateId}  ${e.mint}  [${e.routeResolutionStatus}]`);
      const show = (f: SimulationPreviewField) =>
        f.status === "unresolved" ? "UNRESOLVED (never invented)" : `${f.label} (label-only fact; live-state caveat applies)`;
      lines.push(`    route:       ${show(e.routePreview)}`);
      lines.push(`    destination: ${show(e.destinationPreview)}`);
      lines.push(`    fee:         ${show(e.feePreview)}`);
    }
    if (artifact.warningReasonCodes.length > 0) {
      lines.push("");
      lines.push("Warnings:");
      for (const c of artifact.warningReasonCodes) {
        lines.push(`! ${c}`);
        lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
      }
    }
  }

  lines.push("");
  lines.push(`Next safe action: ${artifact.nextSafeAction}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of artifact.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of artifact.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
