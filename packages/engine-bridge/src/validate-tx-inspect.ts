/**
 * Strict validator for `engine.tx.inspect.report.v1` — the transaction SHAPE
 * artifact the Rust sidecar emits (Sprint 100). TypeScript is the validation
 * AUTHORITY and never repairs Rust output: the key sets are CLOSED (report +
 * shape), the safety literals are pinned, AND — the heart of this validator —
 * the SHAPE facts are RE-DERIVED from the same envelope with the real
 * `@solana/web3.js` decoder (`validateUnsignedTxEnvelope` +
 * `inspectUnsignedTransactionShape`). The hand-written Rust parser is trusted
 * only when it AGREES with the battle-tested TypeScript decoder, field for
 * field; any disagreement refuses the whole artifact.
 */

import { deserializeUnsignedTransaction, validateUnsignedTxEnvelope, TxPreviewError } from "@soulmaker/txpreview";
import { inspectUnsignedTransactionShape, type TxShapeFacts } from "@soulmaker/txbuilder";
import { ENGINE_IPC_VERSION } from "./validate.js";

export const ENGINE_TX_INSPECT_SCHEMA_VERSION = "engine.tx.inspect.report.v1";

export interface EngineTxInspectShape {
  readonly version: string | number;
  readonly versionSupported: boolean;
  readonly blockhashPresent: boolean;
  readonly instructionCount: number;
  readonly accountKeyCount: number;
  readonly staticProgramIds: readonly string[];
  readonly addressTableLookupCount: number;
  readonly unresolvableProgramIdCount: number;
}

export interface EngineTxInspectReportV1 {
  readonly schemaVersion: typeof ENGINE_TX_INSPECT_SCHEMA_VERSION;
  readonly banner: string;
  readonly engineName: "solmaker-engine";
  readonly engineVersion: string;
  readonly ipcVersion: typeof ENGINE_IPC_VERSION;
  readonly network: "devnet" | "mainnet-beta";
  readonly feePayerPublicKey: string;
  readonly builderId: string;
  readonly candidateMint: string | null;
  readonly shape: EngineTxInspectShape;
  readonly unsigned: true;
  readonly createdAt: string | null;
  readonly caveats: readonly string[];
  readonly notExecutable: true;
  readonly neverSigns: true;
  readonly neverSends: true;
  readonly phase7LiveTradingReady: false;
}

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "engineName",
  "engineVersion",
  "ipcVersion",
  "network",
  "feePayerPublicKey",
  "builderId",
  "candidateMint",
  "shape",
  "unsigned",
  "createdAt",
  "caveats",
  "notExecutable",
  "neverSigns",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const EXPECTED_SHAPE_KEYS = [
  "version",
  "versionSupported",
  "blockhashPresent",
  "instructionCount",
  "accountKeyCount",
  "staticProgramIds",
  "addressTableLookupCount",
  "unresolvableProgramIdCount",
] as const;

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

export type EngineTxInspectValidation =
  | { readonly ok: true; readonly report: EngineTxInspectReportV1 }
  | { readonly ok: false; readonly problems: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkClosedKeys(value: Record<string, unknown>, allowed: readonly string[], where: string, problems: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) problems.push(`${where} has unknown field ${JSON.stringify(key)} (the schema is CLOSED)`);
  }
  for (const key of allowed) {
    if (!(key in value)) problems.push(`${where} is missing field ${JSON.stringify(key)}`);
  }
}

/** Compute the expected shape facts (the parity baseline) for an envelope, or a problem string. */
function expectedShapeFor(envelopeValue: unknown): { facts: TxShapeFacts; accountKeyCount: number } | { problem: string } {
  try {
    const envelope = validateUnsignedTxEnvelope(envelopeValue);
    const tx = deserializeUnsignedTransaction(envelope);
    return { facts: inspectUnsignedTransactionShape(envelope), accountKeyCount: tx.message.staticAccountKeys.length };
  } catch (err) {
    const detail = err instanceof TxPreviewError ? err.message : "envelope validation failed";
    return { problem: detail };
  }
}

/**
 * Validate a parsed `engine.tx.inspect.report.v1` strictly. When `envelope` is
 * supplied, the PARITY WALL runs: the shape facts must equal what the real
 * TypeScript decoder derives from that envelope, or the artifact is refused.
 */
