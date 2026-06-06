/**
 * Scenario validation + linting for the deterministic, offline, simulated-only
 * paper backtest.
 *
 * Two complementary entry points, both **pure** (no network, no RPC, no wallet,
 * no filesystem, no `Date.now`, no `Math.random`) and non-mutating:
 *
 *  - {@link collectScenarioIssues} — the structural validation CORE. It collects
 *    every blocking structural problem (it never throws) and, when there are
 *    none, returns the narrowed {@link BacktestScenario}. `validateBacktestScenario`
 *    (in `backtest.ts`) is a thin throw-the-first-error wrapper over it, so the
 *    validator and the linter can never disagree about what is structurally valid.
 *
 *  - {@link lintBacktestScenario} — a structured pre-flight check a user can run
 *    BEFORE a backtest. It returns `{ valid, errors, warnings, summary }`:
 *    `errors` are things that PREVENT a run (structural problems + a malformed
 *    embedded journal); `warnings` are suspicious-but-allowed scenario designs.
 *    It never runs the backtest and never mutates its input.
 */

import {
  deriveStateFromJournalText,
  openPositionCount,
  type PaperRiskCaps,
  type PaperState,
} from "@soulmaker/paper";
import type { StrategyCandidate } from "@soulmaker/strategy";
import type {
  BacktestLintIssue,
  BacktestScenario,
  BacktestScenarioLintResult,
  BacktestScenarioLintSummary,
  BacktestStep,
} from "./types.js";

// --- small, local type guards (shared by validation + warnings) --------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// --- structural validation core ---------------------------------------------

type Issues = BacktestLintIssue[];

function push(issues: Issues, code: string, message: string, path?: string): void {
  issues.push(path === undefined ? { code, message } : { code, message, path });
}

function collectStrategyConfig(value: unknown, issues: Issues): void {
  if (!isObject(value)) {
    push(issues, "strategy-config-not-object", "scenario.strategyConfig must be an object", "strategyConfig");
    return;
  }
  for (const key of ["minScoreForPaperBuy", "minScoreForWatch", "maxRiskScore"] as const) {
    if (!isFiniteNumber(value[key])) {
      push(
        issues,
        "strategy-config-field",
        `scenario.strategyConfig.${key} must be a finite number`,
        `strategyConfig.${key}`,
      );
    }
  }
}

function collectCaps(value: unknown, issues: Issues): void {
  if (!isObject(value)) {
    push(issues, "caps-not-object", "scenario.caps must be an object", "caps");
    return;
  }
  for (const key of ["maxTradeSizeUsd", "maxDailyLossUsd"] as const) {
    const v = value[key];
    if (!isFiniteNumber(v) || v < 0) {
      push(issues, "caps-field", `scenario.caps.${key} must be a non-negative number`, `caps.${key}`);
    }
  }
  const maxOpen = value.maxOpenPositions;
  if (!isFiniteNumber(maxOpen) || maxOpen < 0 || !Number.isInteger(maxOpen)) {
    push(
      issues,
      "caps-max-open",
      "scenario.caps.maxOpenPositions must be a non-negative integer",
      "caps.maxOpenPositions",
    );
  }
  if (value.killSwitch !== undefined && typeof value.killSwitch !== "boolean") {
    push(issues, "caps-kill-switch", "scenario.caps.killSwitch must be a boolean when present", "caps.killSwitch");
  }
  if (
    value.maxPositionSizeUsd !== undefined &&
    (!isFiniteNumber(value.maxPositionSizeUsd) || value.maxPositionSizeUsd < 0)
  ) {
    push(
      issues,
      "caps-max-position-size",
      "scenario.caps.maxPositionSizeUsd must be a non-negative number when present",
      "caps.maxPositionSizeUsd",
    );
  }
}

