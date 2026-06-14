import { describe, it, expect } from "vitest";
import {
  buildSniperProviderHealthReport,
  validateSniperProviderHealthReport,
  formatSniperProviderHealthReport,
  summarizeProviderHealthForAlpha,
  deriveCanRunLiveReadonlyCampaign,
  SniperProviderHealthReportError,
  SNIPER_PROVIDER_HEALTH_REPORT_SCHEMA_VERSION,
  SNIPER_PROVIDER_HEALTH_REPORT_BANNER,
  SNIPER_PROVIDER_HEALTH_LIVE_SEND_STATUS,
  type SniperProviderHealthCheckInput,
} from "./provider-health-report.js";

function build(checks: SniperProviderHealthCheckInput[], extra: Record<string, unknown> = {}) {
  return buildSniperProviderHealthReport({ reportId: "test", mode: "mainnet-dry-run", ...extra, checks });
}

const ALL_AVAILABLE: SniperProviderHealthCheckInput[] = [
  { provider: "rpc", status: "available", latencyMs: 120, redactedEndpoint: "https://api.mainnet-beta.solana.com" },
  { provider: "jupiter-quote", status: "available", latencyMs: 80, redactedEndpoint: "https://lite-api.jup.ag" },
  { provider: "rust-engine", status: "available", latencyMs: 21 },
];

describe("buildSniperProviderHealthReport — happy path (all available)", () => {
  it("pins the schema, banner, and safety literals; re-derives the summary; allows a live read-only campaign", () => {
    const report = build(ALL_AVAILABLE);
    expect(report.schemaVersion).toBe(SNIPER_PROVIDER_HEALTH_REPORT_SCHEMA_VERSION);
    expect(report.banner).toBe(SNIPER_PROVIDER_HEALTH_REPORT_BANNER);
    expect(report.noSend).toBe(true);
    expect(report.noSigner).toBe(true);
    expect(report.liveSendStatus).toBe(SNIPER_PROVIDER_HEALTH_LIVE_SEND_STATUS);
    expect(report.authorizesLiveTrading).toBe(false);
    expect(report.summary.availableCount).toBe(3);
    expect(report.canRunLiveReadonlyCampaign).toBe(true);
    expect(report.canRunFixtureCampaign).toBe(true);
    expect(report.network).toBe("mainnet-beta");
    expect(validateSniperProviderHealthReport(report)).toEqual(report);
  });
});

describe("buildSniperProviderHealthReport — degraded / unavailable providers", () => {
  it("RPC unavailable blocks the live read-only campaign", () => {
    const report = build([
      { provider: "rpc", status: "unavailable" },
      { provider: "jupiter-quote", status: "available" },
    ]);
    expect(report.canRunLiveReadonlyCampaign).toBe(false);
    expect(report.summary.unavailableCount).toBe(1);
    expect(report.summary.availableCount).toBe(1);
    validateSniperProviderHealthReport(report);
  });

  it("Jupiter unavailable blocks the live read-only campaign", () => {
    const report = build([
      { provider: "rpc", status: "available" },
      { provider: "jupiter-quote", status: "unavailable" },
    ]);
    expect(report.canRunLiveReadonlyCampaign).toBe(false);
  });

  it("a timeout is counted and reported honestly", () => {
    const report = build([
      { provider: "rpc", status: "timeout" },
      { provider: "jupiter-quote", status: "available" },
    ]);
    expect(report.summary.timeoutCount).toBe(1);
    expect(report.canRunLiveReadonlyCampaign).toBe(false);
  });

  it("a rate-limited provider is counted and blocks live-readiness", () => {
    const report = build([
      { provider: "rpc", status: "available" },
      { provider: "jupiter-quote", status: "rate-limited" },
    ]);
    expect(report.summary.rateLimitedCount).toBe(1);
    expect(report.canRunLiveReadonlyCampaign).toBe(false);
  });

  it("a misconfigured endpoint is counted and blocks live-readiness", () => {
    const report = build([
      { provider: "rpc", status: "misconfigured" },
      { provider: "jupiter-quote", status: "available" },
    ]);
    expect(report.summary.misconfiguredCount).toBe(1);
    expect(report.canRunLiveReadonlyCampaign).toBe(false);
  });

  it("Rust unavailable does NOT block a live read-only campaign (RPC + quote still reachable)", () => {
    const report = build([
      { provider: "rpc", status: "available" },
      { provider: "jupiter-quote", status: "available" },
      { provider: "rust-engine", status: "unavailable" },
    ]);
    expect(report.canRunLiveReadonlyCampaign).toBe(true);
    expect(report.summary.unavailableCount).toBe(1);
  });

  it("with no rpc / quote check at all, a live read-only campaign cannot run", () => {
    const report = build([{ provider: "rust-engine", status: "available" }]);
    expect(report.canRunLiveReadonlyCampaign).toBe(false);
  });
});

