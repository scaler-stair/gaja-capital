import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listReports } from "@/lib/data";
import { fileSize, formatDate, formatTimestamp, shortPeriod } from "@/lib/format";
import type { ReportRow } from "@/lib/types";
import { EmptyState, PageHeader, Panel, SeverityBar, button } from "@/components/ui";
import { UploadPanel } from "@/components/reports/upload-panel";
import { DeleteReportButton, ProcessingStatus, RetryButton } from "@/components/reports/report-actions";

export const metadata: Metadata = { title: "Board reports" };

function presentedBy(r: ReportRow): string | null {
  if (r.meeting && r.auditor) return `Presented to the ${r.meeting} by ${r.auditor}`;
  if (r.meeting) return `Presented to the ${r.meeting}`;
  if (r.auditor) return `Prepared by ${r.auditor}`;
  return null;
}

function ReportItem({ r, isAdmin }: { r: ReportRow; isAdmin: boolean }) {
  const ready = r.status === "ready";
  const working = r.status === "queued" || r.status === "processing" || r.status === "uploading";
  const name = ready ? shortPeriod(r) : r.file_name;
  return (
    <li className="rounded-xl border border-rule bg-surface p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="w-32 shrink-0">
          <div className="text-lg font-semibold text-ink">{ready ? shortPeriod(r) : "New upload"}</div>
          <div className="text-xs text-muted">{ready ? r.overview?.date_text ?? formatDate(r.report_date) : formatTimestamp(r.created_at)}</div>
        </div>
        <div className="min-w-0 flex-1">
          {ready ? (
            <Link href={`/reports/${r.id}`} className="font-serif text-[1.15rem] font-medium leading-snug text-ink hover:underline">
              {r.title ?? r.file_name}
            </Link>
          ) : (
            <p className="truncate text-[0.95rem] font-medium text-ink">{r.file_name}</p>
          )}
          {ready && presentedBy(r) && <p className="mt-1 text-sm text-ink-2">{presentedBy(r)}</p>}
          {ready && (
            <div className="mt-3 max-w-lg">
              <SeverityBar counts={{ High: r.high, Medium: r.medium, Low: r.low }} height={8} />
            </div>
          )}
          {working && (
            <div className="mt-3">
              {r.status === "uploading" ? (
                <p className="text-sm text-ink-2">Upload in progress</p>
              ) : (
                <ProcessingStatus reportId={r.id} stage={r.stage} label={r.stage_label} />
              )}
            </div>
          )}
          {r.status === "failed" && <p className="mt-2 text-sm text-high-ink">{r.error ?? "Reading this report failed."}</p>}
          <p className="tabular mt-3 text-xs text-muted">
            {r.file_name}, {fileSize(r.file_size)}
            {r.page_count ? `, ${r.page_count} pages` : ""}
            {r.uploaded_by_name ? `. Uploaded by ${r.uploaded_by_name}, ${formatTimestamp(r.created_at)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:justify-end">
          {ready && (
            <Link href={`/reports/${r.id}`} className={button.secondary}>
              Open
            </Link>
          )}
          {r.status !== "uploading" && (
            <a href={`/api/reports/${r.id}/pdf`} target="_blank" rel="noreferrer" className={button.quiet}>
              PDF <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
          {isAdmin && r.status === "failed" && <RetryButton reportId={r.id} />}
          {isAdmin && !working && <DeleteReportButton reportId={r.id} name={name} />}
          {isAdmin && r.status === "uploading" && <DeleteReportButton reportId={r.id} name={name} />}
        </div>
      </div>
    </li>
  );
}

export default async function ReportsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "super_admin";
  const reports = (await listReports()).reverse();
  const readyCount = reports.filter((r) => r.status === "ready").length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Board reports"
        lead={
          readyCount > 0
            ? `${readyCount} report${readyCount === 1 ? "" : "s"} on the dashboard, newest first. Open one to see its findings, or compare several on the Compare and compile page.`
            : "Board and audit committee reports appear here once they are uploaded and read."
        }
      />
      {isAdmin && (
        <Panel
          title="Upload a report"
          description="The PDF of a board or audit committee report. The AI reads it, extracts every observation with its source page, and links it to earlier meetings."
        >
          <UploadPanel />
        </Panel>
      )}
      {reports.length === 0 ? (
        !isAdmin && (
          <EmptyState
            title="No reports yet"
            body="The dashboard administrator uploads each board report after the meeting. It will appear here as soon as it has been read."
          />
        )
      ) : (
        <ol className="space-y-3">
          {reports.map((r) => (
            <ReportItem key={r.id} r={r} isAdmin={isAdmin} />
          ))}
        </ol>
      )}
    </div>
  );
}
