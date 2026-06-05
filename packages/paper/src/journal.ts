/**
 * Append-only journal: pure (de)serialization and replay. NO filesystem here —
 * the CLI reads/writes the JSONL file and hands the text to these functions.
 *
 * The journal is append-only by contract: replay never mutates prior events; it
 * folds fill events into a reconstructed {@link PaperState}.
 */

import { applyBuyFill, applySellFill, initialState } from "./engine.js";
import type {
  PaperJournalEvent,
  PaperJournalEventType,
  PaperRunSummary,
  PaperState,
} from "./types.js";

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<PaperJournalEventType>([
  "RUN_STARTED",
  "CANDIDATE_REJECTED_BY_RISK",
  "CANDIDATE_REJECTED_BY_CAPS",
  "CANDIDATE_REJECTED_BY_PRICE",
  "PAPER_BUY_FILLED",
  "PAPER_SELL_FILLED",
  "STOP_LOSS_TRIGGERED",
  "TAKE_PROFIT_TRIGGERED",
  "KILL_SWITCH_ACTIVE",
  "RUN_COMPLETED",
]);

/** Serialize one event to a single JSONL line. */
export function serializeEvent(event: PaperJournalEvent): string {
  return JSON.stringify(event);
}

/** Serialize a list of events to JSONL text (newline-terminated). */
export function serializeEvents(events: readonly PaperJournalEvent[]): string {
  return events.map(serializeEvent).join("\n") + (events.length ? "\n" : "");
}

export interface ParseJournalResult {
  events: PaperJournalEvent[];
  errors: Array<{ line: number; reason: string }>;
}

/**
 * Parse JSONL journal text. Blank lines are skipped. Each non-blank line must be
 * a JSON object with a known `type` and a string `at`; anything else is reported
 * as an error (and skipped) rather than throwing — so one bad line never loses
 * the rest of the journal.
 */
export function parseJournal(text: string): ParseJournalResult {
  const events: PaperJournalEvent[] = [];
  const errors: Array<{ line: number; reason: string }> = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] ?? "").trim();
    if (raw.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({ line: i + 1, reason: "not valid JSON" });
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push({ line: i + 1, reason: "not a JSON object" });
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.type !== "string" || !KNOWN_EVENT_TYPES.has(obj.type)) {
      errors.push({ line: i + 1, reason: `unknown event type: ${String(obj.type)}` });
      continue;
    }
    if (typeof obj.at !== "string") {
      errors.push({ line: i + 1, reason: "missing string 'at' timestamp" });
      continue;
    }
    events.push(parsed as PaperJournalEvent);
  }

  return { events, errors };
}

/** Replay fill events into a reconstructed portfolio state (append-only fold). */
export function reduceJournal(events: readonly PaperJournalEvent[]): PaperState {
  let state = initialState();
  for (const event of events) {
    if (event.type === "PAPER_BUY_FILLED") {
      state = applyBuyFill(state, event.fill);
    } else if (event.type === "PAPER_SELL_FILLED") {
      state = applySellFill(state, event.fill).state;
    }
  }
  return state;
}

/**
 * Validate the `fill` payload of a fill event before it is folded into state.
 * The reducers do no validation, so an injected fill with a non-finite/negative
 * amount or a side that contradicts its event type would silently corrupt the
 * reconstructed state. Returns a human reason when invalid, or `null` when sound.
 */
function invalidFillReason(
  fill: unknown,
  eventType: "PAPER_BUY_FILLED" | "PAPER_SELL_FILLED",
): string | null {
  if (fill === null || typeof fill !== "object" || Array.isArray(fill)) {
    return "fill is missing or not an object";
  }
  const f = fill as Record<string, unknown>;
  if (typeof f.mint !== "string" || f.mint.length === 0) {
    return "fill.mint must be a non-empty string";
  }
  const expectedSide = eventType === "PAPER_BUY_FILLED" ? "BUY" : "SELL";
  if (f.side !== expectedSide) {
    return `fill.side ${String(f.side)} does not match ${eventType}`;
  }
  for (const key of ["quantity", "priceUsd", "notionalUsd", "feeUsd"] as const) {
    const v = f[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return `fill.${key} must be a non-negative finite number`;
    }
  }
  if (typeof f.filledAt !== "string") {
    return "fill.filledAt must be a string";
  }
  return null;
}

/** A strict reconstruction of portfolio state from raw journal text. */
export interface JournalDerivation {
  /** The reconstructed state (folds only the well-formed fill events). */
  state: PaperState;
  /** Every event that parsed (including non-fill events), in order. */
  events: PaperJournalEvent[];
  /** Line-level parse errors (bad JSON / unknown type / missing `at`). */
  parseErrors: Array<{ line: number; reason: string }>;
  /** Fill-payload errors: the event parsed but its `fill` is unusable. */
  fillErrors: Array<{ index: number; reason: string }>;
}

/**
 * Strictly derive a {@link PaperState} from raw append-only journal text (JSONL).
 *
 * Composes {@link parseJournal} (line parsing) and {@link reduceJournal} (state
 * fold) and additionally validates each fill event's payload. Pure: no
 * filesystem, no clock, no mutation. It does NOT decide policy — it reports
 * `parseErrors` and `fillErrors` and lets the caller choose to refuse (strict)
 * or tolerate (lenient). Only well-formed fills are folded, so the returned
 * `state` is never NaN-corrupted. An empty/blank journal yields the initial
 * (empty) state with no errors.
 */
export function deriveStateFromJournalText(text: string): JournalDerivation {
  const { events, errors } = parseJournal(text);
  const fillErrors: Array<{ index: number; reason: string }> = [];
  const usable: PaperJournalEvent[] = [];

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === undefined) continue;
    if (event.type === "PAPER_BUY_FILLED" || event.type === "PAPER_SELL_FILLED") {
      const reason = invalidFillReason(event.fill, event.type);
      if (reason !== null) {
        fillErrors.push({ index: i, reason });
        continue;
      }
    }
    usable.push(event);
  }

  return { state: reduceJournal(usable), events, parseErrors: errors, fillErrors };
}

/** The summary from the most recent RUN_COMPLETED event, if any. */
export function lastRunSummary(
  events: readonly PaperJournalEvent[],
): PaperRunSummary | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && event.type === "RUN_COMPLETED") return event.summary;
  }
  return undefined;
}
