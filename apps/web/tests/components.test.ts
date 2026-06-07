import { describe, expect, it } from "vitest";

import { renderToString } from "../src/lib/html.js";
import { SAMPLE_BACKTEST_REPORT } from "../src/lib/sample-data.js";
import { ModeBadge, SafetyBanner } from "../src/components/layout.js";
import { EmptyState, StatusCard } from "../src/components/ui.js";
import { CapabilityTable } from "../src/components/tables.js";
import { CommandCard } from "../src/components/cards.js";
import {
  ReportPlaceholder,
  ReportSchemaBadge,
  ReportSummaryCard,
} from "../src/components/reports.js";

const render = (value: { __html: string }): string => renderToString(value);

describe("ModeBadge", () => {
  it("labels PAPER and carries the safe tone", () => {
    const out = render(ModeBadge("PAPER", { showStatus: true }));
    expect(out).toContain("PAPER");
    expect(out).toContain("sm-badge--safe");
    expect(out).toContain("active");
  });

  it("marks DANGEROUS_BURNER_LIVE with the danger tone", () => {
    const out = render(ModeBadge("DANGEROUS_BURNER_LIVE"));
    expect(out).toContain("sm-badge--danger");
  });
});

describe("SafetyBanner", () => {
  it("shows the prominent PAPER-only safety language", () => {
    const out = render(SafetyBanner());
    expect(out).toContain("PAPER ONLY");
    expect(out).toContain("No live trading");
    expect(out).toContain("No wallet connected");
  });
});

describe("ReportSchemaBadge", () => {
  it("renders a known stable schema with its id", () => {
    const out = render(ReportSchemaBadge("backtest.report.v1"));
    expect(out).toContain("backtest.report.v1");
    expect(out).toContain("sm-schema--stable");
    expect(out).not.toContain("unknown");
  });

  it("flags an emerging schema", () => {
    const out = render(ReportSchemaBadge("backtest.sensitivity.matrix.v1"));
    expect(out).toContain("sm-schema--emerging");
    expect(out).toContain("emerging");
  });

  it("flags an unknown schema instead of pretending to know it", () => {
    const out = render(ReportSchemaBadge("made.up.v1"));
    expect(out).toContain("sm-schema--unknown");
    expect(out).toContain("unknown");
    expect(out).toContain("made.up.v1");
  });

  it("escapes a hostile schema id", () => {
    const out = render(ReportSchemaBadge('"><script>alert(1)</script>'));
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("ReportSummaryCard / ReportPlaceholder", () => {
  it("renders the sample report with its simulated, not-advice note", () => {
    const out = render(ReportSummaryCard(SAMPLE_BACKTEST_REPORT));
    expect(out).toContain("backtest.report.v1");
    expect(out).toContain("SAMPLE");
    expect(out.toLowerCase()).toContain("not a live result");
  });

  it("placeholder states that nothing is loaded and loading is not wired", () => {
    const out = render(
      ReportPlaceholder({ title: "No report loaded", message: "nothing here" }),
    );
    expect(out).toContain("No report loaded");
    expect(out.toLowerCase()).toContain("not wired");
  });
});

describe("CapabilityTable", () => {
  it("renders all four modes and yes/no cells", () => {
    const out = render(CapabilityTable());
    for (const mode of ["PAPER", "WATCH_ONLY", "SIMULATION", "DANGEROUS_BURNER_LIVE"]) {
      expect(out).toContain(mode);
    }
    expect(out).toContain(">yes<");
    expect(out).toContain(">no<");
  });
});

describe("CommandCard", () => {
  it("labels a chain-reading command and prefixes pnpm soulmaker", () => {
    const out = render(
      CommandCard({
        command: "token:risk <mint>",
        summary: "Advisory risk.",
        group: "Risk",
        readsChain: true,
      }),
    );
    expect(out).toContain("pnpm soulmaker token:risk");
    expect(out).toContain("reads chain");
  });

  it("labels an offline command", () => {
    const out = render(
      CommandCard({
        command: "doctor",
        summary: "Sanity check.",
        group: "Diagnostics",
        readsChain: false,
      }),
    );
    expect(out).toContain("offline");
  });
});

describe("StatusCard + EmptyState escaping", () => {
  it("shows the SAMPLE marker and escapes hostile content", () => {
    const out = render(
      StatusCard({ label: "<x>", value: "<y>", tone: "safe", sample: true }),
    );
    expect(out).toContain("SAMPLE");
    expect(out).toContain("&lt;x&gt;");
    expect(out).toContain("&lt;y&gt;");
    expect(out).not.toContain("<x>");
  });

  it("EmptyState renders a title and message", () => {
    const out = render(EmptyState({ title: "Nothing", message: "no data" }));
    expect(out).toContain("Nothing");
    expect(out).toContain("no data");
  });
});
