/**
 * Deterministic, **no-send** S104 CONTROLLED MICRO-TRADE PREFLIGHT artifact (Sprint 104-A).
 *
 * `phase7.microtrade.preflight.v1` answers ONE question and only that question: *if a human later
 * gives an explicit, separate S104 execution authorization, are the structural inputs already in
 * place?* It folds the evidence a future micro-trade would depend on — the written Phase 7 sign-off,
 * the reconciled devnet broadcast proof, a complete mainnet dry-run release candidate, a public
 * burner wallet, a bounded max-spend, a manual-confirmation label, and the risk/quote/simulation
 * posture carried verbatim from the release candidate — into a single, auditable verdict.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet / signer work. The orchestrator
 * reads and strictly validates the evidence artifacts and hands their SUMMARIZED facts here. The
 * builder is structurally incapable of authorizing, signing, or sending:
 *
 *   - `mode` is the literal `"controlled-mainnet-microtrade-preflight"`, `network` the literal
 *     `"mainnet-beta"`; neither can be changed by input;
 *   - `liveExecutionAuthorized` / `authorizesLiveTrading` are pinned false, `neverSends` /
 *     `neverSigns` / `notExecutable` pinned true, `requiresSeparateExecutionApproval` pinned true,
 *     `phase7LiveTradingReady` false;
 *   - the VERDICT is RE-DERIVED from the structured statuses alone, DEFAULTS to a blocked state, and
 *     the validator recomputes it independently — so a tampered status can never claim readiness the
 *     evidence does not support.
 *
 * The closed verdict set, in precedence order (most-fundamental blocker first; NONE executes):
 *
 *   - `blocked-missing-signoff`            — no signed-for-controlled-microtrade human sign-off;
 *   - `blocked-missing-devnet-proof`       — no reconciled devnet broadcast proof;
 *   - `blocked-missing-release-candidate`  — no complete mainnet dry-run release candidate;
 *   - `blocked-risk`                       — the release candidate is blocked on risk;
 *   - `blocked-quote`                      — the release candidate is blocked on quote freshness;
 *   - `blocked-simulation`                 — the release candidate is blocked on simulation;
 *   - `blocked-missing-burner-wallet`      — no valid PUBLIC burner wallet address;
 *   - `blocked-missing-manual-confirmation`— no explicit manual-confirmation label;
 *   - `ready-for-separate-execution-authorization` — every structural input is present. This is the
 *     BEST outcome and authorizes NOTHING: it means "ready to be considered for a SEPARATELY,
 *     explicitly authorized S104 controlled micro-trade," never that a trade may run.
 *
 * NOTE on field naming: the intent field "requires a separate execution authorization" is named
 * `requiresSeparateExecutionApproval` (NOT ...Authorization). The secret redactor scrubs any object
 * key matching /authorization/, which would clobber the literal value the safety layer depends on;
 * the redactor-safe synonym preserves the lock. (Same reason the sign-off uses `grantedScope`.)
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier. Bump only on a breaking change. */
export const PHASE7_MICROTRADE_PREFLIGHT_SCHEMA_VERSION = "phase7.microtrade.preflight.v1";

/** The banner that prefixes every preflight artifact (required label). */
export const PHASE7_MICROTRADE_PREFLIGHT_BANNER =
  "S104 CONTROLLED MICRO-TRADE PREFLIGHT — a no-send readiness check. IT DOES NOT EXECUTE TRADES; a separate, explicit execution authorization is required.";

/** The fixed mode. There is no input that can change it. */
export const PHASE7_MICROTRADE_PREFLIGHT_MODE = "controlled-mainnet-microtrade-preflight";
/** The fixed network the preflight is evaluated for. */
export const PHASE7_MICROTRADE_PREFLIGHT_NETWORK = "mainnet-beta";

/** The micro-trade spend ceiling (0.05 SOL) — the same ceiling the sign-off enforces. */
export const PHASE7_MICROTRADE_PREFLIGHT_MAX_SPEND_LAMPORTS = 50_000_000;
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Required disclaimer statements carried by every preflight artifact (stable order). */
export const PHASE7_MICROTRADE_PREFLIGHT_DISCLAIMERS: readonly string[] = [
  "S104 CONTROLLED MICRO-TRADE PREFLIGHT — a read-only check of whether the structural inputs for a future, separately-authorized micro-trade are present.",
  "This artifact DOES NOT execute a trade. It is structurally incapable of arming, signing, or sending, and it can never contain a mainnet transaction signature or send result.",
  "The best possible verdict, 'ready-for-separate-execution-authorization', means the inputs are present — never that a trade is approved. A separate, explicit, written S104 execution authorization is still required.",
  "Live trading stays DISABLED. No flag, config, or artifact in this repo can substitute for a fresh human decision at execution time, the fourteen-condition live gate, and a reviewed execution sprint.",
  "Not a live result. Not a trade signal. Not financial advice. Not a profitability claim.",
];

/** Closed verdict set, in precedence order (least ready first). */
export const PHASE7_MICROTRADE_PREFLIGHT_VERDICTS = [
  "blocked-missing-signoff",
  "blocked-missing-devnet-proof",
  "blocked-missing-release-candidate",
  "blocked-risk",
  "blocked-quote",
  "blocked-simulation",
  "blocked-missing-burner-wallet",
  "blocked-missing-manual-confirmation",
  "ready-for-separate-execution-authorization",
] as const;
export type Phase7MicrotradePreflightVerdict = (typeof PHASE7_MICROTRADE_PREFLIGHT_VERDICTS)[number];

