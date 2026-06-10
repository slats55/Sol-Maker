/**
 * Sprint 79 — the dry-run boundary DESIGN DOC stays pinned to reality.
 *
 * `docs/PHASE6_DRY_RUN_BOUNDARY.md` is design-only: it must keep saying so, must keep refusing to
 * authorize implementation/Phase 7, and the code facts it cites must stay true (the package
 * default adapter is the honest UNAVAILABLE one; the adapter request stays label-only). If the
 * doc or the seam drifts, this test makes it loud.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UNAVAILABLE_DRY_RUN_ADAPTER } from "./adapter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(HERE, "../../../docs/PHASE6_DRY_RUN_BOUNDARY.md");

describe("dry-run boundary design doc", () => {
  const doc = readFileSync(DOC_PATH, "utf8");

  it("declares itself design-only and authorizes nothing", () => {
    expect(doc).toContain("DESIGN ONLY");
    expect(doc).toContain("No implementation is authorized by this document.");
    expect(doc).toContain("It does not authorize Phase 7");
  });

  it("keeps the hard exclusions written down by name", () => {
    for (const phrase of [
      "What must NEVER enter the boundary",
      "seed phrases",
      "main-wallet",
      "bypass/override flag",
      "no live RPC in CI, ever",
    ]) {
      expect(doc, phrase).toContain(phrase);
    }
  });

  it("its code citations stay true: the package default adapter is the honest UNAVAILABLE one", () => {
    expect(doc).toContain("UNAVAILABLE_DRY_RUN_ADAPTER");
    expect(UNAVAILABLE_DRY_RUN_ADAPTER.adapterId).toBe("unavailable-safe-boundary");
    expect(UNAVAILABLE_DRY_RUN_ADAPTER.neverSigns).toBe(true);
    expect(UNAVAILABLE_DRY_RUN_ADAPTER.neverSends).toBe(true);
    const outcome = UNAVAILABLE_DRY_RUN_ADAPTER.attemptDryRun({
      candidateId: "fictional",
      mint: "fictional-mint",
      intendedActionPreview: "simulated-entry-preview",
      destinationLabel: null,
      amountLabel: null,
      feeLabel: null,
    });
    expect(outcome.kind).toBe("unavailable");
  });

  it("records the S79 decision (design only; no production code change)", () => {
    expect(doc).toContain("Decision (S79)");
    expect(doc).toContain("design only. The existing adapter contract is already the correct seam");
  });
});
