/**
 * The safe **DRY-RUN ADAPTER CONTRACT** (Sprint 65 — the boundary a future dry-run must live
 * behind).
 *
 * An adapter is the ONLY place a future, separately-reviewed dry-run capability could ever plug
 * in — and the contract is built so that even a hostile adapter cannot widen the boundary:
 *
 *   - The adapter receives a {@link SimulationDryRunRequest} the RESULT BUILDER constructs from a
 *     validated plan entry: candidate id, mint, the literal action-preview marker, and label-only
 *     preview values. No key material, no signer, no transaction, no config pass-through exists in
 *     the shape — there is nothing TO hand over.
 *   - The adapter returns one of three closed outcomes (unavailable / failed-safely /
 *     completed-safely). Anything else — an unknown kind, a malformed object, a thrown error — is
 *     NORMALIZED by the result builder to a safe, redacted failure. An adapter cannot report
 *     "sent", "signed", or "live" because no such outcome exists in the contract.
 *   - {@link validateSimulationDryRunAdapter} refuses an adapter whose literal locks are missing
 *     or flipped, and refuses an adapter object carrying any sensitive-named property (key-shaped
 *     configuration cannot ride along).
 *
 * The canonical {@link UNAVAILABLE_DRY_RUN_ADAPTER} is the package default: a REAL on-chain
 * dry-run (`simulateTransaction`) requires built and signed transaction material, which this
 * package is structurally forbidden from producing — so the honest result is UNAVAILABLE, never a
 * fake. Pure: no I/O, no network, no wallet, no wall-clock.
 */

import { isSensitiveKey } from "@soulmaker/security";
import { SimulationSafetyError } from "./safety.js";

/** What an adapter is allowed to see for ONE entry (label-only previews; nothing executable). */
export interface SimulationDryRunRequest {
  candidateId: string;
  mint: string;
  /** Always this literal — the only action a Phase 6 preview can describe. */
  intendedActionPreview: "simulated-entry-preview";
  /** Label-only preview values (never an address, never currency, never route data). */
  destinationLabel: string | null;
  amountLabel: string | null;
  feeLabel: string | null;
}

/** The closed set of outcomes an adapter can report. There is no "sent"/"signed"/"live" outcome. */
export type SimulationDryRunOutcome =
  | { kind: "unavailable"; detail: string }
  | { kind: "failed-safely"; detail: string }
  | { kind: "completed-safely"; detail: string };

/** The safe dry-run adapter contract (see the module doc for the boundary guarantees). */
export interface SimulationDryRunAdapter {
  /** Stable kebab-case adapter id. */
  readonly adapterId: string;
  /** One-line capability statement embedded verbatim in every result built with this adapter. */
  readonly capabilityStatement: string;
  /** Literal lock, validated: an adapter that could sign is refused at the type AND runtime layer. */
  readonly neverSigns: true;
  /** Literal lock, validated: an adapter that could send is refused at the type AND runtime layer. */
  readonly neverSends: true;
  /** Attempt one dry-run for one request. Must be deterministic for the same request. */
  attemptDryRun(request: SimulationDryRunRequest): SimulationDryRunOutcome;
}

/** The canonical, honest default: a real dry-run is structurally impossible here — say so. */
export const UNAVAILABLE_DRY_RUN_ADAPTER: SimulationDryRunAdapter = Object.freeze({
  adapterId: "unavailable-safe-boundary",
  capabilityStatement:
    "No real dry-run capability exists inside the simulation safety boundary: an on-chain dry-run needs built and signed transaction material, which this package is structurally forbidden from producing. Every attempt reports UNAVAILABLE — honestly, never faked.",
  neverSigns: true as const,
  neverSends: true as const,
  attemptDryRun(): SimulationDryRunOutcome {
    return {
      kind: "unavailable",
      detail:
        "a real on-chain dry-run requires transaction material the simulation boundary forbids building — reported unavailable, not faked",
    };
  },
});

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate an adapter against the contract. Refuses (throws {@link SimulationSafetyError}) when
 * the locks are missing/flipped, the id/statement are malformed, `attemptDryRun` is not a
 * function, or ANY own property name is sensitive-shaped (no key material can ride along on the
 * adapter object). Returns the adapter narrowed. Pure.
 */
export function validateSimulationDryRunAdapter(value: unknown): SimulationDryRunAdapter {
  if (!isObject(value)) throw new SimulationSafetyError("dry-run adapter must be an object");
  if (typeof value.adapterId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.adapterId)) {
    throw new SimulationSafetyError("dry-run adapter.adapterId must be a kebab-case identifier");
  }
  if (typeof value.capabilityStatement !== "string" || value.capabilityStatement.length < 20) {
    throw new SimulationSafetyError("dry-run adapter.capabilityStatement must be a meaningful string");
  }
  if (value.neverSigns !== true) throw new SimulationSafetyError("dry-run adapter.neverSigns must be literally true");
  if (value.neverSends !== true) throw new SimulationSafetyError("dry-run adapter.neverSends must be literally true");
  if (typeof value.attemptDryRun !== "function") {
    throw new SimulationSafetyError("dry-run adapter.attemptDryRun must be a function");
  }
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      throw new SimulationSafetyError(`dry-run adapter carries sensitive-named property "${key}" — key material can never ride along on an adapter`);
    }
  }
  return value as unknown as SimulationDryRunAdapter;
}

/** The closed outcome kinds (used by the result builder's normalization). */
export const SIMULATION_DRY_RUN_OUTCOME_KINDS = ["unavailable", "failed-safely", "completed-safely"] as const;

/**
 * Normalize WHATEVER an adapter returned (or threw) into a guaranteed-safe outcome. An unknown
 * kind, a malformed object, a non-string detail, or an exception all become `failed-safely` with
 * a bounded detail string — an adapter cannot smuggle a "sent/signed/live" claim through, because
 * no such outcome exists. Pure.
 */
export function normalizeSimulationDryRunOutcome(raw: unknown): SimulationDryRunOutcome {
  if (isObject(raw) && typeof raw.detail === "string" && raw.detail.length > 0 && raw.detail.length <= 2000) {
    if (raw.kind === "unavailable" || raw.kind === "failed-safely" || raw.kind === "completed-safely") {
      return { kind: raw.kind, detail: raw.detail };
    }
  }
  return {
    kind: "failed-safely",
    detail: "the adapter returned an unrecognized outcome — normalized to a safe failure (nothing was signed or sent)",
  };
}