function collectStep(value: unknown, index: number, issues: Issues): void {
  const at = `steps[${index}]`;
  if (!isObject(value)) {
    push(issues, "step-not-object", `scenario.steps[${index}] must be an object`, at);
    return;
  }
  if (!nonEmptyString(value.id)) {
    push(issues, "step-id", `scenario.steps[${index}].id must be a non-empty string`, `${at}.id`);
  }
  if (!nonEmptyString(value.at)) {
    push(issues, "step-at", `scenario.steps[${index}].at must be a non-empty string`, `${at}.at`);
  }
  if (!Array.isArray(value.candidates)) {
    push(issues, "step-candidates", `scenario.steps[${index}].candidates must be an array`, `${at}.candidates`);
  } else {
    value.candidates.forEach((c, ci) => {
      if (!isObject(c) || !nonEmptyString(c.mint)) {
        push(
          issues,
          "candidate-mint",
          `scenario.steps[${index}].candidates[${ci}].mint must be a non-empty string`,
          `${at}.candidates[${ci}].mint`,
        );
      }
    });
  }
  if (!Array.isArray(value.prices)) {
    push(issues, "step-prices", `scenario.steps[${index}].prices must be an array`, `${at}.prices`);
  } else {
    value.prices.forEach((p, pi) => {
      if (!isObject(p) || !nonEmptyString(p.mint)) {
        push(
          issues,
          "price-mint",
          `scenario.steps[${index}].prices[${pi}].mint must be a non-empty string`,
          `${at}.prices[${pi}].mint`,
        );
      } else if (!isFiniteNumber(p.priceUsd)) {
        push(
          issues,
          "price-value",
          `scenario.steps[${index}].prices[${pi}].priceUsd must be a finite number`,
          `${at}.prices[${pi}].priceUsd`,
        );
      } else if (!nonEmptyString(p.observedAt)) {
        push(
          issues,
          "price-observed-at",
          `scenario.steps[${index}].prices[${pi}].observedAt must be a non-empty string`,
          `${at}.prices[${pi}].observedAt`,
        );
      }
    });
  }
  for (const key of ["takeProfitPct", "stopLossPct"] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) {
      push(
        issues,
        "step-exit-threshold",
        `scenario.steps[${index}].${key} must be a finite number when present`,
        `${at}.${key}`,
      );
    }
  }
}

/**
 * Collect every blocking structural problem in `input` WITHOUT throwing. When
 * there are none, the returned `scenario` is the narrowed {@link BacktestScenario}
 * (and `errors` is empty); otherwise `scenario` is null. The check order matches
 * the historical throwing validator so `errors[0]` is the message it would have
 * thrown first. Pure: it never mutates `input`.
 */
export function collectScenarioIssues(input: unknown): {
  errors: BacktestLintIssue[];
  scenario: BacktestScenario | null;
} {
  const errors: Issues = [];
  if (!isObject(input)) {
    push(errors, "scenario-not-object", "scenario must be a JSON object");
    return { errors, scenario: null };
  }

  if (!nonEmptyString(input.name)) {
    push(errors, "scenario-name", "scenario.name must be a non-empty string", "name");
  }
  collectStrategyConfig(input.strategyConfig, errors);
  collectCaps(input.caps, errors);

  if (!Array.isArray(input.steps)) {
    push(errors, "steps-not-array", "scenario.steps must be an array", "steps");
  } else if (input.steps.length === 0) {
    push(errors, "steps-empty", "scenario.steps must not be empty", "steps");
  } else {
    input.steps.forEach((s, i) => collectStep(s, i, errors));
  }

  if (input.initialJournal !== undefined && typeof input.initialJournal !== "string") {
    push(errors, "initial-journal-type", "scenario.initialJournal must be a string (JSONL) when present", "initialJournal");
  }
  if (
    input.defaultPaperSizeUsd !== undefined &&
    (!isFiniteNumber(input.defaultPaperSizeUsd) || input.defaultPaperSizeUsd < 0)
  ) {
    push(
      errors,
      "default-size",
      "scenario.defaultPaperSizeUsd must be a non-negative number when present",
      "defaultPaperSizeUsd",
    );
  }

  if (errors.length > 0) return { errors, scenario: null };

  // No structural errors: narrow exactly as the historical validator did.
  const scenario: BacktestScenario = {
    name: input.name as string,
    strategyConfig: input.strategyConfig as BacktestScenario["strategyConfig"],
    caps: input.caps as BacktestScenario["caps"],
    steps: input.steps as BacktestStep[],
  };
  if (typeof input.initialJournal === "string") scenario.initialJournal = input.initialJournal;
  if (isFiniteNumber(input.defaultPaperSizeUsd)) scenario.defaultPaperSizeUsd = input.defaultPaperSizeUsd;
  return { errors, scenario };
}

// --- warning computation -----------------------------------------------------

/** Extreme exit thresholds and "very large" array bounds (suspicious, not invalid). */
const TAKE_PROFIT_EXTREME_PCT = 1000;
const STOP_LOSS_EXTREME_PCT = 100;
const LARGE_CANDIDATE_ARRAY = 500;

function candidateMints(step: BacktestStep): string[] {
  return (step.candidates as StrategyCandidate[]).map((c) => c.mint).filter((m): m is string => typeof m === "string");
}

function anyPositiveProposedSize(scenario: BacktestScenario): boolean {
  for (const step of scenario.steps) {
    for (const c of step.candidates as StrategyCandidate[]) {
      if (typeof c.proposedSizeUsd === "number" && c.proposedSizeUsd > 0) return true;
    }
  }
  return false;
}

