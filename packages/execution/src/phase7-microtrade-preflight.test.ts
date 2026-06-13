/**
 * Sprint 104-A — the S104 controlled micro-trade PREFLIGHT builder/validator.
 *
 * The preflight answers "are the structural inputs for a FUTURE, separately-authorized micro-trade
 * present?" and authorizes nothing by construction. These tests pin:
 *   - every missing prerequisite (sign-off, devnet proof, release candidate, burner, manual
 *     confirmation) blocks with the matching verdict, in precedence order;
 *   - a release candidate blocked on risk / quote / simulation maps to the matching blocked verdict;
 *   - the happy fixture reaches ready-for-separate-execution-authorization but STILL pins every
 *     no-execute / no-authorize lock;
 *   - the validator is a closed-schema parity wall: an unknown field (e.g. a smuggled send result /
 *     signature), a tampered verdict, an over-cap spend, an invalid/over-long burner, or an
 *     inconsistent release-candidate echo is refused.
 */

import { describe, it, expect } from "vitest";
import {
  buildPhase7MicrotradePreflight,
  validatePhase7MicrotradePreflight,
  derivePhase7MicrotradePreflightVerdict,
  Phase7MicrotradePreflightError,
  PHASE7_MICROTRADE_PREFLIGHT_MAX_SPEND_LAMPORTS,
  type BuildPhase7MicrotradePreflightInput,
} from "./phase7-microtrade-preflight.js";

const BURNER = "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm";

function readyInput(overrides: Partial<BuildPhase7MicrotradePreflightInput> = {}): BuildPhase7MicrotradePreflightInput {
  return {
    repoSha: "c04a51b",
    phase7AuditStatus: "verified-ready",
    signoffStatus: "signed-for-controlled-microtrade",
    devnetProofStatus: "confirmed-reconciled",
    releaseCandidateStatus: "complete-blocked-live",
    burnerWalletAddress: BURNER,
    maxSpendCapLamports: 1_000_000,
    manualConfirmationLabel: "operator confirms the single trade by hand at send time",
    quoteFreshnessStatus: "fresh",
    riskStatus: "clear",
    token2022BlockerStatus: "none",
    simulationStatus: "simulated-ok",
    ...overrides,
  };
}

describe("phase7 micro-trade preflight — blocked prerequisites", () => {
  it("a missing sign-off blocks (the most fundamental gate)", () => {
    for (const s of ["absent", "present-not-signed"] as const) {
      const r = buildPhase7MicrotradePreflight(readyInput({ signoffStatus: s }));
      expect(r.preflightVerdict, s).toBe("blocked-missing-signoff");
      expect(r.missingRequirements.length, s).toBeGreaterThan(0);
      expect(() => validatePhase7MicrotradePreflight(r), s).not.toThrow();
    }
  });

  it("a missing devnet proof blocks once the sign-off is present", () => {
    for (const d of ["absent", "present-not-confirmed"] as const) {
      const r = buildPhase7MicrotradePreflight(readyInput({ devnetProofStatus: d }));
      expect(r.preflightVerdict, d).toBe("blocked-missing-devnet-proof");
    }
  });

  it("a missing / incomplete release candidate blocks", () => {
    for (const rc of ["absent", "error", "incomplete", "blocked-build"] as const) {
      const r = buildPhase7MicrotradePreflight(readyInput({ releaseCandidateStatus: rc }));
      expect(r.preflightVerdict, rc).toBe("blocked-missing-release-candidate");
    }
  });

  it("a release candidate blocked on risk maps to blocked-risk", () => {
    const r = buildPhase7MicrotradePreflight(readyInput({ releaseCandidateStatus: "blocked-risk", riskStatus: "rejected" }));
    expect(r.preflightVerdict).toBe("blocked-risk");
    expect(r.riskStatus).toBe("rejected");
  });

  it("a release candidate blocked on a stale quote maps to blocked-quote", () => {
    const r = buildPhase7MicrotradePreflight(readyInput({ releaseCandidateStatus: "blocked-quote", quoteFreshnessStatus: "stale" }));
    expect(r.preflightVerdict).toBe("blocked-quote");
  });

  it("a release candidate blocked on simulation maps to blocked-simulation", () => {
    const r = buildPhase7MicrotradePreflight(readyInput({ releaseCandidateStatus: "blocked-simulation", simulationStatus: "failed" }));
    expect(r.preflightVerdict).toBe("blocked-simulation");
  });

  it("a missing burner wallet blocks once the trade-evidence chain is complete", () => {
    const r = buildPhase7MicrotradePreflight(readyInput({ burnerWalletAddress: null }));
    expect(r.preflightVerdict).toBe("blocked-missing-burner-wallet");
    expect(r.burnerWalletStatus).toBe("absent");
    expect(r.burnerWalletAddress).toBeNull();
  });

  it("a missing manual-confirmation label blocks last", () => {
    const r = buildPhase7MicrotradePreflight(readyInput({ manualConfirmationLabel: null }));
    expect(r.preflightVerdict).toBe("blocked-missing-manual-confirmation");
    expect(r.manualConfirmationStatus).toBe("absent");
  });

  it("a blank / whitespace manual-confirmation label is treated as absent (cannot fake presence)", () => {
    const r = buildPhase7MicrotradePreflight(readyInput({ manualConfirmationLabel: "   " }));
    expect(r.manualConfirmationStatus).toBe("absent");
    expect(r.preflightVerdict).toBe("blocked-missing-manual-confirmation");
  });
});

