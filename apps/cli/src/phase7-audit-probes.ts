/**
 * Sprint 103 — the runtime machine-probes behind `paper:phase7:authorization:audit`.
 *
 * These deliberately EXERCISE the mainnet refusal paths (the resolver, the signer boundary) to prove
 * they fail closed — so they, not the CLI command file, are where the `mainnet-live` request and the
 * `mainnet-beta` signer load live. None of these probes sends, signs, or loads a real key: the signer
 * probe passes an env with no value and a reader that throws, and only checks that the boundary
 * REFUSES. The command file (`commands.ts`) stays free of any mainnet request / signer call, which is
 * what the command-surface audit asserts.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateMainnetLiveGate,
  resolveExecutionMode,
  loadLocalSignerBoundary,
  SignerBoundaryError,
  SESSION_CONTINUATION_ALLOWED_STATUSES,
} from "@soulmaker/execution";
import { redactString } from "@soulmaker/security";
import { SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS } from "@soulmaker/sniper";

/** Repo root computed from this module's location (apps/cli/src/phase7-audit-probes.ts -> root). */
export const PHASE7_AUDIT_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The reviewed Rust dependency allowlist — the engine is JSON serialization only. */
const PHASE7_RUST_DEP_ALLOWLIST: ReadonlySet<string> = new Set(["serde", "serde_json"]);

export interface ProbeResult {
  checked: boolean;
  clean: boolean;
  detail: string;
}

/** Parse the engine Cargo.toml [dependencies] and confirm it stays within the reviewed allowlist. */
export function checkRustDependencyAllowlist(toml: string): ProbeResult {
  const deps: string[] = [];
  let inDeps = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inDeps = line === "[dependencies]";
      continue;
    }
    if (!inDeps || line.length === 0 || line.startsWith("#")) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (m) deps.push(m[1] as string);
  }
  const unexpected = deps.filter((d) => !PHASE7_RUST_DEP_ALLOWLIST.has(d));
  return {
    checked: true,
    clean: unexpected.length === 0 && deps.length > 0,
    detail:
      unexpected.length > 0
        ? `UNEXPECTED Rust dependency(ies): ${unexpected.join(", ")} (allowlist: serde, serde_json)`
        : `Rust dependency allowlist holds (${deps.join(", ") || "none"})`,
  };
}

/** Scan the registered CLI command surface for any mainnet send / live / bypass exposure. */
export function scanCliCommandSurface(repoRoot: string): ProbeResult {
  let src: string;
  try {
    src = readFileSync(join(repoRoot, "apps", "cli", "src", "index.ts"), "utf8");
  } catch {
    return { checked: false, clean: false, detail: "apps/cli/src/index.ts not readable from this working directory" };
  }
  const commands = [...src.matchAll(/\.command\("([^"]+)"\)/g)].map((m) => (m[1] as string).split(" ")[0] as string);
  const liveCommands = commands.filter((c) => /mainnet.*live|live.*send|send.*mainnet|arm|go-live/i.test(c));
  const sendNamed = commands.filter((c) => /send/i.test(c));
  const flags = [...src.matchAll(/\.option\(\s*\n?\s*"(--[a-z0-9-]+)/gi)].map((m) => m[1] as string);
  const badFlags = flags.filter((f) =>
    /^--(force-live|enable-live|mainnet-send|mainnet-live|arm|go-live|bypass|disable-gate|no-dry-run|live-send|allow-live)/i.test(f),
  );
  const onlyDevnetSend = sendNamed.every((c) => c === "execution:devnet:send");
  const clean = liveCommands.length === 0 && badFlags.length === 0 && onlyDevnetSend;
  return {
    checked: true,
    clean,
    detail: clean
      ? `no mainnet-send command, no live/arm/bypass flag; only send command is ${sendNamed.join(", ") || "(none)"}`
      : `UNSAFE: live-commands=[${liveCommands.join(", ")}] bad-flags=[${badFlags.join(", ")}] send=[${sendNamed.join(", ")}]`,
  };
}

export interface Phase7AuditProbes {
  gateDefaultBlocked: boolean;
  resolverFailClosed: boolean;
  signerRefusesMainnet: boolean;
  redactorCatchesSecret: boolean;
  rcLiveDisabledPinned: boolean;
  reconciliationWallFailsClosed: boolean;
  rustDep: ProbeResult;
  surface: ProbeResult;
}

/** Run every runtime safety probe. Pure of side effects (reads two repo files; no network/wallet). */
export function gatherPhase7AuditProbes(repoRoot: string = PHASE7_AUDIT_REPO_ROOT): Phase7AuditProbes {
  const gate = evaluateMainnetLiveGate({});
  const gateDefaultBlocked = gate.armed === false && gate.checks.length === 14 && gate.checks.every((c) => !c.satisfied);

  const resolverFailClosed =
    resolveExecutionMode({ requested: "phase7-audit-not-a-real-mode" }).mode === "paper" &&
    resolveExecutionMode({ requested: "mainnet-live" }).mode === "mainnet-live-blocked";

  let signerRefusesMainnet = false;
  try {
    loadLocalSignerBoundary({
      envVarName: "PHASE7_AUDIT_PROBE",
      env: {},
      readFile: () => {
        throw new Error("the signer file must never be read when the gate refuses");
      },
      network: "mainnet-beta",
    });
  } catch (err) {
    signerRefusesMainnet = err instanceof SignerBoundaryError;
  }

  const bearerProbe = "Bearer abcdef0123456789abcdef0123456789";
  const base58Probe = "5".repeat(96);
  const redactorCatchesSecret = redactString(bearerProbe) !== bearerProbe && redactString(base58Probe) !== base58Probe;

  const rcLiveDisabledPinned = SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS === "disabled";

  const reconAllowed = SESSION_CONTINUATION_ALLOWED_STATUSES as readonly string[];
  const reconciliationWallFailsClosed =
    !reconAllowed.includes("pending-confirmation") &&
    !reconAllowed.includes("unreconciled") &&
    !reconAllowed.includes("unknown");

  let rustDep: ProbeResult;
  try {
    rustDep = checkRustDependencyAllowlist(readFileSync(join(repoRoot, "crates", "solmaker-engine", "Cargo.toml"), "utf8"));
  } catch {
    rustDep = { checked: false, clean: false, detail: "crates/solmaker-engine/Cargo.toml not readable from this working directory" };
  }
  const surface = scanCliCommandSurface(repoRoot);

  return {
    gateDefaultBlocked,
    resolverFailClosed,
    signerRefusesMainnet,
    redactorCatchesSecret,
    rcLiveDisabledPinned,
    reconciliationWallFailsClosed,
    rustDep,
    surface,
  };
}
