import { describe, expect, it } from "vitest";

import { renderToString } from "../src/lib/html.js";
import { normalizeArtifact } from "../src/lib/local-artifact.js";
import { navItem } from "../src/lib/nav.js";
import { DashboardShell } from "../src/components/layout.js";
import { ArtifactReportView, ArtifactSchemaBadge } from "../src/components/artifact.js";
import { renderArtifact, renderArtifactReport } from "../src/pages/artifact.js";

const render = (value: { __html: string }): string => renderToString(value);

/** Wrap a page body in the shell exactly as build.ts / inspect.ts do. */
function renderInShell(body: { __html: string }, title: string): string {
  return renderToString(
    DashboardShell({ activeId: "artifact", title, description: "x", body }),
  );
}

describe("ArtifactSchemaBadge", () => {
  it("renders a known stable schema", () => {
    const out = render(ArtifactSchemaBadge(normalizeArtifact({ schemaVersion: "backtest.report.v1" })));
    expect(out).toContain("backtest.report.v1");
    expect(out).toContain("sm-schema--stable");
  });

  it("flags an emerging schema", () => {
    const out = render(
      ArtifactSchemaBadge(normalizeArtifact({ schemaVersion: "backtest.research.verify.v1" })),
    );
    expect(out).toContain("sm-schema--emerging");
  });

  it("flags an unknown schema", () => {
    const out = render(ArtifactSchemaBadge(normalizeArtifact({ schemaVersion: "made.up.v1" })));
    expect(out).toContain("sm-schema--unknown");
    expect(out).toContain("made.up.v1");
  });

  it("handles a missing schemaVersion without lying", () => {
    const out = render(ArtifactSchemaBadge(normalizeArtifact({ steps: 1 })));
    expect(out).toContain("sm-schema--unknown");
    expect(out).toContain("schemaVersion");
    expect(out).not.toContain("undefined");
  });
});

describe("ArtifactReportView", () => {
  it("renders summary, fields, and a capped preview", () => {
    const view = normalizeArtifact({
      schemaVersion: "backtest.report.v1",
      name: "buy-hold",
      steps: 6,
      positions: [1, 2],
    });
    const out = render(ArtifactReportView(view));
    expect(out).toContain("Backtest report");
    expect(out).toContain("Raw preview");
    expect(out).toContain("steps");
    expect(out.toLowerCase()).toContain("not advice");
  });

  it("escapes hostile string values (no injection)", () => {
    const view = normalizeArtifact({
      schemaVersion: "backtest.report.v1",
      name: "<script>alert(1)</script>",
      evil: '"><img src=x onerror=alert(1)>',
    });
    const out = render(ArtifactReportView(view));
    expect(out).not.toContain("<script>alert");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders and escapes warnings", () => {
    const view = normalizeArtifact({ warnings: ["<b>danger</b>"] });
    const out = render(ArtifactReportView(view));
    expect(out).toContain("&lt;b&gt;danger&lt;/b&gt;");
    expect(out).not.toContain("<b>danger</b>");
  });
});

describe("renderArtifact (empty-state page)", () => {
  const out = renderInShell(renderArtifact(), navItem("artifact").label);

  it("shows the PAPER-only banner and local-only language", () => {
    expect(out).toContain("PAPER ONLY");
    expect(out.toLowerCase()).toContain("no upload");
    expect(out.toLowerCase()).toContain("no server");
  });

  it("documents the inspect command and the empty state", () => {
    expect(out).toContain("pnpm web:inspect");
    expect(out).toContain("No artifact loaded");
  });

  it("contains no script tag or executable handler", () => {
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/\son(?:click|load|error|mouseover|focus|submit)\s*=/i);
  });
});

describe("renderArtifactReport (loaded page)", () => {
  it("renders a full safe document with the source label", () => {
    const view = normalizeArtifact({ schemaVersion: "backtest.report.v1", steps: 6 });
    const out = renderInShell(
      renderArtifactReport(view, { name: "buy-hold.report.json" }),
      "Artifact inspector",
    );
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("PAPER ONLY");
    expect(out).toContain("buy-hold.report.json");
    expect(out).toContain("backtest.report.v1");
  });

  it("neutralizes hostile content end-to-end through the shell", () => {
    const view = normalizeArtifact({
      schemaVersion: "x",
      name: "<script>steal()</script>",
    });
    const out = renderInShell(
      renderArtifactReport(view, { name: "<script>evil</script>.json" }),
      "Artifact inspector",
    );
    expect(out).not.toContain("<script>steal");
    expect(out).not.toContain("<script>evil");
    expect(out).toContain("&lt;script&gt;");
  });
});
