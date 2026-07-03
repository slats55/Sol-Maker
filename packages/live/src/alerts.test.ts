import { describe, expect, it } from "vitest";

import {
  OPERATOR_ALERT_KINDS,
  OPERATOR_ALERT_SINKS_DEFAULT,
  OperatorAlertError,
  buildOperatorAlert,
  formatConsoleAlert,
  formatWebhookFileLine,
  validateOperatorAlert,
} from "./alerts.js";

const AT = "2026-07-03T12:00:00.000Z";

describe("alert sinks — disabled by default", () => {
  it("both sinks default OFF (console false, no webhook file)", () => {
    expect(OPERATOR_ALERT_SINKS_DEFAULT.console).toBe(false);
    expect(OPERATOR_ALERT_SINKS_DEFAULT.webhookFilePath).toBeNull();
  });
});

describe("buildOperatorAlert — payload shape", () => {
  it("builds every kind in the closed vocabulary with the pinned literals", () => {
    for (const kind of OPERATOR_ALERT_KINDS) {
      const a = buildOperatorAlert({ kind, at: AT, detail: `event: ${kind}`, sessionId: "s-1" });
      expect(a.schemaVersion).toBe("live.operator.alert.v1");
      expect(a.alertIsInformationalOnly).toBe(true);
      expect(a.backendNeverSends).toBe(true);
    }
  });

  it("refuses unknown kinds, bad timestamps and oversized detail", () => {
    expect(() => buildOperatorAlert({ kind: "trade_executed" as never, at: AT, detail: "x" })).toThrow(/closed vocabulary/);
    expect(() => buildOperatorAlert({ kind: "candidate_found", at: "now", detail: "x" })).toThrow(/ISO-8601/);
    expect(() => buildOperatorAlert({ kind: "candidate_found", at: AT, detail: "x".repeat(400) })).toThrow(/300/);
  });

  it("refuses secrets in detail and data (redaction enforced at build time)", () => {
    expect(() => buildOperatorAlert({ kind: "candidate_found", at: AT, detail: "5".repeat(88) })).toThrow(/secret-shaped/);
    expect(() => buildOperatorAlert({ kind: "candidate_found", at: AT, detail: "ok", data: { apiKey: "k" } })).toThrow(/sensitive-named/);
    expect(() => buildOperatorAlert({ kind: "candidate_found", at: AT, detail: "ok", data: { note: "Bearer abcdef123456" } })).toThrow(/secret-shaped/);
  });
});

describe("sink formatting", () => {
  const alert = buildOperatorAlert({ kind: "canary_recommended", at: AT, detail: "canary recommended for So111…112", sessionId: "s-1" });

  it("console line is single-line and redaction-passed", () => {
    const line = formatConsoleAlert(alert);
    expect(line).toContain("canary_recommended");
    expect(line).toContain("s-1");
    expect(line).not.toContain("\n");
  });

  it("webhook-file line is one JSON object + newline that re-validates", () => {
    const line = formatWebhookFileLine(alert);
    expect(line.endsWith("\n")).toBe(true);
    const parsed = validateOperatorAlert(JSON.parse(line));
    expect(parsed.kind).toBe("canary_recommended");
  });
});

describe("validateOperatorAlert — closed schema", () => {
  const good = JSON.parse(formatWebhookFileLine(buildOperatorAlert({ kind: "session_paused", at: AT, detail: "paused" }))) as Record<string, unknown>;

  it("refuses unknown fields and tampered pins", () => {
    expect(() => validateOperatorAlert({ ...good, webhookUrl: "https://x" })).toThrow(/unknown field/);
    expect(() => validateOperatorAlert({ ...good, backendNeverSends: false })).toThrow(/pinned/);
    expect(() => validateOperatorAlert("nope")).toThrow(OperatorAlertError);
  });
});