/** Optional Phase 7 audit corroboration status (the audit gates nothing here; the artifacts do). */
export const PHASE7_PREFLIGHT_AUDIT_STATUSES = [
  "not-supplied",
  "verified-design-only",
  "verified-ready",
  "not-authorized",
] as const;
export type Phase7PreflightAuditStatus = (typeof PHASE7_PREFLIGHT_AUDIT_STATUSES)[number];

/** Sign-off posture (only a fully-signed micro-trade record satisfies the gate). */
export const PHASE7_PREFLIGHT_SIGNOFF_STATUSES = [
  "absent",
  "present-not-signed",
  "signed-for-controlled-microtrade",
] as const;
export type Phase7PreflightSignoffStatus = (typeof PHASE7_PREFLIGHT_SIGNOFF_STATUSES)[number];

/** Devnet broadcast proof posture (only a reconciled broadcast satisfies the gate). */
export const PHASE7_PREFLIGHT_DEVNET_STATUSES = ["absent", "present-not-confirmed", "confirmed-reconciled"] as const;
export type Phase7PreflightDevnetStatus = (typeof PHASE7_PREFLIGHT_DEVNET_STATUSES)[number];

/**
 * Release-candidate posture mapped from `sniper.mainnet_dryrun.release_candidate.v1`'s verdict. Only
 * `complete-blocked-live` satisfies the gate; every other state blocks. The RC verdict is itself
 * re-derived (never from a candidate score), so a high score can never reach `complete-blocked-live`.
 */
export const PHASE7_PREFLIGHT_RC_STATUSES = [
  "absent",
  "error",
  "incomplete",
  "blocked-build",
  "blocked-risk",
  "blocked-quote",
  "blocked-simulation",
  "complete-blocked-live",
] as const;
export type Phase7PreflightRcStatus = (typeof PHASE7_PREFLIGHT_RC_STATUSES)[number];

/** Burner wallet posture (only a valid PUBLIC key satisfies the gate). */
export const PHASE7_PREFLIGHT_BURNER_STATUSES = ["absent", "invalid", "valid-public-key"] as const;
export type Phase7PreflightBurnerStatus = (typeof PHASE7_PREFLIGHT_BURNER_STATUSES)[number];

/** Manual-confirmation posture. */
export const PHASE7_PREFLIGHT_MANUAL_CONFIRMATION_STATUSES = ["absent", "present"] as const;
export type Phase7PreflightManualConfirmationStatus = (typeof PHASE7_PREFLIGHT_MANUAL_CONFIRMATION_STATUSES)[number];

/** Quote-freshness echo (from the release candidate). */
export const PHASE7_PREFLIGHT_QUOTE_STATUSES = ["not-applicable", "missing", "stale", "fresh"] as const;
export type Phase7PreflightQuoteStatus = (typeof PHASE7_PREFLIGHT_QUOTE_STATUSES)[number];

/** Risk echo (from the release candidate's deep risk). */
export const PHASE7_PREFLIGHT_RISK_STATUSES = ["not-assessed", "rejected", "critical-flag", "token2022-blocker", "clear"] as const;
export type Phase7PreflightRiskStatus = (typeof PHASE7_PREFLIGHT_RISK_STATUSES)[number];

/** Token-2022 blocker echo. */
export const PHASE7_PREFLIGHT_TOKEN2022_STATUSES = ["unknown", "present", "none"] as const;
export type Phase7PreflightToken2022Status = (typeof PHASE7_PREFLIGHT_TOKEN2022_STATUSES)[number];

/** Simulation echo (from the release candidate). */
export const PHASE7_PREFLIGHT_SIMULATION_STATUSES = ["not-run", "failed", "simulated-ok"] as const;
export type Phase7PreflightSimulationStatus = (typeof PHASE7_PREFLIGHT_SIMULATION_STATUSES)[number];

/** Pinned future-requirement literals (recorded as REQUIRED, never as satisfied — nothing executes here). */
export const PHASE7_PREFLIGHT_KILL_SWITCH_REQUIREMENT = "required-at-execution";
export const PHASE7_PREFLIGHT_RECONCILIATION_REQUIREMENT = "required-post-trade";

const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;
const BURNER_MAX_LEN = 44;
const BURNER_MIN_LEN = 32;
const BURNER_BYTES = 32;

/** Thrown when a preflight INPUT or produced artifact is structurally invalid. */
export class Phase7MicrotradePreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase7MicrotradePreflightError";
  }
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reject any string carrying a control character / NUL / DEL / C1 control / BOM / line-or-paragraph
 * separator. charCodeAt rather than a regex literal so no control byte is embedded in this source.
 */
function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new Phase7MicrotradePreflightError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new Phase7MicrotradePreflightError(`${name} is required`);
  }
  if (typeof value !== "string") throw new Phase7MicrotradePreflightError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new Phase7MicrotradePreflightError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new Phase7MicrotradePreflightError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new Phase7MicrotradePreflightError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Phase7MicrotradePreflightError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new Phase7MicrotradePreflightError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string" || s.trim().length === 0) throw new Phase7MicrotradePreflightError(`${name}[${i}] must be a non-empty string`);
    const trimmed = s.trim();
    if (trimmed.length > MAX_LINE_LEN) throw new Phase7MicrotradePreflightError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    return redactString(trimmed);
  });
}

function reqEnum<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Phase7MicrotradePreflightError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

