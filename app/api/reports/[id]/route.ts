import { NextResponse, after } from "next/server";
import { getSql } from "@/lib/db";
import { authorize, jsonError, parseId } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { getReport } from "@/lib/data";
import { shortPeriod } from "@/lib/format";
import { syncLineage } from "@/lib/lineage-sync";

// Deleting a report can mean re-linking the reports after it, which may call Claude.
export const maxDuration = 300;

/** Processing status, polled by the upload panel while a report is being read. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const id = parseId((await ctx.params).id);
  const report = id ? await getReport(id) : null;
  if (!report) return jsonError("Report not found", 404);
  return NextResponse.json({
    id: report.id,
    status: report.status,
    stage: report.stage,
    stageLabel: report.stage_label,
    error: report.error,
    period: report.status === "ready" ? shortPeriod(report) : null,
    observations: report.observation_count,
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  const id = parseId((await ctx.params).id);
  const report = id ? await getReport(id) : null;
  if (!report) return jsonError("Report not found", 404);
  if (report.status === "processing" || report.status === "queued") {
    return jsonError("This report is still being read. Wait for it to finish, then delete it.", 409);
  }
  await getSql()`DELETE FROM reports WHERE id = ${report.id}`;
  await logActivity(auth.user.id, "Deleted report", `${shortPeriod(report)} (${report.file_name})`);
  // Reports after the deleted one now have a different history; re-link them.
  after(async () => {
    try {
      await syncLineage();
    } catch (err) {
      console.error("Re-linking reports after delete failed:", err);
    }
  });
  return NextResponse.json({ ok: true });
}
