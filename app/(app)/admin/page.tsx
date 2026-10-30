import type { Metadata } from "next";
import { maxUsers, requireSuperAdmin } from "@/lib/auth";
import { aiUsageSummary, listReports, listUsers, recentActivity } from "@/lib/data";
import { aiConfigured, CHAT_EFFORT, EXTRACTION_EFFORT, MODEL } from "@/lib/ai/client";
import { fileSize, formatTimestamp } from "@/lib/format";
import { PageHeader, Panel } from "@/components/ui";
import { UsersPanel } from "@/components/admin/users-panel";

export const metadata: Metadata = { title: "Users and access" };

export default async function AdminPage() {
  const me = await requireSuperAdmin();
  const [users, activity, usage, reports] = await Promise.all([listUsers(), recentActivity(40), aiUsageSummary(), listReports()]);
  const limit = maxUsers();
  const stored = reports.reduce((sum, r) => sum + r.file_size, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users and access"
        lead={`${users.length} of ${limit} user accounts in use. Super admins upload reports and manage access; members can read every report and use the AI assistant.`}
      />
      <UsersPanel users={users} maxUsers={limit} currentUserId={me.id} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Recent activity" description="Sign-ins, uploads and access changes">
          {activity.length === 0 ? (
            <p className="text-sm text-ink-2">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{a.user_name ?? "Removed user"}</span>
                    <span className="text-ink-2">
                      {" "}
                      {a.action.charAt(0).toLowerCase() + a.action.slice(1)}
                      {a.detail ? `: ${a.detail}` : ""}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted">{formatTimestamp(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="System">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">AI service</dt>
              <dd className={aiConfigured() ? "text-ink" : "text-high-ink"}>
                {aiConfigured() ? `Connected, ${MODEL}` : "Not configured: ANTHROPIC_API_KEY is missing"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Reading effort</dt>
              <dd className="text-ink">
                Reports {EXTRACTION_EFFORT}, questions {CHAT_EFFORT}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Reports stored</dt>
              <dd className="tabular text-ink">
                {reports.length}, {fileSize(stored)} of PDFs
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">AI use, last 30 days</dt>
              <dd className="tabular text-ink">
                {usage.questions_30d} questions, {usage.briefs_30d} briefs
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Latest upload</dt>
              <dd className="text-ink">
                {reports.length > 0 ? formatTimestamp([...reports].sort((a, b) => b.created_at.localeCompare(a.created_at))[0].created_at) : "None yet"}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
