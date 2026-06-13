/**
 * Deterministic, **read-only** DEVNET FUNDING STATUS artifact (Sprint 103-B).
 *
 * `execution.devnet.funding_status.v1` is the honest, retained answer to a single operational
 * question: *is the throwaway devnet rehearsal key funded enough to broadcast the self-transfer
 * probe?* It folds one observed devnet balance read (and, when the operator attempted one, a bounded
 * faucet airdrop summary) into a closed status the project can keep instead of repeatedly "checking
 * and moving on".
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work. The orchestrator reads the
 * balance from a devnet RPC seam and hands the observed facts here. The builder is structurally
 * incapable of faking funding or naming a secret:
 *
 *   - it stores a PUBLIC key only (validated as a real base58 Solana public key) — never a secret;
 *   - `funded` and `canBroadcastDevnetProbe` are RE-DERIVED from the observed lamports against the
 *     minimum, never accepted as input — an unobserved balance can never read as funded;
 *   - `network` is the literal `"devnet"`; `neverMainnet` is pinned true; `phase7LiveTradingReady`
 *     is pinned false.
 *
 * The closed `fundingSourceStatus` set distinguishes every honest outcome of the read:
 *
 *   - `funded`              — balance observed and at/above the minimum (the probe can be broadcast);
 *   - `unfunded`            — balance observed and below the minimum, no faucet failure recorded;
 *   - `faucet-rate-limited` — observed-but-short AND the attempted airdrop was rate-limited (429);
 *   - `faucet-unavailable`  — observed-but-short AND the attempted airdrop failed for another reason;
 *   - `rpc-unavailable`     — the balance read itself failed (no balance is known);
 *   - `unknown`             — the RPC responded with something that is not an interpretable balance.
 */

import { PublicKey } from "@solana/web3.js";
import { redactString } from "@soulmaker/security";

/** Stable schema identifier. Bump only on a breaking change. */
export const DEVNET_FUNDING_STATUS_SCHEMA_VERSION = "execution.devnet.funding_status.v1";

/** The banner that prefixes every funding-status artifact (required label). */
export const DEVNET_FUNDING_STATUS_BANNER =
  "DEVNET FUNDING STATUS — a read-only devnet balance observation for a throwaway rehearsal key. Devnet SOL is valueless; this never reads a secret key, never touches mainnet, and authorizes no live trading.";

/** Lamports in one SOL. */
export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Default minimum to consider the key broadcast-ready (the rehearsal's own probe minimum). */
export const DEVNET_FUNDING_DEFAULT_MIN_LAMPORTS = 100_000;

/** A sane ceiling for the minimum (2 SOL) — keeps the "ready" bar honest and bounded. */
const MAX_MIN_LAMPORTS = 2 * LAMPORTS_PER_SOL;

/** Closed set of funding-source conclusions. */
export const DEVNET_FUNDING_SOURCE_STATUSES = [
  "funded",
  "unfunded",
  "faucet-rate-limited",
  "faucet-unavailable",
  "rpc-unavailable",
  "unknown",
] as const;
export type DevnetFundingSourceStatus = (typeof DEVNET_FUNDING_SOURCE_STATUSES)[number];

/** Closed set of balance-read outcomes the orchestrator can hand in. */
export const DEVNET_BALANCE_READ_STATUSES = ["observed", "rpc-unavailable", "unknown"] as const;
export type DevnetBalanceReadStatus = (typeof DEVNET_BALANCE_READ_STATUSES)[number];

/** Closed set of bounded faucet-attempt outcomes. */
export const DEVNET_FAUCET_ATTEMPT_OUTCOMES = ["submitted", "rate-limited", "unavailable"] as const;
export type DevnetFaucetAttemptOutcome = (typeof DEVNET_FAUCET_ATTEMPT_OUTCOMES)[number];

const MAX_LINE_LEN = 400;
const MAX_LIST = 32;

/** Thrown when a funding-status INPUT or produced artifact is structurally invalid. */
export class DevnetFundingStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevnetFundingStatusError";
  }
}

/** A bounded faucet airdrop attempt summary (present ONLY when an airdrop was attempted). */
export interface DevnetFaucetAttemptSummary {
  attempted: true;
  attempts: number;
  maxAttempts: number;
  outcome: DevnetFaucetAttemptOutcome;
  detail: string;
}

