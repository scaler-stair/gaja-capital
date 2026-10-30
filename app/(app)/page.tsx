import { requireUser } from "@/lib/auth";
import { allObservations, lineageData, listReports } from "@/lib/data";
import { firstName, todayIso } from "@/lib/format";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { UploadPanel } from "@/components/reports/upload-panel";
import { ProcessingStatus } from "@/components/reports/report-actions";
import { OverviewView } from "@/components/views/overview-view";

export default async function OverviewPage() {
  const user = await requireUser();
  const isAdmin = user.role === "super_admin";
  const [all, everything, lineage] = await Promise.all([listReports(), allObservations(), lineageData()]);
  const ready = all.filter((r) => r.status === "ready");
  const working = all.filter((r) => r.status === "queued" || r.status === "processing");
  const today = todayIso();

  if (ready.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader
          title={`Welcome, ${firstName(user.name)}`}
          lead="Board and audit committee reports, their findings and the actions that follow will appear here."
        />
        {working.map((r) => (
          <Panel key={r.id} title={`Reading ${r.file_name}`}>
            <ProcessingStatus reportId={r.id} stage={r.stage} label={r.stage_label} />
          </Panel>
        ))}
        {isAdmin ? (
          <Panel
            title="Upload the first board report"
            description="The AI reads the PDF, extracts every observation with its owner, target date and source page, and builds this dashboard from it."
          >
            <UploadPanel />
          </Panel>
        ) : (
          working.length === 0 && (
            <EmptyState
              title="No reports yet"
              body="The dashboard administrator uploads each board report after it is presented. You will see its findings here as soon as it has been read."
            />
          )
        )}
      </div>
    );
  }

  return <OverviewView ready={ready} everything={everything} links={lineage.links} updates={lineage.updates} today={today} />;
}
