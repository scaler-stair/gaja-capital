import { getSql } from "@/lib/db";
import { authorize, jsonError, parseId } from "@/lib/api";
import { streamPdf } from "@/lib/pdf-store";

/**
 * The original PDF, streamed from the database for signed-in users only.
 * Used by the in-app source viewer and the "Open PDF" links.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const id = parseId((await ctx.params).id);
  if (!id) return jsonError("Report not found", 404);
  const rows = await getSql()`
    SELECT r.file_name, r.file_size, r.chunk_count,
           (SELECT COUNT(*)::int FROM report_chunks c WHERE c.report_id = r.id) AS stored
    FROM reports r WHERE r.id = ${id}`;
  const report = rows[0] as { file_name: string; file_size: number; chunk_count: number; stored: number } | undefined;
  if (!report || report.stored !== report.chunk_count) return jsonError("Report not found", 404);

  const download = new URL(req.url).searchParams.get("download") === "1";
  const safeName = report.file_name.replace(/[^\w.\- ]+/g, "_");
  return new Response(streamPdf(id, report.chunk_count), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(report.file_size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      // Board material behind a login: the browser may cache it briefly, shared caches never.
      "Cache-Control": "private, max-age=300",
    },
  });
}
