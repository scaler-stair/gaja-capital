import { NextResponse, after } from "next/server";
import { getSql } from "@/lib/db";
import { authorize, jsonError, parseId } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { aiConfigured } from "@/lib/ai/client";
import { getReport } from "@/lib/data";
import { CHUNK_BYTES, storedChunkCount } from "@/lib/pdf-store";
import { processReport } from "@/lib/pipeline";

export const maxDuration = 300;

/** Reads a stored report again: after a failure, or to refresh a report with missing detail. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  if (!aiConfigured()) return jsonError("ANTHROPIC_API_KEY is missing from the server settings.", 503);
  const id = parseId((await ctx.params).id);
  const report = id ? await getReport(id) : null;
  if (!report) return jsonError("Report not found", 404);
  if (report.status === "processing" || report.status === "queued" || report.status === "uploading") {
    return jsonError("This report is not ready to be read again yet.", 409);
  }
  if ((await storedChunkCount(report.id)) !== Math.ceil(report.file_size / CHUNK_BYTES)) {
    return jsonError("The stored PDF is incomplete. Delete this entry and upload the PDF again.", 409);
  }
  // Conditional, so two clicks (or two admins) cannot start two readings of the same report.
  const queued = await getSql()`
    UPDATE reports SET status = 'queued', stage = 0, stage_label = 'Queued', error = NULL, updated_at = now()
    WHERE id = ${report.id}
      AND (status IN ('failed', 'ready')
           OR (status IN ('queued', 'processing') AND updated_at < now() - interval '15 minutes'))
    RETURNING id`;
  if (queued.length === 0) return jsonError("This report is already being read.", 409);
  await logActivity(auth.user.id, "Re-ran report reading", report.file_name);
  after(() => processReport(report.id));
  return NextResponse.json({ ok: true }, { status: 202 });
}