/** A read-only view of caps that may carry the optional fields as raw JSON. */
type CapsView = PaperRiskCaps & { allowCautionRiskReports?: boolean };

/**
 * Compute suspicious-but-allowed warnings for a structurally-VALID scenario. Pure
 * and deterministic; never mutates the scenario. A malformed embedded journal is
 * handled by the caller as an ERROR (not here) — when the journal does not parse
 * cleanly, journal-derived warnings are simply skipped.
 */
export function computeScenarioWarnings(scenario: BacktestScenario): BacktestLintIssue[] {
  const warnings: Issues = [];
  const caps = scenario.caps as CapsView;

  // Global safety posture.
  if (caps.killSwitch === true) {
    push(warnings, "kill-switch-on", "caps.killSwitch is on — no simulated trade will occur in this scenario", "caps.killSwitch");
  }
  if (caps.allowCautionRiskReports === true) {
    push(
      warnings,
      "allow-caution",
      "caps.allowCautionRiskReports is on — CAUTION risk reports are allowed into paper evaluation",
      "caps.allowCautionRiskReports",
    );
  }
  if (caps.maxTradeSizeUsd === 0 || caps.maxOpenPositions === 0) {
    push(
      warnings,
      "zero-caps-no-buys",
      "caps guarantee no simulated buys (maxTradeSizeUsd or maxOpenPositions is 0)",
      "caps",
    );
  }

  // Sizing semantics.
  const defaultSizePositive =
    typeof scenario.defaultPaperSizeUsd === "number" && scenario.defaultPaperSizeUsd > 0;
  if (!defaultSizePositive && !anyPositiveProposedSize(scenario)) {
    push(
      warnings,
      "no-sizing",
      "no positive defaultPaperSizeUsd and no candidate carries a positive proposedSizeUsd — no simulated buy can be sized, so the scenario can open no positions",
    );
  }
  if (
    defaultSizePositive &&
    typeof caps.maxTradeSizeUsd === "number" &&
    (scenario.defaultPaperSizeUsd as number) > caps.maxTradeSizeUsd
  ) {
    push(
      warnings,
      "default-size-exceeds-max-trade",
      `defaultPaperSizeUsd (${scenario.defaultPaperSizeUsd}) exceeds caps.maxTradeSizeUsd (${caps.maxTradeSizeUsd}) — default-sized buys will be rejected by caps`,
      "defaultPaperSizeUsd",
    );
  }

  // Per-step structure.
  const seenStepIds = new Map<string, number>();
  let prevAt: string | null = null;
  scenario.steps.forEach((step, i) => {
    const at = `steps[${i}]`;

    const firstSeen = seenStepIds.get(step.id);
    if (firstSeen !== undefined) {
      push(warnings, "duplicate-step-id", `duplicate step id "${step.id}" (also at steps[${firstSeen}])`, `${at}.id`);
    } else {
      seenStepIds.set(step.id, i);
    }

    // Lexicographic comparison is chronological for ISO-8601 UTC timestamps.
    if (prevAt !== null && step.at <= prevAt) {
      push(
        warnings,
        "non-monotonic-timestamp",
        `step timestamp "${step.at}" is not after the previous step's "${prevAt}"`,
        `${at}.at`,
      );
    }
    prevAt = step.at;

    const candidates = step.candidates as StrategyCandidate[];
    if (candidates.length === 0) {
      push(warnings, "empty-candidates", `step "${step.id}" has no candidates`, `${at}.candidates`);
    } else if (candidates.length > LARGE_CANDIDATE_ARRAY) {
      push(
        warnings,
        "large-candidate-array",
        `step "${step.id}" has ${candidates.length} candidates (> ${LARGE_CANDIDATE_ARRAY})`,
        `${at}.candidates`,
      );
    }
    if (step.prices.length === 0) {
      push(warnings, "empty-prices", `step "${step.id}" has no injected prices`, `${at}.prices`);
    }

    // Duplicate mints within a step's candidate array.
    const seenMints = new Set<string>();
    const dupMints = new Set<string>();
    for (const m of candidateMints(step)) {
      if (seenMints.has(m)) dupMints.add(m);
      else seenMints.add(m);
    }
    for (const m of [...dupMints].sort()) {
      push(warnings, "duplicate-mint-in-step", `step "${step.id}" lists mint ${m} more than once`, `${at}.candidates`);
    }

    // Candidates present but no injected price matches any candidate mint.
    if (candidates.length > 0 && step.prices.length > 0) {
      const priceMints = new Set(step.prices.map((p) => p.mint));
      const anyMatch = [...seenMints].some((m) => priceMints.has(m));
      if (!anyMatch) {
        push(
          warnings,
          "no-matching-prices",
          `step "${step.id}" has candidates but no injected price matches any candidate mint`,
          `${at}.prices`,
        );
      }
    }

    // Extreme / disabled-by-value exit thresholds.
    if (step.takeProfitPct !== undefined && (step.takeProfitPct <= 0 || step.takeProfitPct >= TAKE_PROFIT_EXTREME_PCT)) {
      push(
        warnings,
        "extreme-take-profit",
        `step "${step.id}" takeProfitPct ${step.takeProfitPct} is extreme or disabled-by-value (<= 0 is treated as disabled)`,
        `${at}.takeProfitPct`,
      );
    }
    if (step.stopLossPct !== undefined && (step.stopLossPct <= 0 || step.stopLossPct >= STOP_LOSS_EXTREME_PCT)) {
      push(
        warnings,
        "extreme-stop-loss",
        `step "${step.id}" stopLossPct ${step.stopLossPct} is extreme or disabled-by-value (<= 0 is treated as disabled)`,
        `${at}.stopLossPct`,
      );
    }
  });

  // Embedded-journal warnings (only when the journal parses cleanly).
  if (scenario.initialJournal !== undefined) {
    const derived = deriveStateFromJournalText(scenario.initialJournal);
    if (derived.parseErrors.length === 0 && derived.fillErrors.length === 0) {
      warnings.push(...journalWarnings(derived.state));
    }
  }

  return warnings;
}

