import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { parseId } from "@/lib/api";
import { allObservations, getReport, lineageData, readyReports, reportObservations } from "@/lib/data";
import { shortPeriod, todayIso } from "@/lib/format";
import { PageHeader, Panel } from "@/components/ui";
import { ReportView } from "@/components/views/report-view";
import { DeleteReportButton, ProcessingStatus, RetryButton } from "@/components/reports/report-actions";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = parseId((await params).id);
  const report = id ? await getReport(id) : null;
  return { title: report?.status === "ready" ? `${shortPeriod(report)} report` : "Report" };
}

export default async function ReportPage({ params, searchParams }: Params) {
  const user = await requireUser();
  const isAdmin = user.role === "super_admin";
  const id = parseId((await params).id);
  const report = id ? await getReport(id) : null;
  if (!report) notFound();
  const sp = await searchParams;

  if (report.status !== "ready") {
    const working = report.status === "queued" || report.status === "processing";
    return (
      <div className="space-y-8">
        <PageHeader title={report.file_name} lead="This report is not on the dashboard yet." />
        <Panel>
          {working ? (
            <ProcessingStatus reportId={report.id} stage={report.stage} label={report.stage_label} />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-high-ink">{report.error ?? "Reading this report did not finish."}</p>
              {isAdmin && (
                <div className="flex gap-2">
                  {report.status === "failed" && <RetryButton reportId={report.id} />}
                  <DeleteReportButton reportId={report.id} name={report.file_name} after="list" />
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  const [observations, everything, lineage, reports] = await Promise.all([
    reportObservations(report.id),
    allObservations(),
    lineageData(),
    readyReports(),
  ]);
  return (
    <ReportView
      report={report}
      observations={observations}
      everything={everything}
      links={lineage.links}
      updates={lineage.updates}
      reports={reports}
      isAdmin={isAdmin}
      today={todayIso()}
      initial={{
        q: sp.q,
        area: sp.area,
        rating: sp.rating,
        status: sp.status,
        owner: sp.owner,
        due: sp.due,
        overdue: sp.overdue,
        open: sp.open,
      }}
    />
  );
}
