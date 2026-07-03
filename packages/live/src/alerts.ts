/**
 * LOCAL OPERATOR ALERT HOOKS (`live.operator.alert.v1`, Sprint 109, Part 3).
 *
 * Safe, LOCAL-ONLY alerting for the supervised operator loop. Two sinks exist and BOTH are
 * disabled by default:
 *
 *   - console : one redacted line per alert on stdout;
 *   - file    : one webhook-style JSON payload per line appended to a local JSONL file, ready for
 *               an OPERATOR-OWNED forwarder (curl, systemd unit, cron) to relay wherever they like.
 *
 * Network sinks (Discord/Telegram webhooks) are deliberately NOT implemented here: a webhook URL
 * is a secret, posting is a network side effect, and this codebase keeps its no-secret /
 * no-surprise-network guarantees. The file sink gives operators the same payloads without either
 * risk; the runbook shows a two-line forwarder.
 *
 * Every alert payload is deep-scanned (sensitive keys / secret-shaped values / control chars are
 * refused) and carries pinned honesty literals. Pure module: the CLI owns the actual I/O.
 */

import { redactString } from "@soulmaker/security";

import { assertNoSecretMaterial } from "./operator-config.js";

export const LIVE_OPERATOR_ALERT_SCHEMA_VERSION = "live.operator.alert.v1";

/** The CLOSED alert vocabulary — one entry per operator-visible lifecycle moment. */
export const OPERATOR_ALERT_KINDS = [
  "candidate_found",
  "risk_rejected",
  "canary_recommended",
  "phantom_approval_pending",
  "phantom_submitted",
  "phantom_confirmed",
  "reconciliation_complete",
  "kill_switch_engaged",
  "emergency_stop_engaged",
  "session_paused",
] as const;
export type OperatorAlertKind = (typeof OPERATOR_ALERT_KINDS)[number];

export interface OperatorAlert {
  schemaVersion: typeof LIVE_OPERATOR_ALERT_SCHEMA_VERSION;
  kind: OperatorAlertKind;
  sessionId: string | null;
  at: string;
  /** Short redaction-safe human line. */
  detail: string;
  /** Optional small structured payload (deep-scanned). */
  data: Record<string, unknown> | null;
  /** Pinned honesty literals. */
  alertIsInformationalOnly: true;
  backendNeverSends: true;
}

/** Sink configuration. EVERYTHING defaults to off. */
export interface OperatorAlertSinks {
  console: boolean;
  /** Absolute/relative path of a local JSONL file, or null (off). */
  webhookFilePath: string | null;
}

export const OPERATOR_ALERT_SINKS_DEFAULT: OperatorAlertSinks = { console: false, webhookFilePath: null };

export class OperatorAlertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorAlertError";
  }
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_DETAIL_CHARS = 300;

export interface BuildAlertInput {
  kind: OperatorAlertKind;
  sessionId?: string | null;
  at: string;
  detail: string;
  data?: Record<string, unknown> | null;
}

/** Build one validated, redaction-safe alert (throws on anything unsafe). */
export function buildOperatorAlert(input: BuildAlertInput): OperatorAlert {
  if (!(OPERATOR_ALERT_KINDS as readonly string[]).includes(input.kind)) {
    throw new OperatorAlertError(`alert kind must be one of the closed vocabulary (got "${String(input.kind)}")`);
  }
  if (typeof input.at !== "string" || !ISO_TIMESTAMP.test(input.at)) throw new OperatorAlertError("at must be an ISO-8601 UTC timestamp");
  if (typeof input.detail !== "string" || input.detail.length === 0 || input.detail.length > MAX_DETAIL_CHARS) {
    throw new OperatorAlertError(`detail must be a non-empty string of ≤ ${MAX_DETAIL_CHARS} chars`);
  }
  const alert: OperatorAlert = {
    schemaVersion: LIVE_OPERATOR_ALERT_SCHEMA_VERSION,
    kind: input.kind,
    sessionId: input.sessionId ?? null,
    at: input.at,
    detail: input.detail,
    data: input.data ?? null,
    alertIsInformationalOnly: true,
    backendNeverSends: true,
  };
  assertNoSecretMaterial(alert, `alert ${input.kind}`);
  return alert;
}

/** Format one alert as a single console line (belt-and-braces redacted). */
export function formatConsoleAlert(alert: OperatorAlert): string {
  return redactString(`[ALERT ${alert.at}] ${alert.kind}${alert.sessionId ? ` (${alert.sessionId})` : ""}: ${alert.detail}`);
}

/** Format one alert as the webhook-file JSONL line (WITH trailing newline). */
export function formatWebhookFileLine(alert: OperatorAlert): string {
  return JSON.stringify(alert) + "\n";
}

const ALERT_KEYS: ReadonlySet<string> = new Set(["schemaVersion", "kind", "sessionId", "at", "detail", "data", "alertIsInformationalOnly", "backendNeverSends"]);

/** Strictly validate a parsed value as an {@link OperatorAlert} (closed schema). */
export function validateOperatorAlert(value: unknown): OperatorAlert {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new OperatorAlertError("alert must be a JSON object");
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALERT_KEYS.has(key)) throw new OperatorAlertError(`alert carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (obj.schemaVersion !== LIVE_OPERATOR_ALERT_SCHEMA_VERSION) throw new OperatorAlertError(`alert schemaVersion must be "${LIVE_OPERATOR_ALERT_SCHEMA_VERSION}"`);
  if (obj.alertIsInformationalOnly !== true || obj.backendNeverSends !== true) throw new OperatorAlertError("alert pinned literals are tampered");
  return buildOperatorAlert({
    kind: obj.kind as OperatorAlertKind,
    sessionId: (obj.sessionId ?? null) as string | null,
    at: obj.at as string,
    detail: obj.detail as string,
    data: (obj.data ?? null) as Record<string, unknown> | null,
  });
}
