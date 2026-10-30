import { NextResponse, after } from "next/server";
import { getSql } from "@/lib/db";
import { authorize, jsonError, parseId } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { storedChunkCount } from "@/lib/pdf-store";
import { processReport } from "@/lib/pipeline";

// Reading a report runs after this response is sent, inside this function's time
// limit: 300 s is the Vercel Hobby maximum (Pro allows up to 800).
export const maxDuration = 300;

/** Step 3 of an upload: every part is stored, so queue the report for reading. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  const id = parseId((await ctx.params).id);
  if (!id) return jsonError("Upload not found", 404);

  const sql = getSql();
  const rows = await sql`SELECT status, chunk_count, file_name FROM reports WHERE id = ${id}`;
  const report = rows[0] as { status: string; chunk_count: number; file_name: string } | undefined;
  if (!report) return jsonError("Upload not found", 404);
  if (report.status !== "uploading") return jsonError("This upload is already complete", 409);
  const stored = await storedChunkCount(id);
  if (stored !== report.chunk_count) {
    return jsonError(`Only ${stored} of ${report.chunk_count} parts arrived. Upload the PDF again.`, 400);
  }

  // Conditional, so a repeated "complete" (double click, second tab) cannot queue the report twice.
  const queued = await sql`
    UPDATE reports SET status = 'queued', stage = 0, stage_label = 'Queued', error = NULL, updated_at = now()
    WHERE id = ${id} AND status = 'uploading'
    RETURNING id`;
  if (queued.length === 0) return jsonError("This upload is already complete", 409);
  await logActivity(auth.user.id, "Uploaded report", report.file_name);
  after(() => processReport(id));
  return NextResponse.json({ ok: true, reportId: id }, { status: 202 });
}
