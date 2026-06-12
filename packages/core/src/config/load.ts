import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigSchema, type Config } from "./schema.js";

export const DEFAULT_CONFIG_FILENAME = "soulmaker.config.json";

export interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Explicit path to a config JSON file. Overrides cwd lookup. */
  configPath?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Load and validate config. Precedence (lowest to highest):
 *   schema defaults  <  config JSON file  <  environment overrides
 *
 * Throws {@link ConfigError} with a readable message on invalid config.
 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const file = options.configPath ?? join(cwd, DEFAULT_CONFIG_FILENAME);

  let raw: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      // PowerShell redirection writes a UTF-8/UTF-16 BOM; JSON.parse refuses a leading U+FEFF
      // with a confusing "Unexpected token" error, so strip it before parsing (S90 bug).
      raw = JSON.parse(stripBom(readFileSync(file, "utf8"))) as Record<string, unknown>;
    } catch (err) {
      throw new ConfigError(
        `Failed to parse config file at ${file}: ${(err as Error).message}`,
      );
    }
  }

  // JSON config files commonly use null for "unset"; treat null as absent so
  // optional fields fall back to schema defaults instead of failing validation.
  raw = stripNulls(raw) as Record<string, unknown>;
  raw = applyEnvOverrides(raw, env);

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid Soulmaker config:\n${issues}`);
  }
  return parsed.data;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== null).map(stripNulls);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

function applyEnvOverrides(
  raw: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const out = { ...raw };

  if (env.SOULMAKER_MODE) out.mode = env.SOULMAKER_MODE;
  if (env.SOULMAKER_KILL_SWITCH !== undefined) {
    out.killSwitch = parseBool(env.SOULMAKER_KILL_SWITCH);
  }
  if (env.SOULMAKER_RPC_URL) out.rpcUrl = env.SOULMAKER_RPC_URL;
  if (env.SOULMAKER_WS_URL) out.wsUrl = env.SOULMAKER_WS_URL;

  if (env.SOULMAKER_LOG_LEVEL) {
    out.logging = { ...(out.logging as object), level: env.SOULMAKER_LOG_LEVEL };
  }

  if (env.SOULMAKER_BURNER_KEY_ENV) {
    out.live = {
      ...(out.live as object),
      burnerKeyEnvVar: env.SOULMAKER_BURNER_KEY_ENV,
    };
  }

  return out;
}

function parseBool(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}
