/**
 * READY-FOR-HUMAN-CANARY REPORT (`live.operator.human_canary_readiness.v1`, Sprint 109, Part 3).
 *
 * The truthful Phase-8 artifact: states EXACTLY how far the workflow has been proven and whether a
 * REAL canary has been executed — and refuses to claim one that has not. `realCanaryExecuted` is
 * NOT an input: it is DERIVED from evidence (a validated reconciliation whose canary reached
 * confirmed/finalized WITH a signature recorded). No evidence ⇒ `false`, with the honest reason
 * pinned. This artifact authorizes nothing; it exists so "ready for a human canary" is a machine-
 * checkable claim instead of a sentence in a doc.
 */

import { assertNoSecretMaterial } from "./operator-config.js";
import type { LiveOperatorConfig } from "./operator-config.js";
import { evaluateOperatorConfig } from "./operator-config.js";
import type { OperatorReconciliationRecord } from "./operator-reconcile.js";

export const LIVE_HUMAN_CANARY_READINESS_SCHEMA_VERSION = "live.operator.human_canary_readiness.v1";

export const HUMAN_CANARY_READINESS_VERDICTS = [
  "ready-for-human-canary", // workflow proven end-to-end; only the human + funded wallet are missing
  "not-ready", // one or more workflow prerequisites are missing
  "canary-executed-and-reconciled", // a real canary happened AND reconciled with evidence
] as const;
export type HumanCanaryReadinessVerdict = (typeof HUMAN_CANARY_READINESS_VERDICTS)[number];

/** The workflow steps the report attests. Each is a boolean the CALLER proves, listed honestly. */
export interface HumanCanaryWorkflowChecks {
  configValidated: boolean;
  sessionJournalWorks: boolean;
  observeRunProven: boolean;
  paperShadowRunProven: boolean;
  armedRecommendationProven: boolean;
  reconciliationPathProven: boolean;
  dashboardBuilt: boolean;
  alertsAvailable: boolean;
}

export interface HumanCanaryReadinessReport {
  schemaVersion: typeof LIVE_HUMAN_CANARY_READINESS_SCHEMA_VERSION;
  generatedAt: string;
  operatorLabel: string;
  configMode: string;
  checks: HumanCanaryWorkflowChecks;
  /** DERIVED — true only when reconciliation evidence proves a settled, signed canary. */
  realCanaryExecuted: boolean;
  /** The honest explanation for the realCanaryExecuted value. */
  realCanaryStatusNote: string;
  verdict: HumanCanaryReadinessVerdict;
  missing: string[];
  /** What a human must bring to execute the canary (never automated away). */
  humanPrerequisites: string[];
  /** Pinned honesty literals. */
  requiresHumanPhantomApproval: true;
  backendCustodiesNoKeys: true;
  backendNeverSends: true;
  largeTradesEnabled: false;
  notProfitabilityClaim: true;
}

export class HumanReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanReadinessError";
  }
}

const HUMAN_PREREQUISITES = [
  "a dedicated BURNER Phantom wallet (tiny funding only; never a main wallet)",
  "tiny SOL funding (the canary spend + fees; nothing more)",
  "a human at the keyboard who reviews the recommendation and clicks Approve/Reject in Phantom",
  "time to reconcile immediately after (live:operator:reconcile) and to stop on anything odd",
];

export interface BuildHumanReadinessInput {
  generatedAt: string;
  config: LiveOperatorConfig;
  checks: HumanCanaryWorkflowChecks;
  /** Optional evidence: a validated operator reconciliation for a REAL canary attempt. */
  reconciliation: OperatorReconciliationRecord | null;
}