/** The observed balance read result the orchestrator hands the builder. */
export type DevnetBalanceObservation =
  | { status: "observed"; lamports: number }
  | { status: "rpc-unavailable"; detail: string }
  | { status: "unknown"; detail: string };

/** Everything {@link buildDevnetFundingStatus} accepts. */
export interface BuildDevnetFundingStatusInput {
  publicKey: string;
  checkedAt?: string | null;
  minimumRequiredLamports?: number;
  balance: DevnetBalanceObservation;
  faucetAttempt?: DevnetFaucetAttemptSummary | null;
  caveats?: string[];
}

/** The full, deterministic, JSON-serializable devnet funding-status artifact. */
export interface DevnetFundingStatusReport {
  schemaVersion: string;
  banner: string;
  network: "devnet";
  publicKey: string;
  checkedAt: string | null;
  balanceReadStatus: DevnetBalanceReadStatus;
  balanceReadDetail: string | null;
  lamports: number | null;
  solBalance: number | null;
  minimumRequiredLamports: number;
  funded: boolean;
  canBroadcastDevnetProbe: boolean;
  fundingSourceStatus: DevnetFundingSourceStatus;
  faucetAttemptSummary: DevnetFaucetAttemptSummary | null;
  nextSafeAction: string;
  caveats: string[];
  redactionApplied: boolean;
  /** Pinned safety locks the validator refuses to see flipped. */
  neverMainnet: true;
  phase7LiveTradingReady: false;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reject any string carrying a control character / NUL / DEL / C1 control / BOM / line-or-paragraph
 * separator. Implemented with charCodeAt rather than a regex literal so no control byte is ever
 * embedded in this source file.
 */
function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new DevnetFundingStatusError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new DevnetFundingStatusError(`${name} is required`);
  }
  if (typeof value !== "string") throw new DevnetFundingStatusError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new DevnetFundingStatusError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new DevnetFundingStatusError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new DevnetFundingStatusError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

/** Tracks whether redaction touched ANY prose field (drives `redactionApplied` honestly). */
class RedactionTracker {
  applied = false;
  prose(value: unknown, name: string, nullable: boolean): string | null {
    if (value === undefined || value === null) {
      if (nullable) return null;
      throw new DevnetFundingStatusError(`${name} is required`);
    }
    if (typeof value !== "string") throw new DevnetFundingStatusError(`${name} must be a string`);
    rejectControlChars(value, name);
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      if (nullable) return null;
      throw new DevnetFundingStatusError(`${name} must be a non-empty string`);
    }
    if (trimmed.length > MAX_LINE_LEN) throw new DevnetFundingStatusError(`${name} exceeds ${MAX_LINE_LEN} characters`);
    const redacted = redactString(trimmed);
    if (redacted !== trimmed) this.applied = true;
    return redacted;
  }
}

/** Validate a base58 Solana public key (32 bytes). Pure: parses, never reaches the network. */
function validateDevnetPublicKey(value: unknown): string {
  const label = safeLabel(value, "publicKey", 64, false) as string;
  let canonical: string;
  try {
    canonical = new PublicKey(label).toBase58();
  } catch {
    throw new DevnetFundingStatusError("publicKey is not a valid base58 Solana public key");
  }
  if (canonical !== label) {
    throw new DevnetFundingStatusError("publicKey is not a canonical base58 Solana public key");
  }
  return label;
}

function reqIntInRange(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new DevnetFundingStatusError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function normalizeStringList(value: unknown, name: string, maxCount: number, tracker: RedactionTracker): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DevnetFundingStatusError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new DevnetFundingStatusError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => tracker.prose(s, `${name}[${i}]`, false) as string);
}

