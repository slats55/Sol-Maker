/**
 * Sprint 90 — regenerate the FICTIONAL fixtures in `examples/sniper/real-input-rehearsal/`.
 *
 * The fixture shapes are produced THROUGH PRODUCTION CODE — `buildTokenInspectReport` (over an
 * in-memory fictional client; no network) and the real `buildTokenRiskReport` risk engine — with a
 * fixed clock, so the committed files are byte-deterministic and always match what the real
 * `token:inspect --json --out` / `token:risk --json --out` commands would write for these facts.
 * The pin test (`apps/cli/src/real-input-rehearsal-example.test.ts`) imports
 * {@link buildRealInputRehearsalFixtures} and fails loudly if the committed files drift.
 *
 * Run: `pnpm tsx scripts/gen-real-input-rehearsal-fixtures.mts`
 *
 * Everything here is FICTIONAL: invented mints (they do not exist on-chain), invented supply and
 * authority facts, a fictional RPC host. No network, no wallet, no key, no transaction.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Relative source imports: the root scripts/ folder is not a workspace package, so the
// @soulmaker/* specifiers do not resolve here. These are the same production modules.
import {
  buildTokenInspectReport,
  type PublicKeyInput,
  type ReadOnlySolanaClient,
} from "../packages/solana/src/index.js";
import { buildTokenRiskReport, type TokenRiskInput } from "../packages/risk/src/index.js";
import { FICTIONAL_MINT_A, FICTIONAL_MINT_B } from "../packages/simulation/src/index.js";

const FIXED_NOW = (): string => "2026-06-11T00:00:00.000Z";

/** Invented per-mint facts. FICB carries a freeze authority so the risk engine flags it. */
const MINT_FACTS: Record<string, { freezeAuthorityPresent: boolean }> = {
  [FICTIONAL_MINT_A]: { freezeAuthorityPresent: false },
  [FICTIONAL_MINT_B]: { freezeAuthorityPresent: true },
};

/** In-memory read-only client over the invented facts (structurally cannot reach a network). */
function fictionalClient(): ReadOnlySolanaClient {
  return {
    endpointHost: "fictional.rpc.invalid",
    getRpcHealth: async () => ({
      ok: true,
      endpointHost: "fictional.rpc.invalid",
      solanaCore: "0.0.0-fictional",
      slot: 0,
    }),
    getVersion: async () => ({ solanaCore: "0.0.0-fictional" }),
    getSolBalance: async () => ({ ownerBase58: FICTIONAL_MINT_A, lamports: 0, sol: 0 }),
    getTokenAccounts: async () => [],
    getTokenMintInfo: async (mint: PublicKeyInput) => {
      const base58 = typeof mint === "string" ? mint : mint.toBase58();
      const facts = MINT_FACTS[base58];
      if (!facts) throw new Error(`no fictional facts for mint ${base58}`);
      return {
        mint: base58,
        decimals: 6,
        supplyRaw: "1000000000000",
        uiSupply: 1_000_000,
        mintAuthorityPresent: false,
        freezeAuthorityPresent: facts.freezeAuthorityPresent,
        isInitialized: true,
        programLabel: "spl-token" as const,
        source: "fictional-fixture",
      };
    },
  };
}

/** Build the four fixture values (filename → JSON value) through the production builders. */
export async function buildRealInputRehearsalFixtures(): Promise<Record<string, unknown>> {
  const client = fictionalClient();
  const out: Record<string, unknown> = {};
  for (const [tag, mint] of [
    ["fica", FICTIONAL_MINT_A],
    ["ficb", FICTIONAL_MINT_B],
  ] as const) {
    const inspection = await buildTokenInspectReport(client, mint, { now: FIXED_NOW });
    const riskInput: TokenRiskInput = {
      mint: inspection.mint,
      decimals: inspection.decimals,
      supplyRaw: inspection.supplyRaw,
      uiSupply: inspection.uiSupply,
      mintAuthorityPresent: inspection.mintAuthorityPresent,
      freezeAuthorityPresent: inspection.freezeAuthorityPresent,
      isInitialized: inspection.isInitialized,
      programLabel: inspection.programLabel,
    };
    const risk = buildTokenRiskReport(riskInput, { now: FIXED_NOW });
    out[`inspect.${tag}.fictional.json`] = inspection;
    out[`risk.${tag}.fictional.json`] = risk;
  }
  return out;
}

// Write the files only when executed directly (the pin test imports the builder above).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(
    dirname(fileURLToPath(import.meta.url)),
    "../examples/sniper/real-input-rehearsal",
  );
  const fixtures = await buildRealInputRehearsalFixtures();
  for (const [name, value] of Object.entries(fixtures)) {
    // Same byte format the CLI's --out writes (2-space indent + trailing newline).
    writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");
    console.log(`wrote ${join(dir, name)}`);
  }
}