export function buildHumanCanaryReadiness(input: BuildHumanReadinessInput): HumanCanaryReadinessReport {
  const validation = evaluateOperatorConfig(input.config);

  // realCanaryExecuted is DERIVED, never asserted: it needs a reconciliation whose embedded canary
  // reached confirmed/finalized with a signature (the builder already refuses a signatureless one).
  const rec = input.reconciliation;
  const settled = rec !== null && (rec.canary.status === "confirmed" || rec.canary.status === "finalized") && rec.canary.signature !== null;
  const realCanaryExecuted = settled === true;
  const realCanaryStatusNote = realCanaryExecuted
    ? `a real canary reconciled with status "${rec!.canary.status}" at slot ${rec!.canary.slot ?? "unknown"} (confidence ${rec!.confidence})`
    : rec !== null
      ? `a reconciliation exists but its status is "${rec.canary.status}" — that is NOT a settled canary, so none is claimed`
      : "NO real canary has been executed — no human operator with a funded burner Phantom wallet was available. This is stated, not hidden.";

  const missing: string[] = [];
  const checkEntries: Array<[keyof HumanCanaryWorkflowChecks, string]> = [
    ["configValidated", "operator config validated (live:operator:validate)"],
    ["sessionJournalWorks", "session journal start/status/export proven (live:operator:session:*)"],
    ["observeRunProven", "observe_only run proven (live:operator:run --mode observe_only)"],
    ["paperShadowRunProven", "paper_shadow run proven (live:operator:run --mode paper_shadow)"],
    ["armedRecommendationProven", "armed_canary recommendation path proven (recommend-only)"],
    ["reconciliationPathProven", "reconciliation + PnL accounting path proven (live:operator:reconcile)"],
    ["dashboardBuilt", "operator dashboard built (apps/web/public/operator-dashboard.html)"],
    ["alertsAvailable", "alert hooks available (disabled by default)"],
  ];
  for (const [key, label] of checkEntries) {
    if (input.checks[key] !== true) missing.push(label);
  }

  let verdict: HumanCanaryReadinessVerdict;
  if (realCanaryExecuted) verdict = "canary-executed-and-reconciled";
  else if (missing.length === 0) verdict = "ready-for-human-canary";
  else verdict = "not-ready";

  const report: HumanCanaryReadinessReport = {
    schemaVersion: LIVE_HUMAN_CANARY_READINESS_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    operatorLabel: validation.operatorLabel,
    configMode: validation.mode,
    checks: { ...input.checks },
    realCanaryExecuted,
    realCanaryStatusNote,
    verdict,
    missing,
    humanPrerequisites: [...HUMAN_PREREQUISITES],
    requiresHumanPhantomApproval: true,
    backendCustodiesNoKeys: true,
    backendNeverSends: true,
    largeTradesEnabled: false,
    notProfitabilityClaim: true,
  };
  assertNoSecretMaterial(report, "readiness report");
  return report;
}

const READINESS_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "generatedAt",
  "operatorLabel",
  "configMode",
  "checks",
  "realCanaryExecuted",
  "realCanaryStatusNote",
  "verdict",
  "missing",
  "humanPrerequisites",
  "requiresHumanPhantomApproval",
  "backendCustodiesNoKeys",
  "backendNeverSends",
  "largeTradesEnabled",
  "notProfitabilityClaim",
]);

/** Strict validation: closed schema, pinned literals, and verdict consistency re-checked. */
export function validateHumanCanaryReadiness(value: unknown): HumanCanaryReadinessReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HumanReadinessError("readiness report must be a JSON object");
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!READINESS_KEYS.has(key)) throw new HumanReadinessError(`readiness report carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (obj.schemaVersion !== LIVE_HUMAN_CANARY_READINESS_SCHEMA_VERSION) {
    throw new HumanReadinessError(`readiness report schemaVersion must be "${LIVE_HUMAN_CANARY_READINESS_SCHEMA_VERSION}"`);
  }
  for (const pin of ["requiresHumanPhantomApproval", "backendCustodiesNoKeys", "backendNeverSends", "notProfitabilityClaim"] as const) {
    if (obj[pin] !== true) throw new HumanReadinessError(`readiness report.${pin} must be the literal true`);
  }
  if (obj.largeTradesEnabled !== false) throw new HumanReadinessError("readiness report.largeTradesEnabled must be the literal false");
  if (!(HUMAN_CANARY_READINESS_VERDICTS as readonly string[]).includes(obj.verdict as string)) {
    throw new HumanReadinessError(`readiness verdict must be one of ${HUMAN_CANARY_READINESS_VERDICTS.join(" | ")}`);
  }
  // Verdict consistency: a "canary executed" claim requires realCanaryExecuted, and vice versa.
  if ((obj.verdict === "canary-executed-and-reconciled") !== (obj.realCanaryExecuted === true)) {
    throw new HumanReadinessError("readiness verdict and realCanaryExecuted disagree — refused");
  }
  if (obj.verdict === "ready-for-human-canary" && Array.isArray(obj.missing) && obj.missing.length > 0) {
    throw new HumanReadinessError("readiness verdict claims ready but lists missing prerequisites — refused");
  }
  return obj as unknown as HumanCanaryReadinessReport;
}