function normalizeFaucetAttempt(raw: unknown, tracker: RedactionTracker): DevnetFaucetAttemptSummary | null {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) throw new DevnetFundingStatusError("faucetAttemptSummary must be an object");
  if (raw.attempted !== true) throw new DevnetFundingStatusError("faucetAttemptSummary.attempted must literally be true");
  const maxAttempts = reqIntInRange(raw.maxAttempts, "faucetAttemptSummary.maxAttempts", 1, 5);
  const attempts = reqIntInRange(raw.attempts, "faucetAttemptSummary.attempts", 0, maxAttempts);
  if (typeof raw.outcome !== "string" || !(DEVNET_FAUCET_ATTEMPT_OUTCOMES as readonly string[]).includes(raw.outcome)) {
    throw new DevnetFundingStatusError(`faucetAttemptSummary.outcome must be one of: ${DEVNET_FAUCET_ATTEMPT_OUTCOMES.join(", ")}`);
  }
  return {
    attempted: true,
    attempts,
    maxAttempts,
    outcome: raw.outcome as DevnetFaucetAttemptOutcome,
    detail: tracker.prose(raw.detail, "faucetAttemptSummary.detail", false) as string,
  };
}

// --- derivation (the parity heart) -------------------------------------------

/**
 * Re-derive the closed funding-source status from the observed facts ALONE. Pure and total: an
 * unobserved balance can never be `funded`; only an observed balance at/above the minimum is.
 */
export function deriveDevnetFundingSourceStatus(
  balanceReadStatus: DevnetBalanceReadStatus,
  funded: boolean,
  faucetOutcome: DevnetFaucetAttemptOutcome | null,
): DevnetFundingSourceStatus {
  if (balanceReadStatus === "rpc-unavailable") return "rpc-unavailable";
  if (balanceReadStatus === "unknown") return "unknown";
  if (funded) return "funded";
  if (faucetOutcome === "rate-limited") return "faucet-rate-limited";
  if (faucetOutcome === "unavailable") return "faucet-unavailable";
  return "unfunded";
}

function deriveNextSafeAction(status: DevnetFundingSourceStatus, publicKey: string): string {
  switch (status) {
    case "funded":
      return `The key is funded. Complete the devnet proof: rerun \`execution:devnet:funding-status --complete-if-funded --acknowledge-devnet-execution\` (or \`execution:devnet:rehearse --skip-airdrop\`), then reconcile. Devnet only — never mainnet.`;
    case "unfunded":
      return `Fund ${publicKey} with valueless DEVNET SOL (https://faucet.solana.com — select devnet — or \`solana airdrop 1 ${publicKey} --url devnet\`), then re-check. Never fund this key on mainnet.`;
    case "faucet-rate-limited":
      return `The devnet faucet rate-limited the airdrop (HTTP 429). Wait, then fund ${publicKey} externally via https://faucet.solana.com (devnet) and re-check. Never fund on mainnet.`;
    case "faucet-unavailable":
      return `The devnet faucet was unavailable. Fund ${publicKey} externally via https://faucet.solana.com (devnet), then re-check. Never fund on mainnet.`;
    case "rpc-unavailable":
      return `The devnet RPC balance read failed. Re-check with a working devnet --rpc-url; never point this at a mainnet endpoint.`;
    case "unknown":
      return `The devnet RPC returned an unrecognized balance response. Re-check with a known-good devnet RPC endpoint; nothing here touches mainnet.`;
  }
}

const DEFAULT_CAVEATS: readonly string[] = [
  "Devnet SOL is valueless — funding here proves execution DISCIPLINE, never trading readiness.",
  "This is a public-key balance observation only; no secret key is ever read, logged, or serialized.",
  "A funded key still does not authorize anything: the fourteen-condition mainnet live gate and Phase 7 sign-off remain required and live trading stays disabled.",
];

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link DevnetFundingStatusReport} from one observed devnet balance read. Pure,
 * non-mutating, deterministic. `funded` / `canBroadcastDevnetProbe` / `fundingSourceStatus` are
 * RE-DERIVED from the observed lamports against the minimum. Throws {@link DevnetFundingStatusError}
 * on any structural problem.
 */
