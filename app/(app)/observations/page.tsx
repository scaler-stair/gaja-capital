import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { allObservations, lineageData, readyReports, toReportRef } from "@/lib/data";
import { todayIso } from "@/lib/format";
import { buildThreads, historyByObservation } from "@/lib/lineage";
import { EmptyState, PageHeader } from "@/components/ui";
import { ObservationRegister } from "@/components/observations/register";

export const metadata: Metadata = { title: "Observations" };

export default async function ObservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const [reports, rows, lineage] = await Promise.all([readyReports(), allObservations(), lineageData()]);
  const sp = await searchParams;
  const refs = reports.map(toReportRef);
  const periodOf = new Map(refs.map((r) => [r.id, r.period]));
  const threads = buildThreads(refs, rows, lineage.links, lineage.updates);
  const history = historyByObservation(threads, (id) => periodOf.get(id) ?? "");
  const repeated = threads.filter((t) => t.appearances > 1).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Observations"
        lead={
          reports.length > 1
            ? `Every finding from ${reports.length} board reports. ${repeated > 0 ? `${repeated} issue${repeated === 1 ? " was" : "s were"} raised at more than one meeting; open one to see its history.` : "Open any finding for its detail and source page."}`
            : "Every finding from the board report, with its owner, target date and source page."
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No observations yet" body="Observations appear here once a board report has been uploaded and read." />
      ) : (
        <ObservationRegister
          rows={rows}
          history={history}
          showReport={reports.length > 1}
          today={todayIso()}
          exportHref="/api/observations/export"
          initial={{
            q: sp.q,
            report: sp.report,
            area: sp.area,
            rating: sp.rating,
            status: sp.status,
            owner: sp.owner,
            due: sp.due,
            overdue: sp.overdue,
            open: sp.open,
          }}
        />
      )}
    </div>
  );
}
