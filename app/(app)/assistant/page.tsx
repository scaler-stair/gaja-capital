import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { readyReports, toReportRef } from "@/lib/data";
import { aiConfigured } from "@/lib/ai/client";
import { EmptyState, PageHeader } from "@/components/ui";
import { Chat } from "@/components/assistant/chat";

export const metadata: Metadata = { title: "AI assistant" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const user = await requireUser();
  const reports = (await readyReports()).map(toReportRef);
  const { report } = await searchParams;
  const initialScope = report && reports.some((r) => String(r.id) === report) ? report : "all";

  const suggestions = [
    "Which observations are still awaiting a management response, and who owns them?",
    "Summarise the High-rated findings for the Audit Committee in five points.",
    "What falls due in the next 60 days, and who owns each action?",
    "Which area has the most findings? Show it as a chart.",
    ...(reports.length > 1
      ? ["What changed between the last two reports?", "Which issues have been raised at more than one meeting?"]
      : ["What are the largest rupee amounts involved?"]),
    "What should the Board ask management at the next meeting?",
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI assistant"
        lead="Ask about any board report in plain English. Answers are drawn only from the reports on this dashboard and cite the page each finding comes from."
      />
      {!aiConfigured() ? (
        <EmptyState
          title="The assistant is not switched on yet"
          body={
            user.role === "super_admin"
              ? "Add ANTHROPIC_API_KEY to the server's environment settings and redeploy. The assistant will then answer from the uploaded reports."
              : "The dashboard administrator needs to finish setting up the AI service."
          }
        />
      ) : reports.length === 0 ? (
        <EmptyState
          title="No reports to ask about yet"
          body="Once a board report has been uploaded and read, you can ask the assistant about its findings, owners, deadlines and progress."
        />
      ) : (
        <Chat
          reports={reports.map((r) => ({ id: r.id, period: r.period, title: r.title }))}
          initialScope={initialScope}
          suggestions={suggestions}
        />
      )}
    </div>
  );
}
