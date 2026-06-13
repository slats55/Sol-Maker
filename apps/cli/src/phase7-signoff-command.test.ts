/**
 * Sprint 103-B — `paper:phase7:signoff:template` at the CLI layer.
 *
 * Pins:
 *   - the default invocation yields a template-only record (authorizes nothing);
 *   - a full controlled-micro-trade sign-off requires every acknowledgement + labels + max-spend,
 *     and even then never claims live authorization;
 *   - --require-signed gates the exit code; --out refuses overwrite without --force;
 *   - an over-ceiling max-spend and an unknown acknowledgement id are refused.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePhase7HumanSignoff, requiredAcknowledgementsFor } from "@soulmaker/execution";
import { phase7SignoffTemplateReport } from "./commands.js";

const MICRO_ACKS = requiredAcknowledgementsFor("controlled-mainnet-microtrade-only").map((a) => a.id);

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "p7-signoff-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("paper:phase7:signoff:template", () => {
  it("the default invocation is a template-only record that authorizes nothing", () => {
    const r = phase7SignoffTemplateReport({}, { json: true });
    expect(r.exitCode).toBe(0);
    const record = validatePhase7HumanSignoff(JSON.parse(r.text));
    expect(record.signoffStatus).toBe("template-only");
    expect(record.grantedScope).toBe("none");
    expect(record.authorizesLiveExecution).toBe(false);
    expect(record.neverSends).toBe(true);
  });

  it("--require-signed exits non-zero on an unsigned template", () => {
    const r = phase7SignoffTemplateReport({}, { requireSigned: true });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("TEMPLATE-ONLY");
  });

  it("a fully-signed controlled micro-trade record is produced but still authorizes no live trade", () => {
    const r = phase7SignoffTemplateReport(
      {},
      {
        repoSha: "e607238",
        scope: "controlled-mainnet-microtrade-only",
        acknowledge: MICRO_ACKS,
        operatorLabel: "operator-a",
        signedAt: "2026-06-13",
        maxSpendSol: "0.01",
        requireSigned: true,
        json: true,
      },
    );
    expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
    const record = validatePhase7HumanSignoff(JSON.parse(r.text));
    expect(record.signoffStatus).toBe("signed-for-controlled-microtrade");
    expect(record.grantedScope).toBe("controlled-mainnet-microtrade-only");
    expect(record.maxSpendSol).toBe(0.01);
    expect(record.authorizesLiveExecution).toBe(false);
    expect(record.phase7LiveTradingReady).toBe(false);
    expect(record.requiresSeparateExecutionSprint).toBe(true);
  });

  it("refuses an over-ceiling max-spend and an unknown acknowledgement id", () => {
    const tooBig = phase7SignoffTemplateReport(
      {},
      { scope: "controlled-mainnet-microtrade-only", acknowledge: MICRO_ACKS, operatorLabel: "a", signedAt: "x", maxSpendSol: "5" },
    );
    expect(tooBig.exitCode).toBe(1);
    expect(tooBig.text).toContain("ceiling");

    const badAck = phase7SignoffTemplateReport({}, { acknowledge: ["nope"] });
    expect(badAck.exitCode).toBe(1);
    expect(badAck.text).toContain("unknown acknowledgement");
  });

  it("--out writes the record and refuses overwrite without --force", () => {
    withTmp((tmp) => {
      const out = join(tmp, "signoff.json");
      const first = phase7SignoffTemplateReport({}, { outPath: out });
      expect(first.exitCode).toBe(0);
      expect(existsSync(out)).toBe(true);
      validatePhase7HumanSignoff(JSON.parse(readFileSync(out, "utf8")));

      const again = phase7SignoffTemplateReport({}, { outPath: out });
      expect(again.exitCode).toBe(1);
      expect(again.text).toContain("already exists");

      writeFileSync(out, "{}");
      const forced = phase7SignoffTemplateReport({}, { outPath: out, force: true });
      expect(forced.exitCode).toBe(0);
    });
  });
});
