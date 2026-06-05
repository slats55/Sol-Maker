import { describe, it, expect } from "vitest";
import { createLogger } from "./logger.js";
import { REDACTED } from "./redact.js";

function capture() {
  const lines: string[] = [];
  return {
    lines,
    sink: (line: string) => lines.push(line),
    records: () => lines.map((l) => JSON.parse(l)),
  };
}

const FIXED_TIME = "2026-01-01T00:00:00.000Z";

describe("createLogger", () => {
  it("emits JSON lines with level, time and msg", () => {
    const c = capture();
    const log = createLogger({ sink: c.sink, now: () => FIXED_TIME });
    log.info({ foo: "bar" }, "hello");

    const rec = c.records()[0];
    expect(rec.level).toBe("info");
    expect(rec.time).toBe(FIXED_TIME);
    expect(rec.msg).toBe("hello");
    expect(rec.foo).toBe("bar");
  });

  it("redacts secrets in logged fields by default", () => {
    const c = capture();
    const log = createLogger({ sink: c.sink, now: () => FIXED_TIME });
    log.error(
      { privateKey: "tots-secret", url: "https://x.io/?api-key=leaky" },
      "boom",
    );

    const raw = c.lines.join("\n");
    expect(raw).not.toContain("tots-secret");
    expect(raw).not.toContain("leaky");
    expect(c.records()[0].privateKey).toBe(REDACTED);
  });

  it("respects the level threshold", () => {
    const c = capture();
    const log = createLogger({ sink: c.sink, level: "warn", now: () => FIXED_TIME });
    log.info("ignored");
    log.debug("ignored");
    log.warn("kept");

    expect(c.lines).toHaveLength(1);
    expect(c.records()[0].msg).toBe("kept");
  });

  it("merges base and child bindings", () => {
    const c = capture();
    const log = createLogger({
      sink: c.sink,
      now: () => FIXED_TIME,
      base: { app: "soulmaker" },
    });
    const child = log.child({ module: "solana" });
    child.info("hi");

    const rec = c.records()[0];
    expect(rec.app).toBe("soulmaker");
    expect(rec.module).toBe("solana");
  });

  it("accepts a bare string message", () => {
    const c = capture();
    const log = createLogger({ sink: c.sink, now: () => FIXED_TIME });
    log.info("just a string");
    expect(c.records()[0].msg).toBe("just a string");
  });
});
