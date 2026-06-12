import { z } from "zod";
import { TRADING_MODES } from "../modes.js";

/**
 * Hard ceilings the config can never exceed. These are defense-in-depth bounds
 * baked into the schema itself: even a hand-edited config cannot arm a
 * dangerously large trade size or position count. They are intentionally tiny.
 */
export const HARD_LIMITS = {
  /** Absolute max SOL per single trade. */
  maxTradeSizeSol: 1.0,
  /** Absolute max cumulative daily loss before trading halts. */
  maxDailyLossSol: 5.0,
  /** Absolute max simultaneously-open positions. */
  maxOpenPositions: 20,
} as const;

export const CapsSchema = z
  .object({
    maxTradeSizeSol: z
      .number()
      .positive()
      .max(HARD_LIMITS.maxTradeSizeSol, {
        message: `maxTradeSizeSol exceeds hard limit of ${HARD_LIMITS.maxTradeSizeSol} SOL`,
      }),
    maxDailyLossSol: z
      .number()
      .positive()
      .max(HARD_LIMITS.maxDailyLossSol, {
        message: `maxDailyLossSol exceeds hard limit of ${HARD_LIMITS.maxDailyLossSol} SOL`,
      }),
    maxOpenPositions: z
      .number()
      .int()
      .positive()
      .max(HARD_LIMITS.maxOpenPositions, {
        message: `maxOpenPositions exceeds hard limit of ${HARD_LIMITS.maxOpenPositions}`,
      }),
  })
  .strict();

export const LiveSchema = z
  .object({
    /** Operator has acknowledged that live mode can lose all burner funds. */
    acknowledgeBurnerRisk: z.boolean().default(false),
    /** Operator confirms the wallet is a fresh, throwaway burner. */
    confirmFreshBurner: z.boolean().default(false),
    /**
     * NAME of the env var that holds the burner secret key — never the key.
     * The key itself is read only at send time and is never stored in config.
     */
    burnerKeyEnvVar: z.string().min(1).optional(),
  })
  .strict();

export const LoggingSchema = z
  .object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    /** Redaction is mandatory; see refinement below. */
    redact: z.boolean().default(true),
  })
  .strict();

export const ConfigSchema = z
  .object({
    mode: z.enum(TRADING_MODES).default("PAPER"),
    /** Global halt: when true, every trading action is refused. */
    killSwitch: z.boolean().default(false),
    /**
     * Sprint 92: ONE of the FOURTEEN mainnet live-gate conditions (see
     * @soulmaker/execution). Setting it true does NOT enable live trading by
     * itself — every other gate must independently pass. Default: false.
     */
    phase7LiveTradingReady: z.boolean().default(false),
    rpcUrl: z.string().url().optional(),
    wsUrl: z.string().url().optional(),
    watchPublicKeys: z.array(z.string().min(32)).default([]),
    caps: CapsSchema.default({
      maxTradeSizeSol: 0.05,
      maxDailyLossSol: 0.25,
      maxOpenPositions: 3,
    }),
    live: LiveSchema.default({
      acknowledgeBurnerRisk: false,
      confirmFreshBurner: false,
    }),
    logging: LoggingSchema.default({ level: "info", redact: true }),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    // Security rule: redacted logging is non-negotiable.
    if (cfg.logging.redact === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["logging", "redact"],
        message:
          "Log redaction cannot be disabled — secrets must always be redacted.",
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
export type Caps = z.infer<typeof CapsSchema>;
export type LiveConfig = z.infer<typeof LiveSchema>;
