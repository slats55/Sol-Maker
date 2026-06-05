/**
 * Redacting structured logger.
 *
 * Design note: we deliberately own the logging boundary with a tiny,
 * fully-testable JSON-lines logger instead of wiring a third-party logger's
 * path-based redaction. Redaction here is pattern + key based and applies to
 * EVERY field of EVERY record, so a secret cannot leak just because someone
 * logged it under an unexpected key. The interface is intentionally
 * pino-compatible (`info`/`warn`/`error`/`debug`/`child`) so this can later be
 * mounted onto a pino transport for rotation/shipping without changing callers.
 */

import { redactValue } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  /** Minimum level to emit. Default "info". */
  level?: LogLevel;
  /** Redact output. Default true. Setting false is a security smell. */
  redact?: boolean;
  /** Where redacted JSON lines are written. Default: process.stdout. */
  sink?: (line: string) => void;
  /** Fields merged into every record (e.g. { module: "solana" }). */
  base?: Record<string, unknown>;
  /** Injectable clock for deterministic tests. Default: ISO now. */
  now?: () => string;
}

export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

function defaultSink(line: string): void {
  process.stdout.write(line + "\n");
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const redact = options.redact ?? true;
  const sink = options.sink ?? defaultSink;
  const base = options.base ?? {};
  const now = options.now ?? (() => new Date().toISOString());
  const threshold = LEVEL_ORDER[level];

  function emit(
    recordLevel: LogLevel,
    objOrMsg: Record<string, unknown> | string,
    maybeMsg?: string,
  ): void {
    if (LEVEL_ORDER[recordLevel] < threshold) return;

    let fields: Record<string, unknown>;
    let msg: string | undefined;
    if (typeof objOrMsg === "string") {
      fields = {};
      msg = objOrMsg;
    } else {
      fields = objOrMsg;
      msg = maybeMsg;
    }

    const record: Record<string, unknown> = {
      level: recordLevel,
      time: now(),
      ...base,
      ...fields,
    };
    if (msg !== undefined) record.msg = msg;

    const safe = redact ? redactValue(record) : record;
    sink(JSON.stringify(safe));
  }

  return {
    debug: (o: Record<string, unknown> | string, m?: string) =>
      emit("debug", o, m),
    info: (o: Record<string, unknown> | string, m?: string) =>
      emit("info", o, m),
    warn: (o: Record<string, unknown> | string, m?: string) =>
      emit("warn", o, m),
    error: (o: Record<string, unknown> | string, m?: string) =>
      emit("error", o, m),
    child: (bindings: Record<string, unknown>) =>
      createLogger({
        level,
        redact,
        sink,
        now,
        base: { ...base, ...bindings },
      }),
  };
}
