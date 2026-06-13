/**
 * Sprint 103 — pin the committed Phase 7 authorization-audit examples to production code.
 *
 * The examples in `examples/phase7/authorization-audit/` are produced through the real builder with
 * a fixed clock. This test re-generates them and fails if the committed bytes drift, and re-validates
 * each committed file through the production validator. It also pins the example DIRECTORY as
 * key-free (a security example must never carry secret-shaped content).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePhase7AuthorizationAudit } from "@soulmaker/execution";
import {
  buildPhase7AuthorizationAuditExamples,
  serializePhase7AuditExample,
} from "../../../scripts/gen-phase7-authorization-audit-example.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = join(HERE, "../../../examples/phase7/authorization-audit");

describe("phase7 authorization-audit examples — pinned to production code", () => {
  it("the committed example files match the builder byte-for-byte and validate", () => {
    const regenerated = buildPhase7AuthorizationAuditExamples();
    expect(regenerated.length).toBe(2);
    for (const { fileName, audit } of regenerated) {
      const onDisk = readFileSync(join(EXAMPLE_DIR, fileName), "utf8");
      expect(onDisk, fileName).toBe(serializePhase7AuditExample(audit));
      const parsed = validatePhase7AuthorizationAudit(JSON.parse(onDisk));
      expect(parsed.liveExecutionAuthorized).toBe(false);
      expect(parsed.neverSends).toBe(true);
      expect(parsed.phase7LiveTradingReady).toBe(false);
    }
  });

  it("the design-only example is the honest current state; the not-authorized example is fail-closed", () => {
    const byName = new Map(buildPhase7AuthorizationAuditExamples().map((e) => [e.fileName, e.audit]));
    expect(byName.get("authorization-audit.design-only.example.json")?.verdict).toBe("authorized-for-design-only");
    expect(byName.get("authorization-audit.not-authorized.example.json")?.verdict).toBe("not-authorized");
  });

  it("the example directory carries no key / secret / wallet file", () => {
    for (const name of readdirSync(EXAMPLE_DIR)) {
      expect(name, name).not.toMatch(/keypair|\.key$|secret|wallet|seed|mnemonic/i);
    }
  });
});