// --- public-key (burner wallet) validation ----------------------------------
// A pure, offline base58 decode that accepts ONLY a 32-byte PUBLIC key (32–44 base58 chars). A
// 64-byte secret key encodes to ~88 chars and is refused before it is ever decoded, so a private key
// or seed can never be accepted as a burner wallet. Mirrors @soulmaker/sniper's parseMintAddress so
// @soulmaker/execution stays dependency-free (no @solana/web3.js, no chain capability).

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES: ReadonlyMap<string, number> = new Map([...BASE58_ALPHABET].map((ch, i) => [ch, i]));

function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return new Uint8Array(0);
  const bytes: number[] = [];
  for (const ch of input) {
    const value = BASE58_VALUES.get(ch);
    if (value === undefined) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  for (let k = 0; k < input.length && input[k] === "1"; k += 1) leadingZeros += 1;
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[leadingZeros + i] = bytes[bytes.length - 1 - i]!;
  return out;
}

/**
 * Validate a string as a Solana PUBLIC key and return the trimmed canonical form, or throw. The
 * too-long branch never echoes the input (it could be secret material).
 */
export function parseBurnerPublicKey(input: unknown): string {
  if (typeof input !== "string") throw new Phase7MicrotradePreflightError("burner wallet must be a string");
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Phase7MicrotradePreflightError("burner wallet is empty");
  if (trimmed.length > BURNER_MAX_LEN) {
    throw new Phase7MicrotradePreflightError(
      `burner wallet is ${trimmed.length} chars — too long to be a public key. Refusing (never paste a private key here).`,
    );
  }
  if (trimmed.length < BURNER_MIN_LEN) {
    throw new Phase7MicrotradePreflightError(`burner wallet is ${trimmed.length} chars — too short to be a public key`);
  }
  const decoded = base58Decode(trimmed);
  if (decoded === null) throw new Phase7MicrotradePreflightError(`"${trimmed}" is not valid base58`);
  if (decoded.length !== BURNER_BYTES) {
    throw new Phase7MicrotradePreflightError(`"${trimmed}" does not decode to a 32-byte public key (got ${decoded.length} bytes)`);
  }
  return trimmed;
}

// --- artifact model ----------------------------------------------------------

/** Everything {@link buildPhase7MicrotradePreflight} accepts. */
export interface BuildPhase7MicrotradePreflightInput {
  preflightId?: string;
  repoSha?: string;
  generatedAt?: string | null;
  /** Defaults to (and must equal) "mainnet-beta". */
  network?: string;
  /** Optional corroboration; the audit gates nothing here — the individual artifacts do. */
  phase7AuditStatus?: Phase7PreflightAuditStatus;
  signoffStatus: Phase7PreflightSignoffStatus;
  devnetProofStatus: Phase7PreflightDevnetStatus;
  releaseCandidateStatus: Phase7PreflightRcStatus;
  /** A PUBLIC burner key (null/absent → status absent; invalid → throws). */
  burnerWalletAddress?: string | null;
  /** Bounded micro-trade cap in lamports (≤ the micro ceiling; throws if over). */
  maxSpendCapLamports?: number | null;
  /** A non-empty manual-confirmation label (null/blank → status absent). */
  manualConfirmationLabel?: string | null;
  quoteFreshnessStatus: Phase7PreflightQuoteStatus;
  riskStatus: Phase7PreflightRiskStatus;
  token2022BlockerStatus: Phase7PreflightToken2022Status;
  simulationStatus: Phase7PreflightSimulationStatus;
  caveats?: string[];
}

/** The full, deterministic, JSON-serializable preflight artifact. */
export interface Phase7MicrotradePreflight {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  preflightId: string;
  repoSha: string;
  generatedAt: string | null;
  mode: "controlled-mainnet-microtrade-preflight";
  network: "mainnet-beta";
  preflightVerdict: Phase7MicrotradePreflightVerdict;
  phase7AuditStatus: Phase7PreflightAuditStatus;
  signoffStatus: Phase7PreflightSignoffStatus;
  devnetProofStatus: Phase7PreflightDevnetStatus;
  releaseCandidateStatus: Phase7PreflightRcStatus;
  burnerWalletStatus: Phase7PreflightBurnerStatus;
  burnerWalletAddress: string | null;
  maxSpendCapLamports: number | null;
  maxSpendCapSol: number | null;
  manualConfirmationStatus: Phase7PreflightManualConfirmationStatus;
  manualConfirmationLabel: string | null;
  quoteFreshnessStatus: Phase7PreflightQuoteStatus;
  riskStatus: Phase7PreflightRiskStatus;
  token2022BlockerStatus: Phase7PreflightToken2022Status;
  simulationStatus: Phase7PreflightSimulationStatus;
  killSwitchStatus: string;
  reconciliationRequirement: string;
  missingRequirements: string[];
  nextSafeAction: string;
  caveats: string[];
  /** Pinned safety locks the validator refuses to see flipped. */
  redactionApplied: true;
  liveExecutionAuthorized: false;
  authorizesLiveTrading: false;
  requiresSeparateExecutionApproval: true;
  neverSends: true;
  neverSigns: true;
  notExecutable: true;
  phase7LiveTradingReady: false;
}

// --- verdict derivation (the parity heart) -----------------------------------

