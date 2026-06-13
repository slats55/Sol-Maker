/**
 * Strict validator for `engine.realtime.observations.report.v1` — the replay
 * normalization artifact the Rust sidecar emits (Sprint 98). TypeScript is the
 * validation AUTHORITY and never repairs Rust output: the key sets are CLOSED
 * (report AND every observation), every mint is re-parsed with the real
 * `parseMintAddress`, every label is re-checked with the real `redactString`,
 * and the caveat strings are pinned byte for byte. One problem refuses the
 * whole artifact.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "@soulmaker/sniper";
import {
  CANDIDATE_OBSERVATION_CAVEATS,
  REPLAY_CAVEAT,
  REPLAY_PROVIDER_ID,
  candidateIdForMint,
  type CandidateObservation,
} from "@soulmaker/realtime";
import { ENGINE_IPC_VERSION } from "./validate.js";

export const ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION = "engine.realtime.observations.report.v1";

/** Mirrors MAX_REPLAY_EVENTS in packages/realtime and the Rust crate. */
export const ENGINE_REALTIME_MAX_EVENTS = 500;

export interface EngineRealtimeObservationsReportV1 {
  readonly schemaVersion: typeof ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION;
  readonly banner: string;
  readonly engineName: "solmaker-engine";
  readonly engineVersion: string;
  readonly ipcVersion: typeof ENGINE_IPC_VERSION;
  readonly providerId: typeof REPLAY_PROVIDER_ID;
  readonly sourceKind: "replay";
  readonly endpointHost: "local-replay-file";
  readonly fetchedAt: "replay";
  readonly status: "observed";
  readonly statusDetail: null;
  readonly eventCount: number;
  readonly observationCount: number;
  readonly duplicateMintCount: number;
  readonly observations: readonly CandidateObservation[];
  readonly createdAt: string | null;
  readonly caveats: readonly string[];
  readonly neverSends: true;
  readonly phase7LiveTradingReady: false;
}

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "engineName",
  "engineVersion",
  "ipcVersion",
  "providerId",
  "sourceKind",
  "endpointHost",
  "fetchedAt",
  "status",
  "statusDetail",
  "eventCount",
  "observationCount",
  "duplicateMintCount",
  "observations",
  "createdAt",
  "caveats",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const EXPECTED_OBSERVATION_KEYS = [
  "candidateId",
  "mint",
  "symbol",
  "name",
  "sourceProviderId",
  "sourceKind",
  "observedAtLabel",
  "launchpadLabel",
  "liquidityUsdHint",
  "marketCapUsdHint",
  "holderCountHint",
  "caveats",
] as const;

/** The caveat list every replay observation must carry, byte for byte. */
const EXPECTED_OBSERVATION_CAVEATS = [...CANDIDATE_OBSERVATION_CAVEATS, REPLAY_CAVEAT];

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

export type EngineRealtimeValidation =
  | { readonly ok: true; readonly report: EngineRealtimeObservationsReportV1 }
  | { readonly ok: false; readonly problems: readonly string[] };

function checkLabel(
  value: unknown,
  field: string,
  max: number,
  problems: string[],
  nullable: boolean,
): void {
  if (value === null) {
    if (!nullable) problems.push(`${field} must be a string`);
    return;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    problems.push(`${field} must be ${nullable ? "null or " : ""}a non-empty string (max ${max} chars)`);
    return;
  }
  if (value.trim() !== value) {
    problems.push(`${field} must be trimmed`);
  }
  if (redactString(value) !== value) {
    problems.push(`${field} carries a secret-shaped span — the artifact is refused, never repaired`);
  }
}

function checkHint(value: unknown, field: string, problems: string[]): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    problems.push(`${field} must be null or a finite number >= 0`);
  }
}

function validateObservation(value: unknown, index: number, problems: string[]): void {
  const at = `observations[${index}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push(`${at} is not a JSON object`);
    return;
  }
  const obs = value as Record<string, unknown>;
  for (const key of Object.keys(obs)) {
    if (!(EXPECTED_OBSERVATION_KEYS as readonly string[]).includes(key)) {
      problems.push(`${at} has unknown field ${JSON.stringify(key)} (the observation schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_OBSERVATION_KEYS) {
    if (!(key in obs)) problems.push(`${at} is missing field ${JSON.stringify(key)}`);
  }

  let mint: string | null = null;
  try {
    mint = parseMintAddress(obs.mint);
  } catch (err) {
    problems.push(`${at}.mint: ${(err as Error).message}`);
  }
  if (mint !== null && obs.mint !== mint) {
    problems.push(`${at}.mint must be the trimmed base58 mint, verbatim`);
  }
  if (mint !== null && obs.candidateId !== candidateIdForMint(mint)) {
    problems.push(`${at}.candidateId must derive from the mint (expected ${JSON.stringify(candidateIdForMint(mint))})`);
  }
  checkLabel(obs.symbol, `${at}.symbol`, 16, problems, true);
  checkLabel(obs.name, `${at}.name`, 64, problems, true);
  checkLabel(obs.observedAtLabel, `${at}.observedAtLabel`, 64, problems, false);
  checkLabel(obs.launchpadLabel, `${at}.launchpadLabel`, 32, problems, true);
  if (obs.sourceProviderId !== REPLAY_PROVIDER_ID) {
    problems.push(`${at}.sourceProviderId must be ${JSON.stringify(REPLAY_PROVIDER_ID)}`);
  }
  if (obs.sourceKind !== "replay") {
    problems.push(`${at}.sourceKind must literally be "replay" — replay data never looks live`);
  }
  checkHint(obs.liquidityUsdHint, `${at}.liquidityUsdHint`, problems);
  checkHint(obs.marketCapUsdHint, `${at}.marketCapUsdHint`, problems);
  checkHint(obs.holderCountHint, `${at}.holderCountHint`, problems);
  const caveats = obs.caveats;
  const caveatsMatch =
    Array.isArray(caveats) &&
    caveats.length === EXPECTED_OBSERVATION_CAVEATS.length &&
    caveats.every((c, i) => c === EXPECTED_OBSERVATION_CAVEATS[i]);
  if (!caveatsMatch) {
    problems.push(`${at}.caveats must carry the replay observation caveats verbatim`);
  }
}

