/**
 * Sprint 107 — the shipped `examples/sniper/alpha-artifacts/` REDACTED EXAMPLES.
 *
 * Pins, with the production validators:
 *
 *   - FIXTURE FIDELITY: every committed artifact is byte-faithful to what the production builders
 *     produce for the invented facts — regenerated via `scripts/gen-alpha-artifact-examples.ts` and
 *     compared (so the committed files can never silently drift);
 *   - SCHEMA VALIDITY: every committed artifact re-validates against its production validator;
 *   - NO-SEND SAFETY: every artifact pins live-disabled / never-sends, carries no signature / txid /
 *     sendResult / key-shaped field, and carries no secret-shaped value.
 *
 * Everything is an INJECTED FIXTURE (well-known public mints as deterministic placeholders, evidence
 * provenance honestly `fixture`). Nothing here is live data, a trade signal, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateSniperAlphaHistory,
  validateSniperAlphaHistoryDiff,
  validateSniperAlphaHistoryTrend,
  validateSniperStrategyIntelligence,
} from "@soulmaker/sniper";
import { redactString } from "@soulmaker/security";
import { buildAlphaArtifactExamples } from "../../../scripts/gen-alpha-artifact-examples.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(HERE, "../../../examples/sniper/alpha-artifacts");

const readRaw = (name: string): string => readFileSync(join(ARTIFACTS_DIR, name), "utf8");
const readJson = (name: string): unknown => JSON.parse(readRaw(name));

const FILES = [
  "alpha-history-mon.example.json",
  "alpha-history-tue.example.json",
  "alpha-history-diff.example.json",
  "alpha-history-trend.example.json",
  "strategy-intelligence.example.json",
] as const;

const VALIDATORS: Record<(typeof FILES)[number], (v: unknown) => unknown> = {
  "alpha-history-mon.example.json": validateSniperAlphaHistory,
  "alpha-history-tue.example.json": validateSniperAlphaHistory,
  "alpha-history-diff.example.json": validateSniperAlphaHistoryDiff,
  "alpha-history-trend.example.json": validateSniperAlphaHistoryTrend,
  "strategy-intelligence.example.json": validateSniperStrategyIntelligence,
};

const FORBIDDEN_KEY = /^(signature|txSignature|txid|txId|sendResult|sendResults|sendOutcome)$/i;

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      expect(FORBIDDEN_KEY.test(k), `forbidden key "${k}"`).toBe(false);
      collectStrings(v, out);
    }
  }
}

describe("examples/sniper/alpha-artifacts — committed redacted examples", () => {
  it("the committed files are byte-identical to a fresh generation (no silent drift)", () => {
    const fresh = buildAlphaArtifactExamples();
    for (const name of FILES) {
      const expected = JSON.stringify(fresh[name], null, 2) + "\n";
      expect(readRaw(name), `${name} drifted — re-run scripts/gen-alpha-artifact-examples.ts`).toBe(expected);
    }
  });

  it("the generator produces EXACTLY the committed file set (no orphan / missing example)", () => {
    expect(Object.keys(buildAlphaArtifactExamples()).sort()).toEqual([...FILES].sort());
  });

  for (const name of FILES) {
    it(`${name} re-validates against its production validator`, () => {
      expect(() => VALIDATORS[name](readJson(name))).not.toThrow();
    });

    it(`${name} pins live-disabled / never-sends and carries no send/signature/key field`, () => {
      const artifact = readJson(name) as Record<string, unknown>;
      expect(artifact.liveTradingStatus).toBe("disabled");
      expect(artifact.authorizesLiveTrading).toBe(false);
      expect(artifact.neverSends).toBe(true);
      expect(artifact.phase7LiveTradingReady).toBe(false);
      const strings: string[] = [];
      collectStrings(artifact, strings); // also asserts no forbidden key anywhere
      // No secret-shaped value survives anywhere in a committed example.
      for (const s of strings) {
        expect(redactString(s), `secret-shaped value in ${name}: ${s.slice(0, 24)}…`).toBe(s);
      }
    });
  }

  it("the diff example reports the expected run-level movement (changed / removed / added)", () => {
    const diff = readJson("alpha-history-diff.example.json") as {
      runChanges: { runRef: string; status: string }[];
      summary: { runsChanged: number; runsRemoved: number; runsAdded: number };
    };
    const byRef = Object.fromEntries(diff.runChanges.map((c) => [c.runRef, c.status]));
    expect(byRef["runs/alpha-mon"]).toBe("changed");
    expect(byRef["runs/alpha-only-monday"]).toBe("removed");
    expect(byRef["runs/alpha-only-tuesday"]).toBe("added");
    expect(diff.summary).toMatchObject({ runsChanged: 1, runsRemoved: 1, runsAdded: 1 });
  });

  it("the trend example keeps the supplied order and shows the blocked series falling to 0", () => {
    const trend = readJson("alpha-history-trend.example.json") as {
      snapshots: { label: string }[];
      verdictSeries: { blocked: number[] };
    };
    expect(trend.snapshots.map((s) => s.label)).toEqual(["monday", "tuesday", "wednesday"]);
    expect(trend.verdictSeries.blocked).toEqual([1, 1, 0]);
  });
});