describe("phase7 micro-trade preflight — ready, but authorizes nothing", () => {
  it("the happy fixture reaches ready-for-separate-execution-authorization", () => {
    const r = buildPhase7MicrotradePreflight(readyInput());
    expect(r.preflightVerdict).toBe("ready-for-separate-execution-authorization");
    expect(r.missingRequirements).toEqual([]);
    expect(r.maxSpendCapLamports).toBe(1_000_000);
    expect(r.maxSpendCapSol).toBe(0.001);
    expect(r.burnerWalletAddress).toBe(BURNER);
    // Even at the best verdict, every no-execute / no-authorize lock holds.
    expect(r.liveExecutionAuthorized).toBe(false);
    expect(r.authorizesLiveTrading).toBe(false);
    expect(r.requiresSeparateExecutionApproval).toBe(true);
    expect(r.neverSends).toBe(true);
    expect(r.neverSigns).toBe(true);
    expect(r.notExecutable).toBe(true);
    expect(r.phase7LiveTradingReady).toBe(false);
    expect(r.killSwitchStatus).toBe("required-at-execution");
    expect(r.reconciliationRequirement).toBe("required-post-trade");
    expect(() => validatePhase7MicrotradePreflight(r)).not.toThrow();
  });

  it("the mode and network are pinned mainnet micro-trade preflight literals", () => {
    const r = buildPhase7MicrotradePreflight(readyInput());
    expect(r.mode).toBe("controlled-mainnet-microtrade-preflight");
    expect(r.network).toBe("mainnet-beta");
  });
});

describe("phase7 micro-trade preflight — input safety", () => {
  it("refuses a max-spend over the micro ceiling", () => {
    expect(() => buildPhase7MicrotradePreflight(readyInput({ maxSpendCapLamports: PHASE7_MICROTRADE_PREFLIGHT_MAX_SPEND_LAMPORTS + 1 }))).toThrow(/ceiling/);
  });

  it("refuses an invalid burner wallet (not a 32-byte public key)", () => {
    expect(() => buildPhase7MicrotradePreflight(readyInput({ burnerWalletAddress: "not-base58-!!!" }))).toThrow(Phase7MicrotradePreflightError);
  });

  it("refuses an over-long burner value (a secret key / signature is never accepted)", () => {
    expect(() => buildPhase7MicrotradePreflight(readyInput({ burnerWalletAddress: "1".repeat(88) }))).toThrow(/too long to be a public key/);
  });

  it("refuses a signed micro-trade sign-off with no bounded max-spend", () => {
    expect(() => buildPhase7MicrotradePreflight(readyInput({ maxSpendCapLamports: null }))).toThrow(/bounded maxSpendCapLamports/);
  });

  it("refuses an inconsistent release-candidate echo (complete but risk not clear)", () => {
    expect(() => buildPhase7MicrotradePreflight(readyInput({ riskStatus: "rejected" }))).toThrow(/complete-blocked-live release candidate requires riskStatus=clear/);
  });

  it("refuses a non-mainnet network", () => {
    expect(() => buildPhase7MicrotradePreflight(readyInput({ network: "devnet" }))).toThrow(/mainnet only/);
  });
});