describe("buildSniperProviderHealthReport — provider unavailable is NOT a risk verdict", () => {
  it("has no blocked / ready status in the closed status set (reachability only)", () => {
    expect(() => build([{ provider: "rpc", status: "blocked" }])).toThrow(SniperProviderHealthReportError);
    expect(() => build([{ provider: "rpc", status: "ready" }])).toThrow(SniperProviderHealthReportError);
  });
});

describe("buildSniperProviderHealthReport — secret handling", () => {
  it("refuses a secret-shaped redactedEndpoint (the caller must pre-redact to host-only)", () => {
    expect(() =>
      build([{ provider: "rpc", status: "available", redactedEndpoint: "https://rpc.example.com/?api-key=supersecret123longvalue" }]),
    ).toThrow(/secret-shaped/);
  });

  it("refuses a secret-shaped message", () => {
    const longBase58 = "z".repeat(90);
    expect(() => build([{ provider: "rpc", status: "available", message: `key ${longBase58}` }])).toThrow(SniperProviderHealthReportError);
  });
});

describe("validateSniperProviderHealthReport — parity wall + closed schema", () => {
  it("refuses a tampered summary count", () => {
    const report = build(ALL_AVAILABLE) as unknown as Record<string, unknown>;
    const tampered = { ...report, summary: { ...(report.summary as object), availableCount: 99 } };
    expect(() => validateSniperProviderHealthReport(tampered)).toThrow(/re-derived count/);
  });

  it("refuses a tampered canRunLiveReadonlyCampaign", () => {
    const report = build([{ provider: "rpc", status: "unavailable" }, { provider: "jupiter-quote", status: "unavailable" }]) as unknown as Record<string, unknown>;
    const tampered = { ...report, canRunLiveReadonlyCampaign: true };
    expect(() => validateSniperProviderHealthReport(tampered)).toThrow(/re-derived value/);
  });

  it("refuses an unknown field (closed schema — no signature / sendResult)", () => {
    const report = build(ALL_AVAILABLE) as unknown as Record<string, unknown>;
    expect(() => validateSniperProviderHealthReport({ ...report, signature: "x" })).toThrow(/unknown field/);
    expect(() => validateSniperProviderHealthReport({ ...report, sendResult: {} })).toThrow(/unknown field/);
  });

  it("refuses a flipped noSend / noSigner / liveSendStatus / authorizesLiveTrading", () => {
    const report = build(ALL_AVAILABLE) as unknown as Record<string, unknown>;
    expect(() => validateSniperProviderHealthReport({ ...report, noSend: false })).toThrow(/noSend/);
    expect(() => validateSniperProviderHealthReport({ ...report, noSigner: false })).toThrow(/noSigner/);
    expect(() => validateSniperProviderHealthReport({ ...report, liveSendStatus: "enabled" })).toThrow(/liveSendStatus/);
    expect(() => validateSniperProviderHealthReport({ ...report, authorizesLiveTrading: true })).toThrow(/authorizesLiveTrading/);
    expect(() => validateSniperProviderHealthReport({ ...report, canRunFixtureCampaign: false })).toThrow(/canRunFixtureCampaign/);
  });

  it("refuses a network that contradicts the mode", () => {
    const report = build(ALL_AVAILABLE) as unknown as Record<string, unknown>;
    expect(() => validateSniperProviderHealthReport({ ...report, network: "devnet" })).toThrow(/contradicts mode/);
  });
});

describe("deriveCanRunLiveReadonlyCampaign", () => {
  it("requires every live-required provider to be fully available", () => {
    const report = build(ALL_AVAILABLE);
    expect(deriveCanRunLiveReadonlyCampaign(report.checks)).toBe(true);
  });
});

describe("summarizeProviderHealthForAlpha", () => {
  it("maps rpc→risk, jupiter-quote→quote, simulation→simulation", () => {
    const report = build([
      { provider: "rpc", status: "available" },
      { provider: "jupiter-quote", status: "unavailable" },
      { provider: "simulation", status: "available" },
    ]);
    const s = summarizeProviderHealthForAlpha(report);
    expect(s.risk).toBe("ok");
    expect(s.quote).toBe("unavailable");
    expect(s.simulation).toBe("ok");
  });

  it("reports not-attempted when a provider has no check", () => {
    const report = build([{ provider: "rpc", status: "available" }, { provider: "jupiter-quote", status: "available" }]);
    expect(summarizeProviderHealthForAlpha(report).simulation).toBe("not-attempted");
  });
});

describe("formatSniperProviderHealthReport", () => {
  it("renders a stable, redacted summary that names the live-disabled state", () => {
    const out = formatSniperProviderHealthReport(build(ALL_AVAILABLE), { label: "smoke" });
    expect(out).toContain("PROVIDER HEALTH REPORT");
    expect(out).toContain("DISABLED");
    expect(out).toContain("can run:");
    expect(out).toContain("rpc");
  });

  it("is deterministic", () => {
    const a = formatSniperProviderHealthReport(build(ALL_AVAILABLE));
    const b = formatSniperProviderHealthReport(build(ALL_AVAILABLE));
    expect(a).toBe(b);
  });
});
