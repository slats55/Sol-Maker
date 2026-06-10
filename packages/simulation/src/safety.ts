/**
 * The **SAFETY BOUNDARY** of `@soulmaker/simulation` (Sprint 61 — the Phase 6 package boundary).
 *
 * This package is the first AUTHORIZED Phase 6 surface: a read-only, dry-run-only simulation
 * foundation that consumes already-validated PAPER artifacts (the `@soulmaker/sniper` v2 chain and
 * its adopted governance specs) and produces deterministic simulation artifacts. Its boundary is
 * deliberately narrower than even the sniper package's:
 *
 *   - It can never authorize live trading. Every artifact carries `neverAuthorizesLiveTrading: true`
 *     as a validated literal; flipping it fails validation.
 *   - It never signs. There is no key material, no key import, and no signing surface anywhere.
 *   - It never sends. There is no transaction-submission surface anywhere; nothing here can reach
 *     the network at all (the forbidden-import scan refuses every network/chain capability module).
 *   - It is dry-run only. Where a real on-chain dry-run is structurally impossible without
 *     transaction material this package does NOT fake one — it records the dry-run as unavailable
 *     with an honest reason code.
 *
 * The four literals live here as the single shared source ({@link SIMULATION_SAFETY_LITERALS}) so
 * every artifact module spreads and validates the SAME locks. This module is pure data + pure
 * checks: no I/O, no network, no wallet, no wall-clock.
 */

/** The package's one-line capability statement (embedded in docs and artifacts; stable). */
export const SIMULATION_PACKAGE_CAPABILITY_STATEMENT =
  "@soulmaker/simulation is read-only and dry-run-only: it can never authorize live trading, never signs, never sends, and holds no wallet or key material of any kind.";

/** The shared literal safety locks every simulation artifact must carry (validated, never flippable). */
export interface SimulationSafetyLiterals {
  /** ALWAYS true — no simulation artifact can ever authorize live trading. */
  readonly neverAuthorizesLiveTrading: true;
  /** ALWAYS true — this package holds no signing surface and no key material. */
  readonly neverSigns: true;
  /** ALWAYS true — this package holds no transaction-submission surface. */
  readonly neverSends: true;
  /** ALWAYS true — simulation is dry-run only; an impossible dry-run is reported honestly, never faked. */
  readonly dryRunOnly: true;
}

/** The canonical literal values (frozen; spread into every artifact). */
export const SIMULATION_SAFETY_LITERALS: SimulationSafetyLiterals = Object.freeze({
  neverAuthorizesLiveTrading: true,
  neverSigns: true,
  neverSends: true,
  dryRunOnly: true,
} as const);

/** The literal lock keys in stable order (used by validators and tests). */
export const SIMULATION_SAFETY_LITERAL_KEYS = [
  "neverAuthorizesLiveTrading",
  "neverSigns",
  "neverSends",
  "dryRunOnly",
] as const;

/** The canonical one-line operator framing every simulation formatter prints directly under its
 * title (Sprint 76 — one shared source so the required language can never drift per-formatter). */
export const SIMULATION_OPERATOR_SAFETY_LINE =
  "simulation only — does not sign; does not send; does not authorize live trading; Phase 7 (live/burner trading) remains unauthorized.";

/** Baseline disclaimer statements shared by every simulation artifact (stable order). */
export const SIMULATION_PACKAGE_DISCLAIMERS: readonly string[] = [
  "SIMULATION ONLY — a deterministic, read-only, dry-run-only artifact over validated PAPER inputs; nothing here is, or can become, a live action.",
  "It can NEVER authorize live trading: neverAuthorizesLiveTrading is literally true and the validator refuses anything else.",
  "It NEVER signs and NEVER sends: this package holds no wallet, no key material, no signing surface, and no transaction-submission surface.",
  "Where a real on-chain dry-run is impossible without transaction material it is reported as UNAVAILABLE with an honest reason code — never faked.",
  "Phase 7 (live/burner trading) is NOT started, NOT authorized, and cannot be authorized from here.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

/** Thrown when a simulation artifact or input violates the package's safety boundary. */
export class SimulationSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationSafetyError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Assert that `value` carries every literal safety lock with its exact literal value. Used by every
 * artifact validator in this package — a flipped or missing lock is a hard refusal. Pure. Throws
 * {@link SimulationSafetyError} naming the offending key.
 */
export function assertSimulationSafetyLiterals(value: unknown, where: string): void {
  if (!isObject(value)) throw new SimulationSafetyError(`${where} must be a JSON object`);
  for (const key of SIMULATION_SAFETY_LITERAL_KEYS) {
    if (value[key] !== true) {
      throw new SimulationSafetyError(`${where}.${key} must be literally true — a simulation artifact can never weaken its safety locks`);
    }
  }
}