describe("phase7 micro-trade preflight — validator parity wall", () => {
  it("rejects an unknown field (closed schema) — a smuggled send result / signature is refused", () => {
    const v = buildPhase7MicrotradePreflight(readyInput()) as unknown as Record<string, unknown>;
    v["sendResult"] = { signature: "x".repeat(88) };
    expect(() => validatePhase7MicrotradePreflight(v)).toThrow(/CLOSED/);

    const v2 = buildPhase7MicrotradePreflight(readyInput()) as unknown as Record<string, unknown>;
    v2["signature"] = "x".repeat(88);
    expect(() => validatePhase7MicrotradePreflight(v2)).toThrow(/CLOSED/);
  });

  it("refuses a tampered verdict that outruns the evidence", () => {
    const v = buildPhase7MicrotradePreflight(readyInput({ signoffStatus: "absent" })) as unknown as Record<string, unknown>;
    expect(v["preflightVerdict"]).toBe("blocked-missing-signoff");
    v["preflightVerdict"] = "ready-for-separate-execution-authorization";
    expect(() => validatePhase7MicrotradePreflight(v)).toThrow(/re-derived/);
  });

  it("refuses a ready verdict carrying a non-empty missingRequirements set", () => {
    const v = buildPhase7MicrotradePreflight(readyInput()) as unknown as Record<string, unknown>;
    v["missingRequirements"] = ["something still missing"];
    expect(() => validatePhase7MicrotradePreflight(v)).toThrow(/no missingRequirements/);
  });

  it("refuses a valid-public-key status with a null address (and vice versa)", () => {
    const v = buildPhase7MicrotradePreflight(readyInput()) as unknown as Record<string, unknown>;
    v["burnerWalletAddress"] = null;
    expect(() => validatePhase7MicrotradePreflight(v)).toThrow(Phase7MicrotradePreflightError);

    const v2 = buildPhase7MicrotradePreflight(readyInput({ burnerWalletAddress: null })) as unknown as Record<string, unknown>;
    v2["burnerWalletStatus"] = "valid-public-key";
    expect(() => validatePhase7MicrotradePreflight(v2)).toThrow(Phase7MicrotradePreflightError);
  });

  it("refuses each flipped safety lock", () => {
    for (const [field, bad] of [
      ["liveExecutionAuthorized", true],
      ["authorizesLiveTrading", true],
      ["requiresSeparateExecutionApproval", false],
      ["neverSends", false],
      ["neverSigns", false],
      ["notExecutable", false],
      ["phase7LiveTradingReady", true],
      ["redactionApplied", false],
    ] as const) {
      const v = buildPhase7MicrotradePreflight(readyInput()) as unknown as Record<string, unknown>;
      v[field] = bad;
      expect(() => validatePhase7MicrotradePreflight(v), field).toThrow(Phase7MicrotradePreflightError);
    }
  });

  it("refuses a flipped kill-switch / reconciliation requirement literal", () => {
    const v = buildPhase7MicrotradePreflight(readyInput()) as unknown as Record<string, unknown>;
    v["killSwitchStatus"] = "armed";
    expect(() => validatePhase7MicrotradePreflight(v)).toThrow(/killSwitchStatus/);
  });

  it("derives the verdict purely from the structured statuses (no score participates)", () => {
    expect(
      derivePhase7MicrotradePreflightVerdict({
        signoffStatus: "signed-for-controlled-microtrade",
        devnetProofStatus: "confirmed-reconciled",
        releaseCandidateStatus: "complete-blocked-live",
        burnerWalletStatus: "valid-public-key",
        manualConfirmationStatus: "present",
      }),
    ).toBe("ready-for-separate-execution-authorization");
  });
});
