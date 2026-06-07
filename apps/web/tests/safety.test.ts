import { describe, expect, it } from "vitest";

import {
  CURRENT_MODE,
  MODES,
  NEVER_DOES,
  SAFETY_DISCLAIMERS,
  modeInfo,
  type Mode,
} from "../src/lib/safety.js";

describe("modes", () => {
  it("defaults to PAPER", () => {
    expect(CURRENT_MODE).toBe("PAPER");
  });

  it("describes exactly the four documented modes in safest→most-dangerous order", () => {
    expect(MODES.map((mode) => mode.id)).toEqual([
      "PAPER",
      "WATCH_ONLY",
      "SIMULATION",
      "DANGEROUS_BURNER_LIVE",
    ]);
  });

  it("PAPER has no capabilities at all", () => {
    const paper = modeInfo("PAPER");
    expect(paper.needsKey).toBe(false);
    expect(paper.readsChain).toBe(false);
    expect(paper.buildsTx).toBe(false);
    expect(paper.simulates).toBe(false);
    expect(paper.sends).toBe(false);
    expect(paper.status).toBe("active");
  });

  it("ONLY DANGEROUS_BURNER_LIVE can send, and it is gated", () => {
    const senders = MODES.filter((mode) => mode.sends);
    expect(senders).toHaveLength(1);
    expect(senders[0]?.id).toBe("DANGEROUS_BURNER_LIVE");
    expect(senders[0]?.status).toBe("gated");
    expect(senders[0]?.tone).toBe("danger");
  });

  it("no non-live mode needs a key", () => {
    for (const mode of MODES) {
      if (mode.id !== "DANGEROUS_BURNER_LIVE") {
        expect(mode.needsKey).toBe(false);
      }
    }
  });

  it("WATCH_ONLY reads chain but never builds/simulates/sends", () => {
    const watch = modeInfo("WATCH_ONLY");
    expect(watch.readsChain).toBe(true);
    expect(watch.buildsTx).toBe(false);
    expect(watch.simulates).toBe(false);
    expect(watch.sends).toBe(false);
  });

  it("SIMULATION builds + simulates but never sends", () => {
    const sim = modeInfo("SIMULATION");
    expect(sim.buildsTx).toBe(true);
    expect(sim.simulates).toBe(true);
    expect(sim.sends).toBe(false);
  });

  it("modeInfo throws on an unknown mode", () => {
    expect(() => modeInfo("NOPE" as Mode)).toThrow(/Unknown mode/);
  });
});

describe("safety disclaimers", () => {
  it("includes every required statement", () => {
    for (const required of [
      "PAPER ONLY",
      "No live trading",
      "No wallet connected",
      "No signing or sending",
      "Local simulated reports only",
      "Not financial advice",
      "Not a profitability claim",
    ]) {
      expect(SAFETY_DISCLAIMERS).toContain(required);
    }
  });
});

describe("hard guarantees", () => {
  it("rejects wallet, seed, signing, network, and fake state", () => {
    const text = NEVER_DOES.join(" ").toLowerCase();
    expect(text).toContain("wallet");
    expect(text).toContain("seed");
    expect(text).toContain("sign");
    expect(text).toContain("send");
    expect(text).toContain("scrape");
    expect(text).toContain("fake");
  });
});