/** The structured statuses the verdict derivation reads. A score is deliberately NOT among them. */
export interface Phase7PreflightVerdictEvidence {
  signoffStatus: Phase7PreflightSignoffStatus;
  devnetProofStatus: Phase7PreflightDevnetStatus;
  releaseCandidateStatus: Phase7PreflightRcStatus;
  burnerWalletStatus: Phase7PreflightBurnerStatus;
  manualConfirmationStatus: Phase7PreflightManualConfirmationStatus;
}

/**
 * Re-derive the closed verdict from the structured statuses ALONE. DEFAULTS to a blocked state: the
 * best outcome requires the sign-off, the reconciled devnet proof, a complete release candidate, a
 * valid public burner wallet, and a manual-confirmation label — in that precedence. The release
 * candidate's own verdict is re-derived (never from a score), so a high candidate score can never
 * move this past a blocked release candidate. Pure and deterministic.
 */
export function derivePhase7MicrotradePreflightVerdict(ev: Phase7PreflightVerdictEvidence): Phase7MicrotradePreflightVerdict {
  if (ev.signoffStatus !== "signed-for-controlled-microtrade") return "blocked-missing-signoff";
  if (ev.devnetProofStatus !== "confirmed-reconciled") return "blocked-missing-devnet-proof";
  switch (ev.releaseCandidateStatus) {
    case "blocked-risk":
      return "blocked-risk";
    case "blocked-quote":
      return "blocked-quote";
    case "blocked-simulation":
      return "blocked-simulation";
    case "complete-blocked-live":
      break;
    // absent / error / incomplete / blocked-build all mean "no complete release candidate".
    default:
      return "blocked-missing-release-candidate";
  }
  if (ev.burnerWalletStatus !== "valid-public-key") return "blocked-missing-burner-wallet";
  if (ev.manualConfirmationStatus !== "present") return "blocked-missing-manual-confirmation";
  return "ready-for-separate-execution-authorization";
}

/**
 * Cross-check the release-candidate echoes against its status. A `complete-blocked-live` RC must
 * carry a clear risk, no Token-2022 blocker, a fresh quote, and a passing simulation; a blocked RC
 * must reflect the matching blocker. Prevents a misleading artifact that claims readiness while an
 * echo says otherwise. Pure; throws {@link Phase7MicrotradePreflightError}.
 */
function assertReleaseCandidateConsistency(
  rc: Phase7PreflightRcStatus,
  risk: Phase7PreflightRiskStatus,
  token2022: Phase7PreflightToken2022Status,
  quote: Phase7PreflightQuoteStatus,
  sim: Phase7PreflightSimulationStatus,
): void {
  switch (rc) {
    case "complete-blocked-live":
      if (risk !== "clear") throw new Phase7MicrotradePreflightError("a complete-blocked-live release candidate requires riskStatus=clear");
      if (token2022 !== "none") throw new Phase7MicrotradePreflightError("a complete-blocked-live release candidate requires token2022BlockerStatus=none");
      if (quote !== "fresh") throw new Phase7MicrotradePreflightError("a complete-blocked-live release candidate requires quoteFreshnessStatus=fresh");
      if (sim !== "simulated-ok") throw new Phase7MicrotradePreflightError("a complete-blocked-live release candidate requires simulationStatus=simulated-ok");
      break;
    case "blocked-risk":
      if (risk === "clear" && token2022 !== "present") {
        throw new Phase7MicrotradePreflightError("a blocked-risk release candidate requires a non-clear riskStatus or a Token-2022 blocker");
      }
      break;
    case "blocked-quote":
      if (quote !== "stale" && quote !== "missing") {
        throw new Phase7MicrotradePreflightError("a blocked-quote release candidate requires quoteFreshnessStatus=stale|missing");
      }
      break;
    case "blocked-simulation":
      if (sim !== "failed") throw new Phase7MicrotradePreflightError("a blocked-simulation release candidate requires simulationStatus=failed");
      break;
    default:
      // absent / error / incomplete / blocked-build place no constraint on the echoes.
      break;
  }
}

// --- derived prose -----------------------------------------------------------

function deriveMissingRequirements(a: {
  phase7AuditStatus: Phase7PreflightAuditStatus;
  signoffStatus: Phase7PreflightSignoffStatus;
  devnetProofStatus: Phase7PreflightDevnetStatus;
  releaseCandidateStatus: Phase7PreflightRcStatus;
  burnerWalletStatus: Phase7PreflightBurnerStatus;
  manualConfirmationStatus: Phase7PreflightManualConfirmationStatus;
}): string[] {
  const missing: string[] = [];
  if (a.signoffStatus !== "signed-for-controlled-microtrade") {
    missing.push(
      a.signoffStatus === "absent"
        ? "a written human Phase 7 sign-off (none supplied) — generate one with paper:phase7:signoff:template"
        : "a written human Phase 7 sign-off at status signed-for-controlled-microtrade (the supplied record is not fully signed)",
    );
  }
  if (a.devnetProofStatus !== "confirmed-reconciled") {
    missing.push(
      a.devnetProofStatus === "absent"
        ? "a reconciled devnet broadcast proof (none supplied) — run execution:devnet:funding-status --complete-if-funded then reconcile"
        : "a reconciled devnet broadcast proof (the supplied reconciliation is not verdict=reconciled)",
    );
  }
  switch (a.releaseCandidateStatus) {
    case "complete-blocked-live":
      break;
    case "absent":
      missing.push("a complete mainnet dry-run release candidate (none supplied) — run paper:sniper:rehearse --mode mainnet-dry-run");
      break;
    case "blocked-risk":
      missing.push("a release candidate that is not blocked on risk (deep risk rejected / critical flag / Token-2022 blocker)");
      break;
    case "blocked-quote":
      missing.push("a release candidate with a fresh observed route quote (the dry-run is blocked on quote freshness)");
      break;
    case "blocked-build":
      missing.push("a release candidate whose unsigned build succeeded (the dry-run is blocked on build refusal)");
      break;
    case "blocked-simulation":
      missing.push("a release candidate whose simulation passed (the dry-run is blocked on simulation failure)");
      break;
    default:
      missing.push("a complete mainnet dry-run release candidate (the supplied release candidate is not dryrun-complete-blocked-live)");
      break;
  }
  if (a.burnerWalletStatus !== "valid-public-key") {
    missing.push(
      a.burnerWalletStatus === "absent"
        ? "a public burner wallet address (none supplied)"
        : "a VALID public burner wallet address (the supplied value is not a 32-byte public key)",
    );
  }
  if (a.manualConfirmationStatus !== "present") {
    missing.push("an explicit manual-confirmation label (none supplied)");
  }
  if (a.phase7AuditStatus === "not-authorized") {
    missing.push("a Phase 7 authorization audit that is not 'not-authorized' (the supplied audit reports a safety regression)");
  }
  return missing;
}

