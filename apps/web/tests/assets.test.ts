import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The static generator copies styles/theme.css verbatim to public/assets/theme.css
 * (see ../src/build.ts). These tests guard that copy against drift and assert the
 * schema-aware typed-view style hooks ship — with no network/external CSS.
 */

const SOURCE = fileURLToPath(new URL("../styles/theme.css", import.meta.url));
const BUILT = fileURLToPath(new URL("../public/assets/theme.css", import.meta.url));
const norm = (text: string): string => text.replace(/\r\n/g, "\n");

describe("theme.css asset", () => {
  const source = norm(readFileSync(SOURCE, "utf8"));
  const built = norm(readFileSync(BUILT, "utf8"));

  it("committed public/assets/theme.css matches styles/theme.css", () => {
    expect(built, "public/assets/theme.css is stale — run `pnpm web:build`").toBe(source);
  });

  it("styles the schema-aware typed-view hooks", () => {
    for (const hook of [
      ".sm-typedview__self",
      ".sm-typedview__banner",
      ".sm-artifactview__generic-lead",
      ".sm-digest",
      ".sm-matrixgrid",
    ]) {
      expect(source, `theme.css should style ${hook}`).toContain(hook);
    }
  });

  it("contains no network/external CSS (no url(), @import, or external URLs)", () => {
    expect(source).not.toMatch(/@import/);
    expect(source).not.toMatch(/url\(/);
    expect(source).not.toMatch(/https?:\/\//);
  });
});
