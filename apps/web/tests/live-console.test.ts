import { describe, expect, it } from "vitest";

import {
  LIVE_CONSOLE_DEFAULT_RPC,
  LIVE_CONSOLE_FILENAME,
  LIVE_CONSOLE_WEB3_SRI,
  LIVE_CONSOLE_WEB3_URL,
  renderLiveConsoleHtml,
} from "../src/live/console.js";

/**
 * The Live Canary Console is the ONE reviewed surface where real Phantom signing lives. It is
 * deliberately isolated from the paper-only page registry (pages.test.ts), so it gets its own
 * narrowly-scoped safety test here. The asserts below are the allowlist: the Phantom call and the
 * web3 library are EXPECTED here (and only here); a seed-phrase / private-key capture is NOT.
 */
const html = renderLiveConsoleHtml();

describe("live console — document shape", () => {
  it("is a complete HTML document with a single title", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html.match(/<title>/g) ?? []).toHaveLength(1);
  });

  it("builds to its own isolated file, not a registry page", () => {
    expect(LIVE_CONSOLE_FILENAME).toBe("live-console.html");
  });
});

describe("live console — web3 is pinned with integrity", () => {
  it("loads @solana/web3.js from the pinned CDN URL with an SRI hash and crossorigin", () => {
    expect(html).toContain(`src="${LIVE_CONSOLE_WEB3_URL}"`);
    expect(html).toContain(`integrity="${LIVE_CONSOLE_WEB3_SRI}"`);
    expect(html).toContain('crossorigin="anonymous"');
    expect(LIVE_CONSOLE_WEB3_SRI.startsWith("sha384-")).toBe(true);
    // Pinned to an exact version (never @latest).
    expect(LIVE_CONSOLE_WEB3_URL).toMatch(/@solana\/web3\.js@\d+\.\d+\.\d+\//);
  });
});

describe("live console — the real Phantom signing surface", () => {
  it("requests a Phantom signature (the reviewed live capability)", () => {
    expect(html).toContain("signAndSendTransaction");
    expect(html).toContain("window.phantom");
    expect(html).toContain("isPhantom");
  });

  it("shows a prominent REAL MONEY warning and no profit promise", () => {
    expect(html).toContain("REAL MONEY");
    expect(html.toLowerCase()).toContain("can lose the entire amount");
    expect(html.toLowerCase()).toContain("not financial advice");
  });
});

describe("live console — never custodies a secret", () => {
  it("never builds a keypair or reads secret-key material", () => {
    expect(html).not.toContain("fromSecretKey");
    expect(html).not.toMatch(/\bKeypair\b/);
    expect(html).not.toMatch(/secretKey/);
  });

  it("has no password / seed-phrase / private-key INPUT field", () => {
    expect(html).not.toContain('type="password"');
    expect(html).not.toMatch(/id="(seed|seedPhrase|mnemonic|privateKey|secret)"/i);
    expect(html).not.toMatch(/name="(seed|seedPhrase|mnemonic|privateKey|secret)"/i);
  });

  it("states explicitly that it never asks for a seed phrase or private key", () => {
    expect(html.toLowerCase()).toContain("never asks for a seed phrase");
  });

  it("the default RPC endpoint carries no embedded api key", () => {
    expect(LIVE_CONSOLE_DEFAULT_RPC).toBe("https://api.mainnet-beta.solana.com");
    expect(LIVE_CONSOLE_DEFAULT_RPC).not.toMatch(/api[-_]?key|[?&]key=|token=/i);
  });
});

describe("live console — dangerous controls are gated by default", () => {
  it("the arm button starts disabled", () => {
    expect(html).toMatch(/id="arm-btn"[^>]*disabled/);
  });

  it("the Phantom sign button starts hidden until armed", () => {
    expect(html).toMatch(/id="sign-btn"[^>]*style="display:none"/);
  });

  it("requires an explicit understanding checkbox and a kill switch", () => {
    expect(html).toContain('id="understand"');
    expect(html).toContain('id="kill-btn"');
  });

  it("the client gate refuses anything but a preflight_ready mainnet-beta request", () => {
    expect(html).toContain("preflight_ready");
    expect(html).toContain("mainnet-beta");
    // A request claiming it was already signed/submitted is refused on load.
    expect(html).toContain("already signed/submitted");
  });

  it("refuses an artifact carrying a post-signature state (defense in depth)", () => {
    expect(html).toContain("PRE_SIGNATURE_STATES");
    expect(html).toContain("is not a pre-signature request state");
  });

  it("does not conflate Phantom submission with on-chain confirmation", () => {
    expect(html).toContain("NOT yet confirmed on-chain");
  });
});