export function validateEngineTxInspectReportV1(value: unknown, envelope?: unknown): EngineTxInspectValidation {
  const problems: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, problems: ["artifact is not a JSON object"] };
  }
  checkClosedKeys(value, EXPECTED_KEYS, "artifact", problems);

  if (value.schemaVersion !== ENGINE_TX_INSPECT_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${JSON.stringify(ENGINE_TX_INSPECT_SCHEMA_VERSION)}`);
  }
  if (typeof value.banner !== "string" || value.banner.length === 0 || value.banner.length > 500) {
    problems.push("banner must be a non-empty string (max 500 chars)");
  }
  if (value.engineName !== "solmaker-engine") problems.push('engineName must be "solmaker-engine"');
  if (typeof value.engineVersion !== "string" || !VERSION_SHAPE.test(value.engineVersion)) {
    problems.push("engineVersion must be a semver-shaped string");
  }
  if (value.ipcVersion !== ENGINE_IPC_VERSION) problems.push(`ipcVersion must be ${JSON.stringify(ENGINE_IPC_VERSION)}`);
  if (value.network !== "devnet" && value.network !== "mainnet-beta") {
    problems.push('network must be "devnet" or "mainnet-beta"');
  }
  if (typeof value.feePayerPublicKey !== "string" || value.feePayerPublicKey.length === 0 || value.feePayerPublicKey.length > 44) {
    problems.push("feePayerPublicKey must be a bounded public-key string");
  }
  if (typeof value.builderId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.builderId)) {
    problems.push("builderId must be a kebab-case label");
  }
  if (value.candidateMint !== null && (typeof value.candidateMint !== "string" || value.candidateMint.length > 44)) {
    problems.push("candidateMint must be null or a bounded public-key string");
  }
  if (value.unsigned !== true) problems.push("unsigned must literally be true");
  if (value.createdAt !== null && (typeof value.createdAt !== "string" || value.createdAt.length > 40 || !ISO_SHAPE.test(value.createdAt))) {
    problems.push("createdAt must be null or an ISO-8601-shaped UTC string");
  }
  if (!Array.isArray(value.caveats) || value.caveats.length === 0 || value.caveats.some((c) => typeof c !== "string" || c.length === 0 || c.length > 500)) {
    problems.push("caveats must be a non-empty array of non-empty strings (max 500 chars each)");
  }
  for (const [field, expected] of [
    ["notExecutable", true],
    ["neverSigns", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) problems.push(`${field} must literally be ${String(expected)}`);
  }

  const shape = value.shape;
  if (!isRecord(shape)) {
    problems.push("shape must be an object");
  } else {
    checkClosedKeys(shape, EXPECTED_SHAPE_KEYS, "shape", problems);
    if (shape.version !== "legacy" && !(typeof shape.version === "number" && Number.isInteger(shape.version) && shape.version >= 0)) {
      problems.push('shape.version must be "legacy" or a non-negative integer');
    }
    if (typeof shape.versionSupported !== "boolean") problems.push("shape.versionSupported must be a boolean");
    if (typeof shape.blockhashPresent !== "boolean") problems.push("shape.blockhashPresent must be a boolean");
    for (const field of ["instructionCount", "accountKeyCount", "addressTableLookupCount", "unresolvableProgramIdCount"] as const) {
      if (typeof shape[field] !== "number" || !Number.isInteger(shape[field]) || (shape[field] as number) < 0) {
        problems.push(`shape.${field} must be a non-negative integer`);
      }
    }
    if (!Array.isArray(shape.staticProgramIds) || shape.staticProgramIds.some((p) => typeof p !== "string" || p.length === 0 || p.length > 44)) {
      problems.push("shape.staticProgramIds must be an array of bounded base58 strings");
    } else {
      const sorted = [...shape.staticProgramIds].sort();
      if (shape.staticProgramIds.some((p, i) => p !== sorted[i])) problems.push("shape.staticProgramIds must be sorted");
      if (new Set(shape.staticProgramIds).size !== shape.staticProgramIds.length) problems.push("shape.staticProgramIds must be deduplicated");
    }
  }

  // The PARITY WALL: re-derive the shape facts with the real @solana/web3.js
  // decoder and require the Rust report to match field for field.
  if (envelope !== undefined && isRecord(shape)) {
    const expected = expectedShapeFor(envelope);
    if ("problem" in expected) {
      problems.push(`envelope failed the TypeScript decoder, so the Rust report cannot be trusted: ${expected.problem}`);
    } else {
      const { facts, accountKeyCount } = expected;
      const mismatches: string[] = [];
      if (shape.version !== facts.version) mismatches.push(`version (rust ${JSON.stringify(shape.version)} vs ts ${JSON.stringify(facts.version)})`);
      if (shape.versionSupported !== facts.versionSupported) mismatches.push("versionSupported");
      if (shape.blockhashPresent !== facts.blockhashPresent) mismatches.push("blockhashPresent");
      if (shape.instructionCount !== facts.instructionCount) mismatches.push("instructionCount");
      if (shape.accountKeyCount !== accountKeyCount) mismatches.push("accountKeyCount");
      if (shape.addressTableLookupCount !== facts.addressTableLookupCount) mismatches.push("addressTableLookupCount");
      if (shape.unresolvableProgramIdCount !== facts.unresolvableProgramIdCount) mismatches.push("unresolvableProgramIdCount");
      const rustIds = Array.isArray(shape.staticProgramIds) ? shape.staticProgramIds.join(",") : "";
      if (rustIds !== [...facts.staticProgramIds].join(",")) mismatches.push("staticProgramIds");
      if (mismatches.length > 0) {
        problems.push(`shape facts disagree with the real TypeScript transaction decoder: ${mismatches.join(", ")} — the artifact is refused, never repaired`);
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, report: value as unknown as EngineTxInspectReportV1 };
}