function deriveNextSafeAction(verdict: Phase7MicrotradePreflightVerdict): string {
  switch (verdict) {
    case "blocked-missing-signoff":
      return "Record a written human Phase 7 sign-off (paper:phase7:signoff:template with every acknowledgement, --operator-label, --signed-at, --max-spend-sol) at status signed-for-controlled-microtrade. Nothing here executes a trade.";
    case "blocked-missing-devnet-proof":
      return "Land a reconciled devnet broadcast proof (execution:devnet:funding-status --complete-if-funded, then execution:session:reconcile). Nothing here executes a trade.";
    case "blocked-missing-release-candidate":
      return "Produce a complete mainnet dry-run release candidate (paper:sniper:rehearse --mode mainnet-dry-run) that reaches dryrun-complete-blocked-live. Nothing here executes a trade.";
    case "blocked-risk":
      return "Resolve the risk block in the release candidate (drop the rejected/critical/Token-2022 candidate); never override a risk gate. Nothing here executes a trade.";
    case "blocked-quote":
      return "Re-run the dry-run with a fresh observed route quote within the configured age cap. Nothing here executes a trade.";
    case "blocked-simulation":
      return "Read the simulation classification in the dry-run; the failure is a real signal, not a bug to bypass. Nothing here executes a trade.";
    case "blocked-missing-burner-wallet":
      return "Supply a dedicated PUBLIC burner wallet address (--burner-wallet) funded with a tiny disposable amount — never a primary or treasury wallet, never a secret key. Nothing here executes a trade.";
    case "blocked-missing-manual-confirmation":
      return "Supply an explicit manual-confirmation label (--manual-confirmation-label) acknowledging the operator will confirm the single trade by hand at send time. Nothing here executes a trade.";
    case "ready-for-separate-execution-authorization":
      return "Every structural input is present. The ONLY authorized next step is a separate, explicit, written S104 execution authorization — which this artifact is not and cannot grant. Live trading stays disabled; this command never sends.";
  }
}

const DEFAULT_CAVEATS: readonly string[] = [
  "This preflight checks PRESENCE of structural inputs only — it never claims a trade is safe, profitable, or approved.",
  "The verdict is re-derived from the structured statuses; a high candidate score can never move a blocked release candidate, and the validator recomputes the verdict independently.",
  "The kill switch (required clear at execution) and post-trade reconciliation (required) are future-execution requirements recorded here as REQUIRED — this artifact satisfies neither because it never executes.",
  "Even the best verdict authorizes nothing: a controlled S104 micro-trade needs a separate, explicit, written authorization, the fourteen-condition live gate with real evidence, and a reviewed execution sprint.",
];

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link Phase7MicrotradePreflight} from summarized evidence. Pure, non-mutating,
 * deterministic. The verdict is RE-DERIVED from the structured statuses and DEFAULTS to a blocked
 * state. Throws {@link Phase7MicrotradePreflightError} on any structural problem (an over-cap spend,
 * an invalid burner key, or an inconsistent release-candidate echo).
 */
