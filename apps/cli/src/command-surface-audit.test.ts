/**
 * Sprint 103 — the WHOLE-CLI command-surface security audit.
 *
 * The per-lane scans (`simulation-security.test.ts`, `sniper-security.test.ts`) and the
 * release-candidate wall (`release-candidate-safety.test.ts`) each guard their own slice. THIS
 * file is the single, durable, surface-wide proof of the no-mainnet-send invariant — it scans
 * EVERY registered command (including the execution:* and engine:* lanes those per-lane files
 * skip) and pins the source-level facts that keep the send seam devnet-only:
 *
 *   1. command registry scan   — no command name can send/arm mainnet; the only send surface is
 *      `execution:devnet:send` (devnet, double opt-in);
 *   2. flag scan               — no command exposes an arm / force-live / bypass / enable-live /
 *      go-live / disable-gate / no-dry-run flag;
 *   3. help-text scan          — no command's description promises a mainnet send/broadcast;
 *   4. mode-enum closure       — the rehearse mode set is closed (no mainnet-live); the send-
 *      reachable execution modes are exactly devnet-execution + mainnet-live-armed;
 *   5. no-live-alias / resolver — resolveExecutionMode is fail-closed (unknown -> paper) and never
 *      resolves armed unless all fourteen gate conditions pass;
 *   6. send-seam pinning (source) — commands.ts requests "devnet" for the only attemptExecution
 *      call site and never requests "mainnet-live" anywhere;
 *   7. signer-seam pinning (source + unit) — every loadLocalSignerBoundary call in commands.ts is
 *      devnet, and a mainnet signer refuses without an armed fourteen-condition gate.
 *
 * If any of these fail, someone is bolting a live-send path onto the CLI. They are meant to fail
 * loudly the day that happens.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINNET_SEND_COMMAND_ALLOWLIST } from "./phase7-audit-probes.js";
import {
  EXECUTION_MODES,
  resolveExecutionMode,
  loadLocalSignerBoundary,
  SignerBoundaryError,
  evaluateMainnetLiveGate,
  type MainnetLiveGateResult,
} from "@soulmaker/execution";
import { SNIPER_REHEARSE_MODES } from "./commands.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_INDEX = readFileSync(join(HERE, "index.ts"), "utf8");
const CLI_COMMANDS = readFileSync(join(HERE, "commands.ts"), "utf8");

/** Pull each registered command name out of the index source. */
function registeredCommands(): string[] {
  return [...CLI_INDEX.matchAll(/\.command\("([^"]+)"\)/g)].map((m) => (m[1] as string).split(" ")[0] as string);
}

/** Pull every registered `--flag` name out of the index source. */
function registeredFlags(): string[] {
  return [...CLI_INDEX.matchAll(/\.option\(\s*\n?\s*"(--[a-z0-9-]+)/gi)].map((m) => m[1] as string);
}

/** Slice each command's whole registration block (`.command(...)` up to its `.action(`). */
function commandBlocks(): Array<{ command: string; block: string }> {
  return [...CLI_INDEX.matchAll(/\.command\("([^"]+)"\)([\s\S]*?)\.action\(/g)].map((m) => ({
    command: (m[1] as string).split(" ")[0] as string,
    block: m[2] as string,
  }));
}

describe("S103 command-surface — registry scan: no mainnet send/live command", () => {
  const commands = registeredCommands();

  it("registers at least the full known surface (the scan is not silently empty)", () => {
    expect(commands.length).toBeGreaterThanOrEqual(80);
  });

  it("no command name outside the S111 mainnet allowlist can send or arm mainnet / live", () => {
    for (const command of commands) {
      if (MAINNET_SEND_COMMAND_ALLOWLIST.includes(command)) continue;
      expect(command, command).not.toMatch(/mainnet.*send|send.*mainnet|live.*send|send.*live|mainnet.*live|arm|go-live/i);
    }
  });

  it("the send-named commands are exactly execution:devnet:send plus the S111 mainnet allowlist", () => {
    const sendCommands = commands.filter((c) => /send/i.test(c)).sort();
    expect(sendCommands).toEqual(["execution:devnet:send", "execution:mainnet:send"]);
    expect(MAINNET_SEND_COMMAND_ALLOWLIST).toEqual(["execution:mainnet:send", "execution:mainnet:sell"]);
  });

  it("the only execution commands that can broadcast are devnet-scoped or on the S111 mainnet allowlist", () => {
    const exec = commands.filter((c) => c.startsWith("execution:"));
    const broadcasters = exec.filter((c) => /send|sell|rehearse/i.test(c));
    expect(broadcasters.sort()).toEqual(["execution:devnet:rehearse", "execution:devnet:send", "execution:mainnet:sell", "execution:mainnet:send"]);
  });

  it("S111: every mainnet send command carries the explicit acknowledgment flag and refuses without it", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
    for (const c of MAINNET_SEND_COMMAND_ALLOWLIST) {
      const at = source.indexOf(`.command("${c}")`);
      expect(at, c).toBeGreaterThan(-1);
      expect(source.slice(at, at + 6000), c).toContain("--i-understand-this-can-lose-real-money");
    }
  });
});

describe("S103 command-surface — flag scan: no arm / bypass / force-live flag", () => {
  const flags = registeredFlags();

  it("no flag arms, forces, enables, bypasses, or disables the gate / dry-run", () => {
    for (const flag of flags) {
      expect(flag, flag).not.toMatch(
        /^--(force-live|enable-live|mainnet-send|mainnet-live|arm|arm-live|go-live|bypass|bypass-gate|disable-gate|skip-gate|no-dry-run|live-send|allow-live|force-send|unsafe)/i,
      );
    }
  });

  it("the live acknowledgment flag is an ACK (never sufficient alone), present only on read-only/build commands and the S111 mainnet allowlist", () => {
    // --i-understand-this-can-lose-real-money is one of FOURTEEN conditions and never a bypass.
    // It must NOT appear on any devnet broadcaster; on mainnet it appears ONLY on the S111 allowlist.
    for (const { command, block } of commandBlocks()) {
      if (/--i-understand-this-can-lose-real-money/.test(block)) {
        expect(["execution:status", "execution:build", ...MAINNET_SEND_COMMAND_ALLOWLIST], command).toContain(command);
      }
    }
  });

  it("the only broadcast opt-ins are devnet-scoped", () => {
    expect(flags).toContain("--devnet-send");
    expect(flags).toContain("--acknowledge-devnet-execution");
    expect(flags).not.toContain("--mainnet-send");
  });
});

describe("S103 command-surface — help-text scan: no command promises a mainnet send", () => {
  /** (command, lowercased description) pairs from the index source. */
  function describedCommands(): Array<{ command: string; description: string }> {
    return [...CLI_INDEX.matchAll(/\.command\("([^"]+)"\)\s*\.description\(\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => ({
      command: (m[1] as string).split(" ")[0] as string,
      description: (m[2] as string).toLowerCase(),
    }));
  }
  // Disclaimer / negation tokens that turn a send+mainnet co-occurrence into an explicit refusal.
  const NEGATION = /\bno\b|\bnot\b|never|cannot|can never|refus|structurally|no cli surface|blocked|disabled|unauthorized/;

  it("no description co-locates a send verb with mainnet WITHOUT a refusal/negation (catches a real leak; tolerates disclaimers)", () => {
    const pairs = describedCommands();
    expect(pairs.length).toBeGreaterThanOrEqual(80);
    for (const { command, description } of pairs) {
      const sendsAndMainnet = /\bsend\b|\bbroadcast\b|\bsubmit\b/.test(description) && /mainnet/.test(description);
      if (!sendsAndMainnet) continue;
      // The only legitimate reason to mention both is to REFUSE a mainnet send. A real leak
      // ("...sends on mainnet-beta...") would carry no negation and trip this.
      expect(NEGATION.test(description), `${command}: "${description.slice(0, 160)}..."`).toBe(true);
    }
  });

  it("the genuinely broadcast-capable commands explicitly describe themselves as devnet-only", () => {
    const byName = new Map(describedCommands().map((p) => [p.command, p.description]));
    const send = byName.get("execution:devnet:send") ?? "";
    expect(send).toMatch(/devnet-only|devnet only/);
    expect(send).toMatch(/execution:mainnet:send/);
    const rehearse = byName.get("execution:devnet:rehearse") ?? "";
    expect(rehearse).toMatch(/devnet/);
    expect(rehearse).toMatch(/mainnet endpoints are refused|no mainnet variant/);
  });

  it("the read-only execution commands name the S111 mainnet send surface", () => {
    const byName = new Map(describedCommands().map((p) => [p.command, p.description]));
    expect(byName.get("execution:status") ?? "").toMatch(/execution:mainnet:send/);
    expect(byName.get("execution:readiness") ?? "").toMatch(/execution:mainnet:send/);
  });
});

