import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getSql } from "../db";
import { anthropic, CHAT_EFFORT, FALLBACK, MODEL, friendlyAiError } from "./client";
import type { Citation } from "../types";

/**
 * Events streamed to the browser as newline-delimited JSON. The client reads
 * "meta" first (citation targets), then "text" deltas, then "done" or "error".
 */
export type StreamEvent =
  | { type: "meta"; citations: Record<string, Citation> }
  | { type: "text"; text: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

const encoder = new TextEncoder();
const encode = (event: StreamEvent) => encoder.encode(JSON.stringify(event) + "\n");

export function ndjsonResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

/** A one-off message in the same format, for answers that need no model call. */
export function staticAnswer(text: string): Response {
  return ndjsonResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encode({ type: "meta", citations: {} }));
        controller.enqueue(encode({ type: "text", text }));
        controller.enqueue(encode({ type: "done" }));
        controller.close();
      },
    })
  );
}

/**
 * Streams Claude's answer to the browser. The system prompt (instructions plus the
 * report data) carries the cache breakpoint, so follow-up questions within a few
 * minutes read the report data from the prompt cache instead of paying for it again.
 */
export function streamAnswer(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  citations: Record<string, Citation>;
  maxTokens: number;
  userId: number;
  kind: "chat" | "brief";
  question: string;
  signal: AbortSignal;
}): Response {
  const started = Date.now();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encode(event));
        } catch {
          // The browser went away; nothing left to deliver.
        }
      };
      send({ type: "meta", citations: opts.citations });
      let answer = "";
      try {
        const stream = anthropic().beta.messages.stream(
          {
            model: MODEL,
            max_tokens: opts.maxTokens,
            ...FALLBACK,
            output_config: { effort: CHAT_EFFORT },
            system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
            messages: opts.messages,
          },
          { signal: opts.signal }
        );
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            answer += event.delta.text;
            send({ type: "text", text: event.delta.text });
          }
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") {
          send({ type: "error", message: "The assistant could not answer this question. Try rephrasing it." });
        } else if (message.stop_reason === "max_tokens") {
          send({ type: "notice", message: "The answer reached its length limit. Ask a narrower question for the rest." });
        }
        send({ type: "done" });
        void logQuestion(opts, answer, message.usage, Date.now() - started);
      } catch (err) {
        if (!opts.signal.aborted) {
          console.error(`AI ${opts.kind} failed:`, err);
          send({ type: "error", message: friendlyAiError(err) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect.
        }
      }
    },
  });
  return ndjsonResponse(body);
}

async function logQuestion(
  opts: { userId: number; kind: string; question: string },
  answer: string,
  usage: Anthropic.Beta.BetaUsage,
  latencyMs: number
): Promise<void> {
  try {
    await getSql()`
      INSERT INTO ai_questions (user_id, kind, question, answer, model, input_tokens, output_tokens, cache_read_tokens, latency_ms)
      VALUES (${opts.userId}, ${opts.kind}, ${opts.question.slice(0, 4000)}, ${answer}, ${MODEL},
              ${usage.input_tokens}, ${usage.output_tokens}, ${usage.cache_read_input_tokens ?? 0}, ${latencyMs})`;
  } catch (err) {
    console.error("Could not log AI question:", err);
  }
}