export function buildPhase7MicrotradePreflight(input: BuildPhase7MicrotradePreflightInput): Phase7MicrotradePreflight {
  if (!isObject(input)) throw new Phase7MicrotradePreflightError("preflight input must be an object");

  const network = input.network ?? PHASE7_MICROTRADE_PREFLIGHT_NETWORK;
  if (network !== PHASE7_MICROTRADE_PREFLIGHT_NETWORK) {
    throw new Phase7MicrotradePreflightError(`network must be "${PHASE7_MICROTRADE_PREFLIGHT_NETWORK}" — a micro-trade preflight is mainnet only`);
  }

  const preflightId = (safeLabel(input.preflightId, "preflightId", 128, true) as string | null) ?? "phase7-microtrade-preflight";
  const repoSha = (safeLabel(input.repoSha, "repoSha", 64, true) as string | null) ?? "unspecified";
  const generatedAt = safeLabel(input.generatedAt, "generatedAt", 40, true);

  const phase7AuditStatus = input.phase7AuditStatus === undefined
    ? "not-supplied"
    : reqEnum(input.phase7AuditStatus, "phase7AuditStatus", PHASE7_PREFLIGHT_AUDIT_STATUSES);
  const signoffStatus = reqEnum(input.signoffStatus, "signoffStatus", PHASE7_PREFLIGHT_SIGNOFF_STATUSES);
  const devnetProofStatus = reqEnum(input.devnetProofStatus, "devnetProofStatus", PHASE7_PREFLIGHT_DEVNET_STATUSES);
  const releaseCandidateStatus = reqEnum(input.releaseCandidateStatus, "releaseCandidateStatus", PHASE7_PREFLIGHT_RC_STATUSES);
  const quoteFreshnessStatus = reqEnum(input.quoteFreshnessStatus, "quoteFreshnessStatus", PHASE7_PREFLIGHT_QUOTE_STATUSES);
  const riskStatus = reqEnum(input.riskStatus, "riskStatus", PHASE7_PREFLIGHT_RISK_STATUSES);
  const token2022BlockerStatus = reqEnum(input.token2022BlockerStatus, "token2022BlockerStatus", PHASE7_PREFLIGHT_TOKEN2022_STATUSES);
  const simulationStatus = reqEnum(input.simulationStatus, "simulationStatus", PHASE7_PREFLIGHT_SIMULATION_STATUSES);

  assertReleaseCandidateConsistency(releaseCandidateStatus, riskStatus, token2022BlockerStatus, quoteFreshnessStatus, simulationStatus);

  // Burner wallet: null/absent → absent; provided-and-invalid → throw; valid → recorded public key.
  let burnerWalletAddress: string | null = null;
  let burnerWalletStatus: Phase7PreflightBurnerStatus = "absent";
  if (input.burnerWalletAddress !== undefined && input.burnerWalletAddress !== null) {
    burnerWalletAddress = parseBurnerPublicKey(input.burnerWalletAddress);
    burnerWalletStatus = "valid-public-key";
  }

  // Max-spend cap: optional, bounded by the micro ceiling.
  let maxSpendCapLamports: number | null = null;
  if (input.maxSpendCapLamports !== undefined && input.maxSpendCapLamports !== null) {
    if (typeof input.maxSpendCapLamports !== "number" || !Number.isInteger(input.maxSpendCapLamports) || input.maxSpendCapLamports <= 0) {
      throw new Phase7MicrotradePreflightError("maxSpendCapLamports must be a positive integer (lamports)");
    }
    if (input.maxSpendCapLamports > PHASE7_MICROTRADE_PREFLIGHT_MAX_SPEND_LAMPORTS) {
      throw new Phase7MicrotradePreflightError(
        `maxSpendCapLamports exceeds the micro-trade ceiling of ${PHASE7_MICROTRADE_PREFLIGHT_MAX_SPEND_LAMPORTS} lamports (${PHASE7_MICROTRADE_PREFLIGHT_MAX_SPEND_LAMPORTS / LAMPORTS_PER_SOL} SOL)`,
      );
    }
    maxSpendCapLamports = input.maxSpendCapLamports;
  }
  const maxSpendCapSol = maxSpendCapLamports === null ? null : maxSpendCapLamports / LAMPORTS_PER_SOL;

  // A fully-signed micro-trade record always carries a bounded cap; refuse the contradiction.
  if (signoffStatus === "signed-for-controlled-microtrade" && maxSpendCapLamports === null) {
    throw new Phase7MicrotradePreflightError("a signed-for-controlled-microtrade sign-off requires a bounded maxSpendCapLamports");
  }

  const manualConfirmationLabel = safeLabel(input.manualConfirmationLabel, "manualConfirmationLabel", MAX_LABEL_LEN, true);
  const manualConfirmationStatus: Phase7PreflightManualConfirmationStatus = manualConfirmationLabel === null ? "absent" : "present";

  const preflightVerdict = derivePhase7MicrotradePreflightVerdict({
    signoffStatus,
    devnetProofStatus,
    releaseCandidateStatus,
    burnerWalletStatus,
    manualConfirmationStatus,
  });

  const missingRequirements = deriveMissingRequirements({
    phase7AuditStatus,
    signoffStatus,
    devnetProofStatus,
    releaseCandidateStatus,
    burnerWalletStatus,
    manualConfirmationStatus,
  });
  const nextSafeAction = deriveNextSafeAction(preflightVerdict);
  const caveats = normalizeStringList(input.caveats ?? [...DEFAULT_CAVEATS], "caveats", MAX_LIST);

  return {
    schemaVersion: PHASE7_MICROTRADE_PREFLIGHT_SCHEMA_VERSION,
    banner: PHASE7_MICROTRADE_PREFLIGHT_BANNER,
    disclaimers: [...PHASE7_MICROTRADE_PREFLIGHT_DISCLAIMERS],
    preflightId,
    repoSha,
    generatedAt,
    mode: PHASE7_MICROTRADE_PREFLIGHT_MODE,
    network: PHASE7_MICROTRADE_PREFLIGHT_NETWORK,
    preflightVerdict,
    phase7AuditStatus,
    signoffStatus,
    devnetProofStatus,
    releaseCandidateStatus,
    burnerWalletStatus,
    burnerWalletAddress,
    maxSpendCapLamports,
    maxSpendCapSol,
    manualConfirmationStatus,
    manualConfirmationLabel,
    quoteFreshnessStatus,
    riskStatus,
    token2022BlockerStatus,
    simulationStatus,
    killSwitchStatus: PHASE7_PREFLIGHT_KILL_SWITCH_REQUIREMENT,
    reconciliationRequirement: PHASE7_PREFLIGHT_RECONCILIATION_REQUIREMENT,
    missingRequirements,
    nextSafeAction,
    caveats,
    redactionApplied: true,
    liveExecutionAuthorized: false,
    authorizesLiveTrading: false,
    requiresSeparateExecutionApproval: true,
    neverSends: true,
    neverSigns: true,
    notExecutable: true,
    phase7LiveTradingReady: false,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "preflightId",
  "repoSha",
  "generatedAt",
  "mode",
  "network",
  "preflightVerdict",
  "phase7AuditStatus",
  "signoffStatus",
  "devnetProofStatus",
  "releaseCandidateStatus",
  "burnerWalletStatus",
  "burnerWalletAddress",
  "maxSpendCapLamports",
  "maxSpendCapSol",
  "manualConfirmationStatus",
  "manualConfirmationLabel",
  "quoteFreshnessStatus",
  "riskStatus",
  "token2022BlockerStatus",
  "simulationStatus",
  "killSwitchStatus",
  "reconciliationRequirement",
  "missingRequirements",
  "nextSafeAction",
  "caveats",
  "redactionApplied",
  "liveExecutionAuthorized",
  "authorizesLiveTrading",
  "requiresSeparateExecutionApproval",
  "neverSends",
  "neverSigns",
  "notExecutable",
  "phase7LiveTradingReady",
] as const;

const PINNED_LOCKS = [
  ["redactionApplied", true],
  ["liveExecutionAuthorized", false],
  ["authorizesLiveTrading", false],
  ["requiresSeparateExecutionApproval", true],
  ["neverSends", true],
  ["neverSigns", true],
  ["notExecutable", true],
  ["phase7LiveTradingReady", false],
] as const;

/**
 * Strictly validate a value as a canonical {@link Phase7MicrotradePreflight} and return it narrowed.
 * A backstop AND a parity wall: the key set is CLOSED; the mode/network/safety literals are pinned;
 * the verdict, the burner status, the max-spend, and the release-candidate echo consistency are
 * INDEPENDENTLY re-derived from the echoed evidence and must match — so no tampered status can claim
 * readiness the evidence does not support, and no mainnet send result or signature can ride in under
 * an unknown field. Throws {@link Phase7MicrotradePreflightError} on the first problem. Pure.
 */
export function validatePhase7MicrotradePreflight(value: unknown): Phase7MicrotradePreflight {
  if (!isObject(value)) throw new Phase7MicrotradePreflightError("preflight must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new Phase7MicrotradePreflightError(`preflight has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new Phase7MicrotradePreflightError(`preflight is missing field "${key}"`);
  }

  if (value.schemaVersion !== PHASE7_MICROTRADE_PREFLIGHT_SCHEMA_VERSION) {
    throw new Phase7MicrotradePreflightError(`schemaVersion must be "${PHASE7_MICROTRADE_PREFLIGHT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE7_MICROTRADE_PREFLIGHT_BANNER) throw new Phase7MicrotradePreflightError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase7MicrotradePreflightError("disclaimers must be a non-empty array");
  }
  if (value.mode !== PHASE7_MICROTRADE_PREFLIGHT_MODE) {
    throw new Phase7MicrotradePreflightError(`mode must literally be "${PHASE7_MICROTRADE_PREFLIGHT_MODE}"`);
  }
  if (value.network !== PHASE7_MICROTRADE_PREFLIGHT_NETWORK) {
    throw new Phase7MicrotradePreflightError(`network must literally be "${PHASE7_MICROTRADE_PREFLIGHT_NETWORK}"`);
  }

  safeLabel(value.preflightId, "preflightId", 128, false);
  safeLabel(value.repoSha, "repoSha", 64, false);
  safeLabel(value.generatedAt, "generatedAt", 40, true);

  const phase7AuditStatus = reqEnum(value.phase7AuditStatus, "phase7AuditStatus", PHASE7_PREFLIGHT_AUDIT_STATUSES);
  const signoffStatus = reqEnum(value.signoffStatus, "signoffStatus", PHASE7_PREFLIGHT_SIGNOFF_STATUSES);
  const devnetProofStatus = reqEnum(value.devnetProofStatus, "devnetProofStatus", PHASE7_PREFLIGHT_DEVNET_STATUSES);
  const releaseCandidateStatus = reqEnum(value.releaseCandidateStatus, "releaseCandidateStatus", PHASE7_PREFLIGHT_RC_STATUSES);
  const burnerWalletStatus = reqEnum(value.burnerWalletStatus, "burnerWalletStatus", PHASE7_PREFLIGHT_BURNER_STATUSES);
  const manualConfirmationStatus = reqEnum(value.manualConfirmationStatus, "manualConfirmationStatus", PHASE7_PREFLIGHT_MANUAL_CONFIRMATION_STATUSES);
  const quoteFreshnessStatus = reqEnum(value.quoteFreshnessStatus, "quoteFreshnessStatus", PHASE7_PREFLIGHT_QUOTE_STATUSES);
  const riskStatus = reqEnum(value.riskStatus, "riskStatus", PHASE7_PREFLIGHT_RISK_STATUSES);
  const token2022BlockerStatus = reqEnum(value.token2022BlockerStatus, "token2022BlockerStatus", PHASE7_PREFLIGHT_TOKEN2022_STATUSES);
  const simulationStatus = reqEnum(value.simulationStatus, "simulationStatus", PHASE7_PREFLIGHT_SIMULATION_STATUSES);

  if (!(PHASE7_MICROTRADE_PREFLIGHT_VERDICTS as readonly string[]).includes(value.preflightVerdict as string)) {
    throw new Phase7MicrotradePreflightError(`preflightVerdict must be one of: ${PHASE7_MICROTRADE_PREFLIGHT_VERDICTS.join(", ")}`);
  }

  // Re-validate the burner wallet: a valid status must carry a decodable public key; an absent/invalid
  // status must NOT carry an address.
  if (value.burnerWalletAddress !== null) {
    if (burnerWalletStatus !== "valid-public-key") {
      throw new Phase7MicrotradePreflightError("burnerWalletAddress must be null unless burnerWalletStatus is valid-public-key");
    }
    parseBurnerPublicKey(value.burnerWalletAddress);
  } else if (burnerWalletStatus === "valid-public-key") {
    throw new Phase7MicrotradePreflightError("burnerWalletStatus is valid-public-key but burnerWalletAddress is null");
  }

  // Re-validate + re-derive the max-spend cap.
  if (value.maxSpendCapLamports !== null) {
    if (typeof value.maxSpendCapLamports !== "number" || !Number.isInteger(value.maxSpendCapLamports) || value.maxSpendCapLamports <= 0) {
      throw new Phase7MicrotradePreflightError("maxSpendCapLamports must be null or a positive integer");
    }
    if (value.maxSpendCapLamports > PHASE7_MICROTRADE_PREFLIGHT_MAX_SPEND_LAMPORTS) {
      throw new Phase7MicrotradePreflightError("maxSpendCapLamports exceeds the micro-trade ceiling");
    }
  }
  const expectedSol = value.maxSpendCapLamports === null ? null : (value.maxSpendCapLamports as number) / LAMPORTS_PER_SOL;
  if (value.maxSpendCapSol !== expectedSol) {
    throw new Phase7MicrotradePreflightError("maxSpendCapSol must equal maxSpendCapLamports / 1e9 (re-derived)");
  }
  if (signoffStatus === "signed-for-controlled-microtrade" && value.maxSpendCapLamports === null) {
    throw new Phase7MicrotradePreflightError("a signed-for-controlled-microtrade sign-off requires a bounded maxSpendCapLamports");
  }

  // Re-validate the manual-confirmation label and re-derive its status.
  const manualLabel = safeLabel(value.manualConfirmationLabel, "manualConfirmationLabel", MAX_LABEL_LEN, true);
  const expectedManualStatus: Phase7PreflightManualConfirmationStatus = manualLabel === null ? "absent" : "present";
  if (manualConfirmationStatus !== expectedManualStatus) {
    throw new Phase7MicrotradePreflightError("manualConfirmationStatus must be re-derived from the presence of manualConfirmationLabel");
  }

  // The release-candidate echo must be consistent with its status.
  assertReleaseCandidateConsistency(releaseCandidateStatus, riskStatus, token2022BlockerStatus, quoteFreshnessStatus, simulationStatus);

  // Re-derive the verdict from the echoed statuses and require a match (the parity wall).
  const expectedVerdict = derivePhase7MicrotradePreflightVerdict({
    signoffStatus,
    devnetProofStatus,
    releaseCandidateStatus,
    burnerWalletStatus,
    manualConfirmationStatus,
  });
  if (value.preflightVerdict !== expectedVerdict) {
    throw new Phase7MicrotradePreflightError(
      `preflightVerdict must be ${JSON.stringify(expectedVerdict)} (re-derived from the echoed statuses), got ${JSON.stringify(value.preflightVerdict)}`,
    );
  }

  if (value.killSwitchStatus !== PHASE7_PREFLIGHT_KILL_SWITCH_REQUIREMENT) {
    throw new Phase7MicrotradePreflightError(`killSwitchStatus must literally be "${PHASE7_PREFLIGHT_KILL_SWITCH_REQUIREMENT}"`);
  }
  if (value.reconciliationRequirement !== PHASE7_PREFLIGHT_RECONCILIATION_REQUIREMENT) {
    throw new Phase7MicrotradePreflightError(`reconciliationRequirement must literally be "${PHASE7_PREFLIGHT_RECONCILIATION_REQUIREMENT}"`);
  }
  if (!Array.isArray(value.missingRequirements)) throw new Phase7MicrotradePreflightError("missingRequirements must be an array");
  normalizeStringList(value.missingRequirements, "missingRequirements", MAX_LIST);
  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new Phase7MicrotradePreflightError("nextSafeAction must be a non-empty string");
  }
  if (!Array.isArray(value.caveats) || value.caveats.length === 0) throw new Phase7MicrotradePreflightError("caveats must be a non-empty array");

  // A ready verdict must have an EMPTY missingRequirements set — readiness cannot coexist with a gap.
  if (expectedVerdict === "ready-for-separate-execution-authorization" && (value.missingRequirements as unknown[]).length !== 0) {
    throw new Phase7MicrotradePreflightError("a ready preflight must have no missingRequirements");
  }

  // phase7AuditStatus is recorded but does not gate the verdict; a not-authorized audit is reflected
  // only in missingRequirements (the individual artifact gates carry the real blocking).
  void phase7AuditStatus;

  for (const [field, expected] of PINNED_LOCKS) {
    if (value[field] !== expected) throw new Phase7MicrotradePreflightError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as Phase7MicrotradePreflight;
}
