import type Anthropic from "@anthropic-ai/sdk";
import { authorize, jsonError } from "@/lib/api";
import { aiConfigured } from "@/lib/ai/client";
import { buildAiContext } from "@/lib/ai/context";
import { chatSystem } from "@/lib/ai/prompts";
import { staticAnswer, streamAnswer } from "@/lib/ai/respond";
import { formatDate, todayIso } from "@/lib/format";

export const maxDuration = 120;

const MAX_TURNS = 12;
const MAX_CHARS = 4000;

type Turn = { role: "user" | "assistant"; content: string };

/** The AI assistant: answers grounded in the processed reports, streamed as NDJSON. */
export async function POST(req: Request) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  if (!aiConfigured()) {
    return jsonError("The AI assistant is not switched on yet: ANTHROPIC_API_KEY is missing from the server settings.", 503);
  }
  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; reportIds?: unknown };
  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m): m is Turn =>
        !!m &&
        typeof m === "object" &&
        ((m as Turn).role === "user" || (m as Turn).role === "assistant") &&
        typeof (m as Turn).content === "string" &&
        (m as Turn).content.trim().length > 0
    )
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  // The conversation must open and close on the user's side.
  while (turns.length > 0 && turns[0].role !== "user") turns.shift();
  const question = turns.at(-1);
  if (!question || question.role !== "user") return jsonError("Ask a question", 400);
  const reportIds = Array.isArray(body.reportIds)
    ? body.reportIds.filter((n): n is number => Number.isInteger(n))
    : [];

  const context = await buildAiContext(reportIds);
  if (context.reports.length === 0) {
    return staticAnswer(
      "No board reports have been processed yet. Once the administrator uploads a report, I can answer questions about its findings, owners, deadlines and how it compares with earlier meetings."
    );
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  return streamAnswer({
    system: chatSystem(formatDate(todayIso()), context.text),
    messages,
    citations: context.citations,
    maxTokens: 8000,
    userId: auth.user.id,
    kind: "chat",
    question: question.content,
    signal: req.signal,
  });
}
