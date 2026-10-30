import { authorize, jsonError } from "@/lib/api";
import { aiConfigured } from "@/lib/ai/client";
import { buildAiContext } from "@/lib/ai/context";
import { BRIEF_REQUEST, chatSystem } from "@/lib/ai/prompts";
import { staticAnswer, streamAnswer } from "@/lib/ai/respond";
import { formatDate, todayIso } from "@/lib/format";

export const maxDuration = 120;

/** A consolidated board brief across the selected reports, streamed as NDJSON. */
export async function POST(req: Request) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  if (!aiConfigured()) {
    return jsonError("The AI brief is not switched on yet: ANTHROPIC_API_KEY is missing from the server settings.", 503);
  }
  const body = (await req.json().catch(() => ({}))) as { reportIds?: unknown };
  const reportIds = Array.isArray(body.reportIds)
    ? body.reportIds.filter((n): n is number => Number.isInteger(n))
    : [];
  const context = await buildAiContext(reportIds);
  if (context.reports.length === 0) {
    return staticAnswer("There are no processed reports to compile yet.");
  }
  return streamAnswer({
    system: chatSystem(formatDate(todayIso()), context.text),
    messages: [{ role: "user", content: BRIEF_REQUEST }],
    citations: context.citations,
    maxTokens: 12000,
    userId: auth.user.id,
    kind: "brief",
    question: `Board brief for ${context.reports.map((r) => r.period).join(", ")}`,
    signal: req.signal,
  });
}
