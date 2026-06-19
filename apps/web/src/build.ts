/**
 * Static site generator.
 *
 * Renders every page in the registry through the shared shell and writes the
 * result to apps/web/public/ (committed static output — no dev server needed).
 * The CSS theme is copied to public/assets/theme.css.
 *
 * Run from the repo root:
 *   pnpm web:build
 *   # or: pnpm exec tsx apps/web/src/build.ts
 *
 * This script only reads apps/web/styles/theme.css and writes under
 * apps/web/public/. It performs no network, chain, or wallet activity.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderDocument } from "./lib/html.js";
import { DashboardShell } from "./components/layout.js";
import { PAGES } from "./pages/registry.js";
import { LIVE_CONSOLE_FILENAME, renderLiveConsoleHtml } from "./live/console.js";

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src
const webRoot = dirname(here); // apps/web
const publicDir = join(webRoot, "public");
const assetsDir = join(publicDir, "assets");
const cssSource = join(webRoot, "styles", "theme.css");

mkdirSync(assetsDir, { recursive: true });

const css = readFileSync(cssSource, "utf8");
writeFileSync(join(assetsDir, "theme.css"), css, "utf8");
console.log("wrote public/assets/theme.css");

for (const page of PAGES) {
  const document = DashboardShell({
    activeId: page.nav.id,
    title: page.nav.label,
    description: page.nav.description,
    body: page.render(),
  });
  writeFileSync(join(publicDir, page.nav.file), `${renderDocument(document)}\n`, "utf8");
  console.log(`wrote public/${page.nav.file}`);
}

// The LIVE CANARY CONSOLE is a SEPARATE, isolated surface — deliberately NOT in the paper-only
// page registry above, so the paper pages keep their "no <script>, no signing" guarantee. It is
// the one reviewed place where real Phantom signing lives (see apps/web/tests/live-console.test.ts).
writeFileSync(join(publicDir, LIVE_CONSOLE_FILENAME), renderLiveConsoleHtml(), "utf8");
console.log(`wrote public/${LIVE_CONSOLE_FILENAME} (live canary console)`);

console.log(`done: ${PAGES.length} pages + live console + assets/theme.css`);
