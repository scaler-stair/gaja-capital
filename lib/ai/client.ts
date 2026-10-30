import "server-only";
import Anthropic from "@anthropic-ai/sdk";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function effort(raw: string | undefined, fallback: Effort): Effort {
  return raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh" || raw === "max" ? raw : fallback;
}

/** Claude Sonnet 5.5 unless overridden. */
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
export const EXTRACTION_EFFORT = effort(process.env.EXTRACTION_EFFORT, "medium");
export const CHAT_EFFORT = effort(process.env.CHAT_EFFORT, "medium");

/**
 * Server-side fallback: if the model declines a request for a policy reason,
 * Anthropic re-runs it on its recommended fallback model inside the same call.
 * On a model without fallback support the request simply runs as normal.
 */
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

let client: Anthropic | null = null;

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function anthropic(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (local) or the Vercel project settings (production).");
  }
  client = new Anthropic({ maxRetries: 3 });
  return client;
}

/** What to tell a board member when a Claude call fails. */
export function friendlyAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key is missing or invalid. The administrator needs to update ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "The Anthropic API key does not have access to this model.";
  if (err instanceof Anthropic.RateLimitError) return "The AI service is at its usage limit right now. Try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `The AI service rejected the request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "The AI service had a temporary problem. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "The AI service took too long to respond. Try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the AI service. Check the network connection and try again.";
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status ?? "unknown"}). Try again shortly.`;
  return err instanceof Error ? err.message : String(err);
}
