/**
 * Generate an UNSIGNED self-transfer envelope (`txpreview.envelope.v1`) for `paper:simulation:tx`.
 *
 * Operator dev tool (Sprint 92). Uses the production probe builder in @soulmaker/txpreview: a
 * 1-lamport System transfer FROM a PUBLIC fee-payer address back to itself, every signature slot
 * zero. No key is loaded, generated, or required — the txpreview boundary simulates unsigned
 * messages with sigVerify:false.
 *
 * Run: pnpm tsx scripts/gen-unsigned-sim-envelope.ts <feePayerPublicKey> <devnet|mainnet-beta> <out.json>
 *
 * The fee payer must be an EXISTING, funded account on the target cluster for the simulation to
 * pass (e.g. the public devnet faucet account).
 */

import { writeFileSync, existsSync } from "node:fs";
// Relative source import: the root scripts/ folder is not a workspace package.
import { buildUnsignedSelfTransferProbe } from "../packages/txpreview/src/index.js";

const [feePayerArg, networkArg, outArg] = process.argv.slice(2);
if (!feePayerArg || !networkArg || !outArg) {
  console.error("usage: pnpm tsx scripts/gen-unsigned-sim-envelope.ts <feePayerPublicKey> <devnet|mainnet-beta> <out.json>");
  process.exit(1);
}
if (networkArg !== "devnet" && networkArg !== "mainnet-beta") {
  console.error("network must be devnet or mainnet-beta");
  process.exit(1);
}
if (existsSync(outArg)) {
  console.error(`refusing: ${outArg} already exists`);
  process.exit(1);
}

const envelope = buildUnsignedSelfTransferProbe({ feePayerPublicKey: feePayerArg, network: networkArg });
writeFileSync(outArg, JSON.stringify(envelope, null, 2) + "\n");
console.log(`wrote ${outArg} (UNSIGNED self-transfer probe for ${networkArg}; fee payer ${envelope.feePayerPublicKey})`);
console.log("next: pnpm soulmaker paper:simulation:tx --envelope <out.json> --rpc-url <cluster rpc> --allow-paper-read");
