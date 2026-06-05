import { describe, it, expect } from "vitest";
import { ConfigSchema, HARD_LIMITS } from "./schema.js";

describe("ConfigSchema", () => {
  it("applies safe defaults for an empty config", () => {
    const cfg = ConfigSchema.parse({});
    expect(cfg.mode).toBe("PAPER");
    expect(cfg.killSwitch).toBe(false);
    expect(cfg.logging.redact).toBe(true);
    expect(cfg.caps.maxTradeSizeSol).toBeLessThanOrEqual(HARD_LIMITS.maxTradeSizeSol);
    expect(cfg.live.acknowledgeBurnerRisk).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(() => ConfigSchema.parse({ mode: "YOLO_LIVE" })).toThrow();
  });

  it("rejects a trade size above the hard limit", () => {
    expect(() =>
      ConfigSchema.parse({
        caps: {
          maxTradeSizeSol: HARD_LIMITS.maxTradeSizeSol + 1,
          maxDailyLossSol: 0.25,
          maxOpenPositions: 3,
        },
      }),
    ).toThrow(/maxTradeSizeSol exceeds hard limit/);
  });

  it("rejects a daily loss cap above the hard limit", () => {
    expect(() =>
      ConfigSchema.parse({
        caps: {
          maxTradeSizeSol: 0.05,
          maxDailyLossSol: HARD_LIMITS.maxDailyLossSol + 1,
          maxOpenPositions: 3,
        },
      }),
    ).toThrow(/maxDailyLossSol exceeds hard limit/);
  });

  it("rejects a non-positive trade size", () => {
    expect(() =>
      ConfigSchema.parse({
        caps: { maxTradeSizeSol: 0, maxDailyLossSol: 0.25, maxOpenPositions: 3 },
      }),
    ).toThrow();
  });

  it("refuses to disable log redaction", () => {
    expect(() =>
      ConfigSchema.parse({ logging: { level: "info", redact: false } }),
    ).toThrow(/redaction cannot be disabled/i);
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(() => ConfigSchema.parse({ secretBackdoor: true })).toThrow();
  });
});
