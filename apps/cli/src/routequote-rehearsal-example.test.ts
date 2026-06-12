/**
 * Sprint 91 — the committed `examples/sniper/routequote-rehearsal/` walkthrough, pinned.
 *
 * Runs the EXACT operator chain the example README documents over the committed fictional
 * fixtures (the S90 real-input inspect/risk files + the S91 quote observation):
 *
 *   preflight:input:prepare → routequote:prepare → paper:sniper:dry-run --routequote
 *
 * and pins the honest outcomes: an unblocked 1-entry plan, quote facts recorded with provenance
 * and the live-state caveat (destination honestly unresolved), the prepared artifact carried
 * verbatim, the still-blocked operator verdict (paper-enters demand review — a quote can never
 * change that), `phase7LiveTradingReady` false everywhere, and byte determinism across runs.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSimulationIntentPlanV2, validateSimulationRouteResolutionV1 } from "@soulmaker/simulation";
import { ROUTE_QUOTE_RESOLVER_ID, validateRouteQuotePrepared } from "@soulmaker/routequote";
import {
  paperRouteQuotePrepareReport,
  paperSniperDryRunReport,
  paperSniperPreflightInputPrepareReport,
} from "./commands.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const REAL_INPUT = join(ROOT, "examples/sniper/real-input-rehearsal");
const ROUTEQUOTE = join(ROOT, "examples/sniper/routequote-rehearsal");

const CANDIDATES = join(REAL_INPUT, "candidates.clean.fictional.json");

async function withTmp<T>(fn: (tmp: string) => Promise<T> | T): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "rq-rehearsal-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function runChain(tmp: string, outDir: string): void {
  const pf = paperSniperPreflightInputPrepareReport(
    { cwd: tmp, env: {} },
    {
      candidatesPath: CANDIDATES,
      inspectPaths: [join(REAL_INPUT, "inspect.fica.fictional.json")],
      riskPaths: [join(REAL_INPUT, "risk.fica.fictional.json")],
      outPath: "pf.json",
    },
  );
  expect(pf.exitCode, pf.text.slice(0, 300)).toBe(0);
  const rq = paperRouteQuotePrepareReport(
    { cwd: tmp, env: {} },
    {
      candidatesPath: CANDIDATES,
      quotePaths: [join(ROUTEQUOTE, "quote.fica.fictional.json")],
      outPath: "rq.json",
    },
  );
  expect(rq.exitCode, rq.text.slice(0, 300)).toBe(0);
  const dry = paperSniperDryRunReport(
    { cwd: tmp, env: {} },
    {
      candidatesPath: CANDIDATES,
      preflightInputPath: "pf.json",
      routequotePath: "rq.json",
      adoptSpecs: true,
      acknowledgePaperEnterReview: true,
      operatorLabel: "fictional-operator",
      runLabel: "routequote-rehearsal",
      outDir,
    },
  );
  expect(dry.exitCode, dry.text.slice(0, 600)).toBe(0);
}

describe("routequote rehearsal example — the committed walkthrough, end to end", () => {
  it("records quote provenance through the whole chain with the honest blocked verdict", async () => {
    await withTmp((tmp) => {
      runChain(tmp, "out");

      const plan = validateSimulationIntentPlanV2(readJson(join(tmp, "out", "intent-plan.json")));
      expect(plan.blocked).toBe(false);
      expect(plan.entryCount).toBe(1);

      const route = validateSimulationRouteResolutionV1(readJson(join(tmp, "out", "route-resolution.json")));
      expect(route.routeResolverId).toBe(ROUTE_QUOTE_RESOLVER_ID);
      expect(route.routeResolverAttempted).toBe(true);
      expect(route.resolutionStatus).toBe("unresolved");
      expect(route.liveStateCaveat).toBe(true);
      expect(route.phase7LiveTradingReady).toBe(false);
      const entry = route.entries[0]!;
      expect(entry.routePreview.status).toBe("resolved-as-label");
      expect(entry.routePreview.label).toContain("fictional-amm");
      expect(entry.routePreview.label).toContain("NOT executable");
      expect(entry.feePreview.status).toBe("resolved-as-label");
      expect(entry.destinationPreview).toEqual({ status: "unresolved", label: null });

      const prepared = validateRouteQuotePrepared(readJson(join(tmp, "out", "routequote-prepared.json")));
      expect(prepared.observedCount).toBe(1);
      expect(prepared.phase7LiveTradingReady).toBe(false);

      const bundle = readJson(join(tmp, "out", "operator-bundle.json")) as Record<string, unknown>;
      expect(bundle.routeResolutionStatus).toBe("unresolved");
      expect(bundle.routeResolverAttempted).toBe(true);
      expect(bundle.routeLiveStateCaveat).toBe(true);
      expect(bundle.operatorVerdict).toBe("blocked"); // paper-enters demand review — quotes never change that
      expect(bundle.chainBlockingCodes).toContain("simulation-blocked-prereqs-not-ready");
      expect(bundle.phase7LiveTradingReady).toBe(false);
    });
  });

  it("the honest error-path observation stays an error (mixed candidates, never upgraded)", async () => {
    await withTmp((tmp) => {
      const rq = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        {
          candidatesPath: join(REAL_INPUT, "candidates.fictional.json"),
          quotePaths: [
            join(ROUTEQUOTE, "quote.fica.fictional.json"),
            join(ROUTEQUOTE, "quote.ficb.error.fictional.json"),
          ],
          outPath: "rq.json",
        },
      );
      expect(rq.exitCode, rq.text.slice(0, 300)).toBe(0);
      const prepared = validateRouteQuotePrepared(readJson(join(tmp, "rq.json")));
      expect(prepared.observedCount).toBe(1);
      expect(prepared.errorCount).toBe(1);
      const ficb = prepared.entries.find((e) => e.candidateId === "ficb")!;
      expect(ficb.quoteStatus).toBe("error");
      expect(ficb.routeLabel).toBeNull();
      expect(ficb.statusReason).toContain("unreachable");
    });
  });

  it("two identical runs produce byte-identical artifacts (determinism)", async () => {
    await withTmp((tmp) => {
      runChain(tmp, "o1");
      rmSync(join(tmp, "pf.json"));
      rmSync(join(tmp, "rq.json"));
      runChain(tmp, "o2");
      for (const f of ["route-resolution.json", "routequote-prepared.json", "operator-bundle.json", "RUN_SUMMARY.md"]) {
        expect(readFileSync(join(tmp, "o1", f), "utf8")).toBe(readFileSync(join(tmp, "o2", f), "utf8"));
      }
    });
  });
});