function journalWarnings(state: PaperState): BacktestLintIssue[] {
  const out: Issues = [];
  const open = openPositionCount(state);
  if (open > 0) {
    push(
      out,
      "initial-journal-open-positions",
      `initialJournal seeds ${open} open simulated position(s) before step 1`,
      "initialJournal",
    );
  }
  if (state.realizedPnlUsd !== 0) {
    push(
      out,
      "initial-journal-realized-pnl",
      `initialJournal carries ${state.realizedPnlUsd} realized simulated PnL before step 1`,
      "initialJournal",
    );
  }
  return out;
}

// --- public linter -----------------------------------------------------------

function summaryOf(
  input: unknown,
  scenario: BacktestScenario | null,
  errorCount: number,
  warningCount: number,
): BacktestScenarioLintSummary {
  // Prefer the narrowed scenario; otherwise read best-effort from raw input.
  const raw = isObject(input) ? input : {};
  const name =
    scenario?.name ?? (typeof raw.name === "string" && raw.name.length > 0 ? raw.name : null);
  const steps = scenario?.steps ?? (Array.isArray(raw.steps) ? (raw.steps as unknown[]) : []);
  let candidateCount = 0;
  let priceCount = 0;
  for (const s of steps) {
    if (isObject(s)) {
      if (Array.isArray(s.candidates)) candidateCount += s.candidates.length;
      if (Array.isArray(s.prices)) priceCount += s.prices.length;
    }
  }
  return {
    name,
    stepCount: steps.length,
    candidateCount,
    priceCount,
    hasInitialJournal:
      scenario?.initialJournal !== undefined || typeof raw.initialJournal === "string",
    errorCount,
    warningCount,
  };
}

/**
 * Lint a backtest scenario WITHOUT running it. Returns blocking `errors`
 * (structural problems + a malformed embedded journal), suspicious `warnings`,
 * and a compact `summary`. Pure, deterministic, and non-mutating. `valid` is
 * true iff there are zero errors — a valid scenario may still carry warnings.
 */
export function lintBacktestScenario(input: unknown): BacktestScenarioLintResult {
  const { errors, scenario } = collectScenarioIssues(input);
  const warnings: Issues = [];

  if (scenario) {
    // A structurally-valid scenario can still embed a malformed journal — that
    // PREVENTS a run, so it is an error (mirrors runBacktest's refusal).
    if (scenario.initialJournal !== undefined) {
      const derived = deriveStateFromJournalText(scenario.initialJournal);
      if (derived.parseErrors.length > 0) {
        const first = derived.parseErrors[0];
        push(
          errors,
          "initial-journal-malformed",
          `scenario.initialJournal is malformed: ${derived.parseErrors.length} bad line(s); first at line ${first?.line}: ${first?.reason}`,
          "initialJournal",
        );
      } else if (derived.fillErrors.length > 0) {
        const first = derived.fillErrors[0];
        push(
          errors,
          "initial-journal-invalid-fill",
          `scenario.initialJournal has ${derived.fillErrors.length} invalid fill event(s); first at event index ${first?.index}: ${first?.reason}`,
          "initialJournal",
        );
      }
    }
    warnings.push(...computeScenarioWarnings(scenario));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: summaryOf(input, scenario, errors.length, warnings.length),
  };
}
