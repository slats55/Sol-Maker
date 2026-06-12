/**
 * Post-build transaction inspection (Sprint 95).
 *
 * A provider response that validated as a strictly UNSIGNED envelope still gets its decoded
 * transaction SHAPE checked before anyone simulates it: the version must be one we support, a
 * recent blockhash must be present (the simulator replaces it, but a blockhash-less transaction
 * is not a real provider build), and — when the operator supplies a program allowlist — every
 * invoked program must be verifiable against it. Program ids that ride an address-lookup table
 * cannot be resolved offline, so under an allowlist they refuse HONESTLY instead of passing
 * unverified. No allowlist supplied = no program check (the default, unchanged behavior).
 *
 * Pure inspection: nothing here signs, sends, or talks to a network.
 */

import { VersionedTransaction } from "@solana/web3.js";
import { deserializeUnsignedTransaction, type UnsignedTxEnvelope } from "@soulmaker/txpreview";
import type { BuildRefusal } from "./refusals.js";

/** base58 of 32 zero bytes — the placeholder blockhash of a message that never got one. */
const ZERO_BLOCKHASH = "11111111111111111111111111111111";

/** Transaction versions the dry-run pipeline understands. */
export const SUPPORTED_TX_VERSIONS = ["legacy", 0] as const;

/** Decoded SHAPE facts of one unsigned transaction — public data only, bounded. */
export interface TxShapeFacts {
  /** "legacy" | 0 (the only versions that exist today; anything else is unsupported). */
  version: string | number;
  versionSupported: boolean;
  /** True when the message carries a real (non-zero) recent blockhash. */
  blockhashPresent: boolean;
  instructionCount: number;
  /** Program ids resolvable from the STATIC account keys (deduped, base58). */
  staticProgramIds: string[];
  /** Address-lookup-table count — programs loaded through these cannot be verified offline. */
  addressTableLookupCount: number;
  /** Instructions whose program id index points OUTSIDE the static keys (ALT-loaded). */
  unresolvableProgramIdCount: number;
}

/** Inspect a strictly-validated unsigned envelope's transaction shape. Throws only on a broken envelope. */
export function inspectUnsignedTransactionShape(envelope: UnsignedTxEnvelope): TxShapeFacts {
  const tx: VersionedTransaction = deserializeUnsignedTransaction(envelope);
  const message = tx.message;
  const version = tx.version;
  const staticKeys = message.staticAccountKeys;
  const staticProgramIds = new Set<string>();
  let unresolvable = 0;
  for (const instruction of message.compiledInstructions) {
    const key = staticKeys[instruction.programIdIndex];
    if (key === undefined) {
      unresolvable += 1;
    } else {
      staticProgramIds.add(key.toBase58());
    }
  }
  return {
    version,
    versionSupported: (SUPPORTED_TX_VERSIONS as readonly (string | number)[]).includes(version),
    blockhashPresent: typeof message.recentBlockhash === "string" && message.recentBlockhash.length > 0 && message.recentBlockhash !== ZERO_BLOCKHASH,
    instructionCount: message.compiledInstructions.length,
    staticProgramIds: [...staticProgramIds].sort(),
    addressTableLookupCount: message.addressTableLookups?.length ?? 0,
    unresolvableProgramIdCount: unresolvable,
  };
}

/**
 * Evaluate the post-build refusals over decoded shape facts. Pure; returns ALL violations.
 * `allowedPrograms` null/undefined disables the program check entirely.
 */
export function evaluateTxShapeRefusals(facts: TxShapeFacts, allowedPrograms?: string[] | null): BuildRefusal[] {
  const refusals: BuildRefusal[] = [];
  if (!facts.versionSupported) {
    refusals.push({
      code: "build-refused-unsupported-transaction",
      detail: `the built transaction's version "${String(facts.version)}" is not supported (supported: ${SUPPORTED_TX_VERSIONS.join(", ")})`,
    });
  }
  if (!facts.blockhashPresent) {
    refusals.push({
      code: "build-refused-unsupported-transaction",
      detail: "the built transaction carries no recent blockhash — not a real provider build",
    });
  }
  if (allowedPrograms !== undefined && allowedPrograms !== null) {
    const allowed = new Set(allowedPrograms.map((p) => p.trim()));
    const offList = facts.staticProgramIds.filter((id) => !allowed.has(id));
    if (offList.length > 0) {
      refusals.push({
        code: "build-refused-unsupported-instruction",
        detail: `the transaction invokes program(s) NOT on the operator allowlist: ${offList.slice(0, 8).join(", ")}${offList.length > 8 ? ` (+${offList.length - 8} more)` : ""}`,
      });
    }
    if (facts.unresolvableProgramIdCount > 0) {
      refusals.push({
        code: "build-refused-unsupported-instruction",
        detail: `${facts.unresolvableProgramIdCount} instruction(s) load their program id through an address-lookup table — unverifiable offline, refused while an allowlist is in force`,
      });
    }
  }
  return refusals;
}
