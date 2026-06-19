import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "references/**"],
    environment: "node",
    reporters: "default",
    // Heavy CLI integration tests (alpha campaign/history rollups, real fixture
    // generation) legitimately take 1–5s, and the full suite runs them under heavy
    // CPU contention. The 5s vitest default produces false timeouts in that window
    // (they pass in well under 1s in isolation). A 30s ceiling removes the flake
    // without hiding a genuine hang.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
