/**
 * Sprint 103 — regenerate the redacted examples in `examples/phase7/authorization-audit/`.
 *
 * Each example Phase 7 authorization audit is produced THROUGH PRODUCTION CODE
 * (`buildPhase7AuthorizationAudit`) with a fixed clock and declared evidence references, so the
 * committed files are byte-deterministic and always match what the builder would emit for these
 * facts. The pin test (`apps/cli/src/phase7-authorization-audit-example.test.ts`) imports
 * {@link buildPhase7AuthorizationAuditExamples} and fails loudly if the committed files drift.
 *
 * Run: `pnpm tsx scripts/gen-phase7-authorization-audit-example.ts`
 *
 * These examples authorize NOTHING and send NOTHING. They exist to show an operator what a Phase 7
 * authorization audit looks like — the fail-closed `not-authorized` default and the best-case
 * `authorized-for-design-only` state this repo is actually in.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Relative source import: scripts/ is not a workspace package, so @soulmaker/* does not resolve.
import {
  buildPhase7AuthorizationAudit,
  validatePhase7AuthorizationAudit,
  canonicalLiveGateIds,
  type BuildPhase7AuthorizationAuditInput,
  type Phase7AuthorizationAudit,
  type Phase7AuditInvariant,
} from "../packages/execution/src/phase7-authorization-audit.js";

const FIXED_NOW = "2026-06-13T00:00:00.000Z";

function inv(status: Phase7AuditInvariant["status"], evidence: string, detail: string): Phase7AuditInvariant {
  return { status, evidence, detail };
}

/** Every gate verified, statused from the real canonical fourteen. */
function verifiedGates() {
  return canonicalLiveGateIds().map((gateId) => ({
    gateId,
    name: `live-gate condition: ${gateId}`,
    defaultState: "blocked",
    evidenceSource: "packages/execution/src/live-gate.ts",
    failClosedProven: true,
    testCoverageRef: "apps/cli/src/command-surface-audit.test.ts",
    status: "verified" as const,
    blocker: null,
  }));
}

/** The repo's HONEST current state: safety verified; the micro-trade prerequisites are still open. */
function designOnlyInput(): BuildPhase7AuthorizationAuditInput {
  return {
    auditId: "example-design-only",
    repoSha: "e607238",
    auditedAt: FIXED_NOW,
    gates: verifiedGates(),
    noSendInvariant: inv("verified", "apps/cli/src/command-surface-audit.test.ts", "no CLI path requests mainnet-live; the resolver is fail-closed (unknown -> paper, mainnet-live -> blocked)"),
    signerBoundary: inv("verified", "packages/execution/src/signer.ts", "a mainnet signer refuses to load without an armed fourteen-condition gate (no key file is read)"),
    rustBoundary: inv("verified", "crates/solmaker-engine/tests/safety_scan.rs", "the Rust dependency allowlist holds (serde, serde_json) and the engine carries no signer/send/network capability"),
    artifactRedaction: inv("verified", "packages/security/src/redact.ts", "the redactor strips secret-shaped values: long base58/hex key blobs, query-param tokens, and mnemonic phrases"),
    releaseCandidate: inv("verified", "apps/cli/src/release-candidate-safety.test.ts", "the mainnet dry-run release candidate pins liveSendStatus = disabled (no input can flip it)"),
    reconciliationWall: inv("verified", "packages/execution/src/session.ts", "an unreconciled / pending-confirmation / unknown session blocks a new execution attempt (no bypass)"),
    commandSurface: { status: "safe", evidence: "apps/cli/src/command-surface-audit.test.ts", detail: "no mainnet-send command, no live/arm/bypass flag; only send command is execution:devnet:send (devnet)" },
    microTradePrerequisites: [
      { id: "devnet-broadcast-confirmed", description: "a real devnet end-to-end broadcast has confirmed and reconciled at least once", met: false, detail: "not yet confirmed (devnet faucet/funding blocked) — run execution:devnet:rehearse once funded" },
      { id: "written-sign-off", description: "a written, human Phase 7 sign-off is recorded in the authorization dossier", met: false, detail: "no written human sign-off yet — see docs/PHASE7_AUTHORIZATION_DOSSIER.md" },
    ],
  };
}

/** A fail-closed example: one safety invariant is unverified, so the verdict is not-authorized. */
function notAuthorizedInput(): BuildPhase7AuthorizationAuditInput {
  const base = designOnlyInput();
  return {
    ...base,
    auditId: "example-not-authorized",
    reconciliationWall: inv("unverified", "packages/execution/src/session.ts", "the reconciliation wall has not been re-proven this run"),
  };
}

export interface Phase7AuditExample {
  fileName: string;
  audit: Phase7AuthorizationAudit;
}

/** The canonical on-disk serialization (used by both the writer and the pin test). */
export function serializePhase7AuditExample(audit: Phase7AuthorizationAudit): string {
  return JSON.stringify(audit, null, 2) + "\n";
}

/** Build the committed example artifacts (validated through the production validator). */
export function buildPhase7AuthorizationAuditExamples(): Phase7AuditExample[] {
  const examples: Array<[string, BuildPhase7AuthorizationAuditInput]> = [
    ["authorization-audit.design-only.example.json", designOnlyInput()],
    ["authorization-audit.not-authorized.example.json", notAuthorizedInput()],
  ];
  return examples.map(([fileName, input]) => {
    const audit = buildPhase7AuthorizationAudit(input);
    validatePhase7AuthorizationAudit(audit); // never ship an invalid example
    return { fileName, audit };
  });
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "examples", "phase7", "authorization-audit");
  for (const { fileName, audit } of buildPhase7AuthorizationAuditExamples()) {
    const path = join(outDir, fileName);
    writeFileSync(path, serializePhase7AuditExample(audit));
    console.log(`wrote ${path} (verdict: ${audit.verdict})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