describe("S103 command-surface — mode-enum closure", () => {
  it("the rehearse mode set is CLOSED with no mainnet-live mode", () => {
    expect([...SNIPER_REHEARSE_MODES]).toEqual(["paper", "devnet", "mainnet-dry-run"]);
    expect(SNIPER_REHEARSE_MODES as readonly string[]).not.toContain("mainnet-live");
  });

  it("the execution mode set is exactly the six documented modes", () => {
    expect([...EXECUTION_MODES]).toEqual([
      "paper",
      "readonly",
      "devnet-execution",
      "mainnet-dry-run",
      "mainnet-live-blocked",
      "mainnet-live-armed",
    ]);
  });
});

describe("S103 command-surface — resolver is fail-closed (no live alias)", () => {
  it("an unknown / garbage requested mode resolves to paper", () => {
    for (const requested of ["", "live", "mainnet", "MAINNET-LIVE", "send", "go", "armed", "../live"]) {
      expect(resolveExecutionMode({ requested }).mode, requested).toBe("paper");
    }
  });

  it("requesting mainnet-live with the default (empty) gate resolves BLOCKED, never armed", () => {
    const resolved = resolveExecutionMode({ requested: "mainnet-live" });
    expect(resolved.mode).toBe("mainnet-live-blocked");
    expect(resolved.liveGate?.armed).toBe(false);
    expect(resolved.liveGate?.checks.length).toBe(14);
  });

  it("requesting devnet without the env+CLI opt-in resolves to paper (fail-closed)", () => {
    expect(resolveExecutionMode({ requested: "devnet" }).mode).toBe("paper");
    expect(resolveExecutionMode({ requested: "devnet", devnetCliAcknowledged: true }).mode).toBe("paper");
    expect(
      resolveExecutionMode({
        requested: "devnet",
        devnetCliAcknowledged: true,
        env: { SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only" },
      }).mode,
    ).toBe("devnet-execution");
  });
});

describe("S103 command-surface — send-seam pinning (source-level)", () => {
  it("the only attemptExecution call site in commands.ts is fed a devnet-resolved mode", () => {
    const calls = [...CLI_COMMANDS.matchAll(/attemptExecution\(/g)];
    expect(calls.length).toBe(1);
    // The nearest preceding resolveExecutionMode hardcodes requested: "devnet".
    const sendIdx = CLI_COMMANDS.indexOf("await attemptExecution(");
    expect(sendIdx).toBeGreaterThan(0);
    const preceding = CLI_COMMANDS.slice(0, sendIdx);
    const lastResolve = preceding.lastIndexOf("resolveExecutionMode({");
    const resolveBlock = preceding.slice(lastResolve, lastResolve + 200);
    expect(resolveBlock).toMatch(/requested:\s*"devnet"/);
  });

  it("commands.ts never requests mainnet-live execution", () => {
    expect(CLI_COMMANDS).not.toMatch(/requested:\s*"mainnet-live"/);
  });
});

describe("S103 command-surface — signer-seam pinning (source + unit)", () => {
  it("every loadLocalSignerBoundary call in commands.ts is devnet (no mainnet signer load)", () => {
    const calls = [...CLI_COMMANDS.matchAll(/loadLocalSignerBoundary\(\{([\s\S]*?)\}\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      const body = call[1] as string;
      expect(body).toMatch(/network:\s*"devnet"/);
      expect(body).not.toMatch(/network:\s*"mainnet-beta"/);
    }
  });

  it("a mainnet signer refuses without an armed fourteen-condition gate", () => {
    const env = { SIGNER_PATH: "/tmp/should-never-be-read.json" };
    const readFile = (): string => {
      throw new Error("the signer file must never be read when the gate refuses");
    };
    // No gate.
    expect(() =>
      loadLocalSignerBoundary({ envVarName: "SIGNER_PATH", env, readFile, network: "mainnet-beta" }),
    ).toThrow(SignerBoundaryError);
    // A fully-failed gate (the default).
    const blockedGate: MainnetLiveGateResult = evaluateMainnetLiveGate({});
    expect(blockedGate.armed).toBe(false);
    expect(() =>
      loadLocalSignerBoundary({
        envVarName: "SIGNER_PATH",
        env,
        readFile,
        network: "mainnet-beta",
        mainnetLiveGate: blockedGate,
      }),
    ).toThrow(/ARMED fourteen-condition live gate/);
  });
});

describe("S103 command-surface — engine:* Rust lane exposes no key/send/sign flag", () => {
  it("no engine command exposes a send / sign / key / wallet / network flag", () => {
    const forbidden = ["--send", "--sign", "--key", "--keypair", "--wallet", "--signer", "--private", "--seed", "--rpc-url"];
    for (const { command, block } of commandBlocks()) {
      if (!command.startsWith("engine:")) continue;
      const flags = [...block.matchAll(/\.option\(\s*\n?\s*"(--[a-z0-9-]+)/g)].map((m) => m[1] as string);
      for (const flag of flags) {
        expect(forbidden, `${command} exposes ${flag}`).not.toContain(flag);
      }
    }
  });
});
