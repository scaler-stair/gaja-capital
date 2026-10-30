import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { allObservations, lineageData, readyReports, toReportRef } from "@/lib/data";
import { aiConfigured } from "@/lib/ai/client";
import { EmptyState, PageHeader } from "@/components/ui";
import { CompileView } from "@/components/compile/compile-view";

export const metadata: Metadata = { title: "Compare and compile" };

export default async function CompilePage({ searchParams }: { searchParams: Promise<{ reports?: string }> }) {
  await requireUser();
  const [reports, observations, lineage] = await Promise.all([readyReports(), allObservations(), lineageData()]);
  const { reports: wanted } = await searchParams;
  const requested = (wanted ?? "")
    .split(",")
    .map(Number)
    .filter((n) => reports.some((r) => r.id === n));
  const initialSelected = requested.length > 0 ? requested : reports.map((r) => r.id);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Compare and compile"
        lead="Bring several board reports together: what was raised at each meeting, what repeated or escalated, what closed, and a single brief for the Board."
      />
      {reports.length === 0 ? (
        <EmptyState title="No reports to compile yet" body="Compile views appear once board reports have been uploaded and read." />
      ) : (
        <CompileView
          reports={reports.map((r) => ({ ...toReportRef(r), meeting: r.meeting }))}
          observations={observations}
          links={lineage.links}
          updates={lineage.updates}
          initialSelected={initialSelected}
          aiReady={aiConfigured()}
        />
      )}
    </div>
  );
}