export function buildDevnetFundingStatus(input: BuildDevnetFundingStatusInput): DevnetFundingStatusReport {
  if (!isObject(input)) throw new DevnetFundingStatusError("funding-status input must be an object");
  const tracker = new RedactionTracker();

  const publicKey = validateDevnetPublicKey(input.publicKey);
  const checkedAt = safeLabel(input.checkedAt, "checkedAt", 40, true);
  const minimumRequiredLamports =
    input.minimumRequiredLamports === undefined
      ? DEVNET_FUNDING_DEFAULT_MIN_LAMPORTS
      : reqIntInRange(input.minimumRequiredLamports, "minimumRequiredLamports", 1, MAX_MIN_LAMPORTS);

  if (!isObject(input.balance)) throw new DevnetFundingStatusError("balance must be an object");
  if (typeof input.balance.status !== "string" || !(DEVNET_BALANCE_READ_STATUSES as readonly string[]).includes(input.balance.status)) {
    throw new DevnetFundingStatusError(`balance.status must be one of: ${DEVNET_BALANCE_READ_STATUSES.join(", ")}`);
  }
  const balanceReadStatus = input.balance.status as DevnetBalanceReadStatus;

  let lamports: number | null;
  let balanceReadDetail: string | null;
  if (balanceReadStatus === "observed") {
    lamports = reqIntInRange((input.balance as { lamports: unknown }).lamports, "balance.lamports", 0, Number.MAX_SAFE_INTEGER);
    balanceReadDetail = null;
  } else {
    lamports = null;
    balanceReadDetail = tracker.prose((input.balance as { detail: unknown }).detail, "balance.detail", false);
  }

  const faucetAttemptSummary = normalizeFaucetAttempt(input.faucetAttempt, tracker);

  const funded = lamports !== null && lamports >= minimumRequiredLamports;
  const canBroadcastDevnetProbe = funded;
  const solBalance = lamports === null ? null : lamports / LAMPORTS_PER_SOL;
  const fundingSourceStatus = deriveDevnetFundingSourceStatus(
    balanceReadStatus,
    funded,
    faucetAttemptSummary?.outcome ?? null,
  );
  const nextSafeAction = deriveNextSafeAction(fundingSourceStatus, publicKey);

  const caveats = normalizeStringList(input.caveats ?? [...DEFAULT_CAVEATS], "caveats", MAX_LIST, tracker);

  return {
    schemaVersion: DEVNET_FUNDING_STATUS_SCHEMA_VERSION,
    banner: DEVNET_FUNDING_STATUS_BANNER,
    network: "devnet",
    publicKey,
    checkedAt,
    balanceReadStatus,
    balanceReadDetail,
    lamports,
    solBalance,
    minimumRequiredLamports,
    funded,
    canBroadcastDevnetProbe,
    fundingSourceStatus,
    faucetAttemptSummary,
    nextSafeAction,
    caveats,
    redactionApplied: tracker.applied,
    neverMainnet: true,
    phase7LiveTradingReady: false,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "network",
  "publicKey",
  "checkedAt",
  "balanceReadStatus",
  "balanceReadDetail",
  "lamports",
  "solBalance",
  "minimumRequiredLamports",
  "funded",
  "canBroadcastDevnetProbe",
  "fundingSourceStatus",
  "faucetAttemptSummary",
  "nextSafeAction",
  "caveats",
  "redactionApplied",
  "neverMainnet",
  "phase7LiveTradingReady",
] as const;

/**
 * Strictly validate a value as a canonical {@link DevnetFundingStatusReport} and return it narrowed.
 * A backstop AND a parity wall: the key set is CLOSED; the network and safety literals are pinned;
 * `lamports` / `solBalance` / `funded` / `canBroadcastDevnetProbe` / `fundingSourceStatus` are
 * INDEPENDENTLY re-derived from the echoed facts and must match — so no tampered field can make an
 * unobserved or short balance read as funded. Throws {@link DevnetFundingStatusError}. Pure.
 */
export function validateDevnetFundingStatus(value: unknown): DevnetFundingStatusReport {
  if (!isObject(value)) throw new DevnetFundingStatusError("funding-status must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new DevnetFundingStatusError(`funding-status has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new DevnetFundingStatusError(`funding-status is missing field "${key}"`);
  }

  if (value.schemaVersion !== DEVNET_FUNDING_STATUS_SCHEMA_VERSION) {
    throw new DevnetFundingStatusError(`schemaVersion must be "${DEVNET_FUNDING_STATUS_SCHEMA_VERSION}"`);
  }
  if (value.banner !== DEVNET_FUNDING_STATUS_BANNER) {
    throw new DevnetFundingStatusError("banner must be the canonical banner");
  }
  if (value.network !== "devnet") throw new DevnetFundingStatusError('network must literally be "devnet"');

  validateDevnetPublicKey(value.publicKey);
  safeLabel(value.checkedAt, "checkedAt", 40, true);

  if (typeof value.balanceReadStatus !== "string" || !(DEVNET_BALANCE_READ_STATUSES as readonly string[]).includes(value.balanceReadStatus)) {
    throw new DevnetFundingStatusError(`balanceReadStatus must be one of: ${DEVNET_BALANCE_READ_STATUSES.join(", ")}`);
  }
  const balanceReadStatus = value.balanceReadStatus as DevnetBalanceReadStatus;
  const minimumRequiredLamports = reqIntInRange(value.minimumRequiredLamports, "minimumRequiredLamports", 1, MAX_MIN_LAMPORTS);

  // Re-derive lamports + every honesty field from the echoed balanceReadStatus.
  let expectedLamports: number | null;
  if (balanceReadStatus === "observed") {
    expectedLamports = reqIntInRange(value.lamports, "lamports", 0, Number.MAX_SAFE_INTEGER);
    if (value.balanceReadDetail !== null) throw new DevnetFundingStatusError("balanceReadDetail must be null when the balance was observed");
  } else {
    if (value.lamports !== null) throw new DevnetFundingStatusError(`lamports must be null when balanceReadStatus is ${balanceReadStatus}`);
    expectedLamports = null;
    if (typeof value.balanceReadDetail !== "string" || value.balanceReadDetail.trim().length === 0) {
      throw new DevnetFundingStatusError("balanceReadDetail must be a non-empty string when the balance was not observed");
    }
  }

  const faucetTracker = new RedactionTracker();
  const faucetAttemptSummary = normalizeFaucetAttempt(value.faucetAttemptSummary, faucetTracker);

  const expectedFunded = expectedLamports !== null && expectedLamports >= minimumRequiredLamports;
  if (value.funded !== expectedFunded) {
    throw new DevnetFundingStatusError(`funded must be ${String(expectedFunded)} (re-derived from lamports vs minimum), got ${String(value.funded)}`);
  }
  if (value.canBroadcastDevnetProbe !== expectedFunded) {
    throw new DevnetFundingStatusError(`canBroadcastDevnetProbe must be ${String(expectedFunded)} (re-derived), got ${String(value.canBroadcastDevnetProbe)}`);
  }
  const expectedSol = expectedLamports === null ? null : expectedLamports / LAMPORTS_PER_SOL;
  if (value.solBalance !== expectedSol) {
    throw new DevnetFundingStatusError("solBalance must equal lamports / 1e9 (re-derived)");
  }
  const expectedStatus = deriveDevnetFundingSourceStatus(balanceReadStatus, expectedFunded, faucetAttemptSummary?.outcome ?? null);
  if (value.fundingSourceStatus !== expectedStatus) {
    throw new DevnetFundingStatusError(`fundingSourceStatus must be ${JSON.stringify(expectedStatus)} (re-derived from the echoed facts), got ${JSON.stringify(value.fundingSourceStatus)}`);
  }

  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new DevnetFundingStatusError("nextSafeAction must be a non-empty string");
  }
  if (!Array.isArray(value.caveats) || value.caveats.length === 0) {
    throw new DevnetFundingStatusError("caveats must be a non-empty array");
  }
  for (let i = 0; i < value.caveats.length; i++) {
    const c = value.caveats[i];
    if (typeof c !== "string" || c.trim().length === 0) throw new DevnetFundingStatusError(`caveats[${i}] must be a non-empty string`);
  }
  if (typeof value.redactionApplied !== "boolean") throw new DevnetFundingStatusError("redactionApplied must be a boolean");

  if (value.neverMainnet !== true) throw new DevnetFundingStatusError("neverMainnet must literally be true");
  if (value.phase7LiveTradingReady !== false) throw new DevnetFundingStatusError("phase7LiveTradingReady must literally be false");

  return value as unknown as DevnetFundingStatusReport;
}
