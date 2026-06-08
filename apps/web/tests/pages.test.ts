import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { escapeHtml, renderDocument } from "../src/lib/html.js";
import { NAV } from "../src/lib/nav.js";
import { DashboardShell } from "../src/components/layout.js";
import { PAGES } from "../src/pages/registry.js";

/** Render a page exactly as the generator (apps/web/src/build.ts) does. */
function renderPage(page: (typeof PAGES)[number]): string {
  const document = DashboardShell({
    activeId: page.nav.id,
    title: page.nav.label,
    description: page.nav.description,
    body: page.render(),
  });
  return renderDocument(document);
}

const normalize = (text: string): string => text.replace(/\r\n/g, "\n");

/** Patterns that must NEVER appear in any rendered page. */
const FORBIDDEN: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "inline <script>", re: /<script/i },
  {
    name: "inline event handler",
    re: /\son(?:click|load|error|mouseover|focus|submit|change|input)\s*=/i,
  },
  { name: "fetch() call", re: /\bfetch\s*\(/ },
  { name: "axios", re: /\baxios\b/i },
  { name: "WebSocket", re: /\bWebSocket\b/ },
  { name: "node-fetch", re: /\bnode-fetch\b/ },
  { name: "signTransaction", re: /\bsignTransaction\b/ },
  { name: "sendTransaction", re: /\bsendTransaction\b/ },
  { name: "Keypair", re: /\bKeypair\b/ },
  { name: "privateKey identifier", re: /\bprivateKey\b/ },
  { name: "secretKey identifier", re: /\bsecretKey\b/ },
  { name: "mnemonic", re: /\bmnemonic\b/i },
  { name: "seedPhrase identifier", re: /\bseedPhrase\b/ },
  { name: "unrendered template literal", re: /\$\{/ },
  { name: "object coercion leak", re: /\[object Object\]/ },
  { name: "undefined leak", re: /\bundefined\b/ },
  { name: "NaN leak", re: /\bNaN\b/ },
];

/** Safety language that must appear on EVERY page (guaranteed by the shell). */
const REQUIRED_ON_EVERY_PAGE: readonly string[] = [
  "PAPER ONLY",
  "No live trading",
  "No wallet connected",
  "No signing or sending",
  "Not financial advice",
  "Not a profitability claim",
  "Placeholder UI shell",
  "No live data",
];

describe("page registry", () => {
  it("covers exactly the nav items, one render per nav file", () => {
    expect(PAGES).toHaveLength(NAV.length);
    expect(PAGES.map((page) => page.nav.id).sort()).toEqual(
      NAV.map((item) => item.id).sort(),
    );
    const files = PAGES.map((page) => page.nav.file);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("every rendered page", () => {
  for (const page of PAGES) {
    describe(`${page.nav.file}`, () => {
      const out = renderPage(page);

      it("is a complete HTML document", () => {
        expect(out.startsWith("<!doctype html>")).toBe(true);
        expect(out).toContain("</html>");
        expect(out.match(/<title>/g) ?? []).toHaveLength(1);
        expect(out.match(/<main /g) ?? []).toHaveLength(1);
        // The shell HTML-escapes the title (e.g. "Safety & modes" → "&amp;").
        expect(out).toContain(
          `<title>${escapeHtml(`${page.nav.label} · Soulmaker`)}</title>`,
        );
      });

      it("shows all required safety language", () => {
        for (const phrase of REQUIRED_ON_EVERY_PAGE) {
          expect(out).toContain(phrase);
        }
      });

      it("contains no forbidden / unsafe patterns", () => {
        for (const rule of FORBIDDEN) {
          expect(out, `should not contain ${rule.name}`).not.toMatch(rule.re);
        }
      });

      it("marks itself as the active nav item", () => {
        expect(out).toContain('aria-current="page"');
      });
    });
  }
});

describe("committed static output is current", () => {
  for (const page of PAGES) {
    it(`public/${page.nav.file} matches a fresh render`, () => {
      const path = fileURLToPath(new URL(`../public/${page.nav.file}`, import.meta.url));
      const onDisk = normalize(readFileSync(path, "utf8"));
      const fresh = normalize(`${renderPage(page)}\n`);
      expect(
        onDisk,
        `public/${page.nav.file} is stale — run \`pnpm web:build\``,
      ).toBe(fresh);
    });
  }
});
