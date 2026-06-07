import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  fragments,
  html,
  isRawHtml,
  raw,
  renderToString,
} from "../src/lib/html.js";

describe("escapeHtml", () => {
  it("escapes all five dangerous characters", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });

  it("escapes ampersands before entities so output is not double-encoded", () => {
    expect(escapeHtml("a&lt;b")).toBe("a&amp;lt;b");
  });

  it("leaves safe text untouched", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
});

describe("html tagged template", () => {
  it("escapes interpolated strings (XSS-safe by default)", () => {
    const evil = `<img src=x onerror="alert(1)">`;
    const out = renderToString(html`<div>${evil}</div>`);
    expect(out).toBe(
      `<div>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</div>`,
    );
    expect(out).not.toContain("<img");
  });

  it("inserts raw() fragments verbatim", () => {
    const out = renderToString(html`${raw("<b>bold</b>")}`);
    expect(out).toBe("<b>bold</b>");
  });

  it("nests fragments without double-escaping", () => {
    const inner = html`<span>${"<x>"}</span>`;
    const out = renderToString(html`<p>${inner}</p>`);
    expect(out).toBe("<p><span>&lt;x&gt;</span></p>");
  });

  it("flattens arrays and renders each element", () => {
    const out = renderToString(html`${["a", "<b>", raw("<i>c</i>")]}`);
    expect(out).toBe("a&lt;b&gt;<i>c</i>");
  });

  it("renders null, undefined, and booleans as empty strings", () => {
    expect(renderToString(html`${null}${undefined}${true}${false}`)).toBe("");
  });

  it("stringifies numbers", () => {
    expect(renderToString(html`${42}`)).toBe("42");
  });
});

describe("raw / isRawHtml / fragments", () => {
  it("round-trips raw markers", () => {
    const value = raw("<hr/>");
    expect(isRawHtml(value)).toBe(true);
    expect(value.__html).toBe("<hr/>");
  });

  it("isRawHtml rejects non-raw values", () => {
    expect(isRawHtml("string")).toBe(false);
    expect(isRawHtml(null)).toBe(false);
    expect(isRawHtml({ __html: 1 })).toBe(false);
  });

  it("fragments joins a list with no separator", () => {
    expect(renderToString(fragments(["a", raw("<b>"), 1]))).toBe("a<b>1");
  });
});