/** Validate an unknown parsed value as `engine.realtime.observations.report.v1`, strictly. */
export function validateEngineRealtimeObservationsReportV1(value: unknown): EngineRealtimeValidation {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problems: ["artifact is not a JSON object"] };
  }
  const obj = value as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      problems.push(`unknown field ${JSON.stringify(key)} (the schema is CLOSED — update both sides together)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in obj)) problems.push(`missing field ${JSON.stringify(key)}`);
  }

  if (obj.schemaVersion !== ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${JSON.stringify(ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION)}`);
  }
  if (typeof obj.banner !== "string" || obj.banner.length === 0 || obj.banner.length > 500) {
    problems.push("banner must be a non-empty string (max 500 chars)");
  }
  if (obj.engineName !== "solmaker-engine") {
    problems.push('engineName must be "solmaker-engine"');
  }
  if (typeof obj.engineVersion !== "string" || !VERSION_SHAPE.test(obj.engineVersion)) {
    problems.push("engineVersion must be a semver-shaped string");
  }
  if (obj.ipcVersion !== ENGINE_IPC_VERSION) {
    problems.push(`ipcVersion must be ${JSON.stringify(ENGINE_IPC_VERSION)}`);
  }
  if (obj.providerId !== REPLAY_PROVIDER_ID) {
    problems.push(`providerId must be ${JSON.stringify(REPLAY_PROVIDER_ID)}`);
  }
  if (obj.sourceKind !== "replay") {
    problems.push('sourceKind must literally be "replay"');
  }
  if (obj.endpointHost !== "local-replay-file") {
    problems.push('endpointHost must be "local-replay-file"');
  }
  if (obj.fetchedAt !== "replay") {
    problems.push('fetchedAt must be "replay" — replay output never claims a poll time');
  }
  if (obj.status !== "observed") {
    problems.push('status must be "observed" (a malformed replay file is refused by the engine, never reported)');
  }
  if (obj.statusDetail !== null) {
    problems.push("statusDetail must be null");
  }

  const counts: Record<string, number> = {};
  for (const field of ["eventCount", "observationCount", "duplicateMintCount"] as const) {
    const n = obj[field];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      problems.push(`${field} must be a non-negative integer`);
    } else {
      counts[field] = n;
    }
  }
  if (counts.eventCount !== undefined && counts.eventCount > ENGINE_REALTIME_MAX_EVENTS) {
    problems.push(`eventCount exceeds the ${ENGINE_REALTIME_MAX_EVENTS}-event ceiling`);
  }

  if (!Array.isArray(obj.observations)) {
    problems.push("observations must be an array");
  } else {
    if (counts.observationCount !== undefined && obj.observations.length !== counts.observationCount) {
      problems.push("observationCount must equal observations.length");
    }
    if (
      counts.eventCount !== undefined &&
      counts.observationCount !== undefined &&
      counts.duplicateMintCount !== undefined &&
      counts.observationCount + counts.duplicateMintCount !== counts.eventCount
    ) {
      problems.push("observationCount + duplicateMintCount must equal eventCount");
    }
    const mints = new Set<string>();
    for (const [index, item] of obj.observations.entries()) {
      validateObservation(item, index, problems);
      const mint = (item as Record<string, unknown> | null)?.mint;
      if (typeof mint === "string") {
        if (mints.has(mint)) problems.push(`observations[${index}] repeats mint already present — duplicates must be skipped`);
        mints.add(mint);
      }
    }
  }

  if (obj.createdAt !== null && (typeof obj.createdAt !== "string" || obj.createdAt.length > 40 || !ISO_SHAPE.test(obj.createdAt))) {
    problems.push("createdAt must be null or an ISO-8601-shaped UTC string");
  }
  if (
    !Array.isArray(obj.caveats) ||
    obj.caveats.length === 0 ||
    obj.caveats.some((c) => typeof c !== "string" || c.length === 0 || c.length > 500)
  ) {
    problems.push("caveats must be a non-empty array of non-empty strings (max 500 chars each)");
  }
  if (obj.neverSends !== true) {
    problems.push("neverSends must literally be true");
  }
  if (obj.phase7LiveTradingReady !== false) {
    problems.push("phase7LiveTradingReady must literally be false");
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, report: obj as unknown as EngineRealtimeObservationsReportV1 };
}
