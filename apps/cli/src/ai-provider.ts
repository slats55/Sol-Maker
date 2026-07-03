/**
 * The Anthropic AI-ranking PROVIDER SEAM (Sprint 108 Final RC).
 *
 * The only network call in the advisory AI layer, kept at the CLI boundary (packages/live stays
 * pure) and injectable for tests. Contract:
 *
 *   - Runs ONLY when the operator passes --ai AND ANTHROPIC_API_KEY is present in the env. There
 *     is no ambient key discovery and no retry loop — one bounded request.
 *   - Hard timeout (default 20s) via AbortController. A timeout, HTTP error, refusal, or
 *     unparseable body THROWS AiProviderError; the caller falls back to the deterministic ranking
 *     and the system keeps working. An AI failure can never block the loop.
 *   - The request carries ONLY the eligible-candidate facts (mint/score/decision/confidence/
 *     warnings) — never a key, never a wallet, never a blocked mint.
 *   - Structured outputs (`output_config.format` json_schema) constrain the response so the model
 *     returns exactly the shape the deterministic clamp validates again anyway.
 */

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const AI_PROVIDER_DEFAULT_MODEL = "claude-opus-4-8";
export const AI_PROVIDER_TIMEOUT_MS = 20_000;

/** The strict JSON schema the model's response is constrained to. */
export const AI_RANKING_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    rankings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          mint: { type: "string" },
          rank: { type: "integer" },
          rationale: { type: "string" },
        },
        required: ["mint", "rank", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["rankings"],
  additionalProperties: false,
} as const;

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface AnthropicRankRequest {
  system: string;
  user: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchLike?: FetchLike;
}

/** One bounded Anthropic messages call. Returns the parsed JSON body of the model's text, or throws. */
export async function callAnthropicRanker(req: AnthropicRankRequest): Promise<unknown> {
  const fetchLike: FetchLike = req.fetchLike ?? (fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timeoutMs = req.timeoutMs ?? AI_PROVIDER_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchLike(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: req.model ?? AI_PROVIDER_DEFAULT_MODEL,
        max_tokens: 2048,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: { type: "json_schema", schema: AI_RANKING_OUTPUT_SCHEMA } },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AiProviderError(`Anthropic API HTTP ${response.status} — falling back to deterministic ranking`);
    }
    const bodyText = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new AiProviderError("Anthropic API returned unparseable JSON — falling back");
    }
    const msg = body as { stop_reason?: string; content?: Array<{ type?: string; text?: string }> };
    if (msg.stop_reason === "refusal") throw new AiProviderError("Anthropic API refused the request — falling back");
    const text = (msg.content ?? []).find((b) => b.type === "text")?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new AiProviderError("Anthropic API returned no text content — falling back");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new AiProviderError("Anthropic API text was not the requested strict JSON — falling back");
    }
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    const msg = err instanceof Error ? (err.name === "AbortError" ? `timed out after ${timeoutMs}ms` : err.message) : String(err);
    throw new AiProviderError(`Anthropic API call failed (${msg}) — falling back to deterministic ranking`);
  } finally {
    clearTimeout(timer);
  }
}
