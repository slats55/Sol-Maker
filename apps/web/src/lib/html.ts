/**
 * Tiny, zero-dependency HTML rendering helper.
 *
 * The whole web foundation is rendered as plain HTML strings — no framework, no
 * DOM, no runtime dependencies. That keeps `apps/web` typecheckable with the
 * repo's Node-only `tsconfig` (no `dom` lib) and testable under the existing
 * Vitest setup, while staying inside the project's "no new dependencies" rule.
 *
 * Safety: every interpolated *string* is HTML-escaped by default. Pre-rendered,
 * trusted fragments (the output of other components) are wrapped in `raw()` so
 * they are inserted verbatim instead of being double-escaped. Untrusted dynamic
 * text must therefore be passed as a plain string, never wrapped in `raw()`.
 */

/** A trusted, already-escaped HTML fragment. */
export interface RawHtml {
  readonly __html: string;
}

/** Mark a string as trusted HTML that should be inserted without escaping. */
export function raw(htmlString: string): RawHtml {
  return { __html: htmlString };
}

/** Type guard for {@link RawHtml}. */
export function isRawHtml(value: unknown): value is RawHtml {
  return (
    typeof value === "object" &&
    value !== null &&
    "__html" in value &&
    typeof (value as { __html: unknown }).__html === "string"
  );
}

/** HTML-escape text for safe inclusion in element or attribute content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Anything an {@link html} interpolation accepts. */
export type HtmlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RawHtml
  | readonly HtmlValue[];

/** Render a single interpolation value to an HTML string. */
function renderValue(value: HtmlValue): string {
  if (value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return escapeHtml(value);
  }
  if (isRawHtml(value)) {
    return value.__html;
  }
  return value.map(renderValue).join("");
}

/**
 * Tagged template that builds a {@link RawHtml} fragment, escaping every
 * interpolated string and flattening arrays / nested fragments.
 */
export function html(
  strings: TemplateStringsArray,
  ...values: readonly HtmlValue[]
): RawHtml {
  let out = "";
  strings.forEach((chunk, index) => {
    out += chunk;
    if (index < values.length) {
      out += renderValue(values[index]);
    }
  });
  return raw(out);
}

/** Render any {@link HtmlValue} (or fragment) down to a final HTML string. */
export function renderToString(value: HtmlValue): string {
  return renderValue(value);
}

/**
 * Render a full document for writing to disk: like {@link renderToString} but
 * with per-line trailing whitespace stripped so committed static output stays
 * clean (and `git diff --check` stays quiet). Use this ONLY at the
 * document-write boundary — never for inline fragment rendering, where
 * surrounding whitespace can be significant.
 *
 * Safe for the JSON preview block: `JSON.stringify(…, null, 2)` never emits a
 * line that ends in significant whitespace, and escaped values never contain a
 * raw newline, so no displayed content ends a line with spaces.
 */
export function renderDocument(value: HtmlValue): string {
  return renderToString(value).replace(/[ \t]+$/gm, "");
}

/** Join a list of fragments with no separator (sugar for `raw(parts.join(""))`). */
export function fragments(parts: readonly HtmlValue[]): RawHtml {
  return raw(parts.map(renderValue).join(""));
}
