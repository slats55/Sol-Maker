/**
 * Sprint 102 — the shipped `examples/sniper/mainnet-dryrun-release-candidate/` examples.
 *
 * Pins, with the production builder + validator:
 *   - FIXTURE FIDELITY: every committed example equals what `buildMainnetDryRunReleaseCandidate`
 *     regenerates for the invented facts (byte-for-byte) — so the examples can never drift from the
 *     real artifact shape;
 *   - every committed example is a VALID `sniper.mainnet_dryrun.release_candidate.v1`;
 *   - the no-send invariant holds in every example: liveSendStatus "disabled",
 *     phase7LiveTradingReady false, neverSends/neverSigns true, network mainnet-beta;
 *   - the complete example is dryrun-complete-blocked-live; the blocked-risk example is
 *     dryrun-blocked-risk EVEN THOUGH the candidate is scored (a score never overrides the gate);
 *   - README/code agreement.
 *
 * Everything is FICTIONAL (invented mints). Nothing here is live data or a trade signal.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateMainnetDryRunReleaseCandidate } from "@soulmaker/sniper";
import { buildMainnetDryRunRcExamples, serializeRcExample } from "../../../scripts/gen-mainnet-dryrun-rc-example.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = join(HERE, "../../../examples/sniper/mainnet-dryrun-release-candidate");

const readText = (name: string): string => readFileSync(join(EXAMPLE_DIR, name), "utf8");

describe("mainnet dry-run RC example — fixture fidelity (production builder is the source of truth)", () => {
  it("every committed example equals the builder's regeneration, byte for byte", () => {
    const regenerated = buildMainnetDryRunRcExamples();
    expect(regenerated.length).toBeGreaterThanOrEqual(2);
    for (const f of regenerated) {
      expect(readText(f.relPath), f.relPath).toBe(serializeRcExample(f.artifact));
    }
  });

  it("every committed example is a VALID release candidate with the no-send invariant", () => {
    for (const f of buildMainnetDryRunRcExamples()) {
      const parsed = JSON.parse(readText(f.relPath)) as unknown;
      const rc = validateMainnetDryRunReleaseCandidate(parsed);
      expect(rc.liveSendStatus).toBe("disabled");
      expect(rc.network).toBe("mainnet-beta");
      expect(rc.mode).toBe("mainnet-dry-run");
      expect(rc.phase7LiveTradingReady).toBe(false);
      expect(rc.neverSends).toBe(true);
      expect(rc.neverSigns).toBe(true);
    }
  });

  it("the complete example is dryrun-complete-blocked-live (best case; live still disabled)", () => {
    const rc = validateMainnetDryRunReleaseCandidate(JSON.parse(readText("release-candidate.complete.example.json")));
    expect(rc.verdict).toBe("dryrun-complete-blocked-live");
    expect(rc.scoring.available).toBe(true);
  });

  it("the blocked-risk example is dryrun-blocked-risk even though the candidate is scored", () => {
    const rc = validateMainnetDryRunReleaseCandidate(JSON.parse(readText("release-candidate.blocked-risk.example.json")));
    expect(rc.verdict).toBe("dryrun-blocked-risk");
    expect(rc.risk.rejected).toBe(true);
    // The candidate carries a non-trivial score, proving a score can never override the risk gate.
    expect(rc.scoring.rankedCandidates[0]?.score).toBeGreaterThan(0);
  });
});

describe("mainnet dry-run RC example — README/code agreement", () => {
  it("the README names the command, both example files, the verdicts, and the generator", () => {
    const readme = readText("README.md");
    for (const needle of [
      "paper:sniper:rehearse --mode mainnet-dry-run",
      "release-candidate.complete.example.json",
      "release-candidate.blocked-risk.example.json",
      "dryrun-complete-blocked-live",
      "dryrun-blocked-risk",
      "liveSendStatus",
      "disabled",
      "web:inspect",
      "scripts/gen-mainnet-dryrun-rc-example.ts",
    ]) {
      expect(readme, `README must mention ${needle}`).toContain(needle);
    }
  });
});
