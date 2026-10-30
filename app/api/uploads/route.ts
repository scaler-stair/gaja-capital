import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { authorize, jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { aiConfigured } from "@/lib/ai/client";
import { CHUNK_BYTES, MAX_PDF_BYTES, MAX_PDF_PAGES } from "@/lib/pdf-store";
import { fileSize, shortPeriod } from "@/lib/format";

/**
 * Step 1 of an upload: register the file. The browser then sends it in 2 MB parts
 * (PUT /api/uploads/:id?part=n) and finishes with POST /api/uploads/:id/complete.
 */
export async function POST(req: Request) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  if (!aiConfigured()) {
    return jsonError("Report reading is not switched on yet: ANTHROPIC_API_KEY is missing from the server settings.", 503);
  }
  const body = (await req.json().catch(() => ({}))) as {
    fileName?: unknown;
    fileSize?: unknown;
    sha256?: unknown;
    pageCount?: unknown;
  };
  const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 200) : "";
  const size = typeof body.fileSize === "number" ? body.fileSize : 0;
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  const pageCount = typeof body.pageCount === "number" && Number.isInteger(body.pageCount) ? body.pageCount : null;

  if (!/\.pdf$/i.test(fileName)) return jsonError("Only PDF files can be uploaded", 400);
  if (!Number.isInteger(size) || size <= 0) return jsonError("The file is empty", 400);
  if (size > MAX_PDF_BYTES) {
    return jsonError(`The PDF is ${fileSize(size)}. The limit is ${fileSize(MAX_PDF_BYTES)}; compress it or split it first.`, 413);
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) return jsonError("Missing file checksum", 400);
  if (pageCount !== null && pageCount > MAX_PDF_PAGES) {
    return jsonError(`The PDF has ${pageCount} pages. The limit is ${MAX_PDF_PAGES}.`, 413);
  }

  const sql = getSql();
  const existing = await sql`
    SELECT id, status, quarter, fiscal_year, period_label, report_date::text AS report_date, file_name,
           (status IN ('uploading', 'queued', 'processing') AND updated_at < now() - interval '15 minutes') AS stale
    FROM reports WHERE file_sha256 = ${sha256}`;
  const prev = existing[0] as
    | { id: number; status: string; stale: boolean; quarter: string | null; fiscal_year: string | null; period_label: string | null; report_date: string | null; file_name: string }
    | undefined;
  if (prev) {
    if (prev.status === "ready") {
      return jsonError(`This PDF is already on the dashboard as ${shortPeriod(prev)}.`, 409);
    }
    if (!prev.stale && (prev.status === "queued" || prev.status === "processing")) {
      return jsonError("This PDF is already being read. It will appear on the dashboard when it is ready.", 409);
    }
    // A failed, abandoned or interrupted upload holds no usable data; start over.
    await sql`DELETE FROM reports WHERE id = ${prev.id}`;
  }

  const inserted = await sql`
    INSERT INTO reports (file_name, file_size, file_sha256, page_count, chunk_count, status, stage_label, uploaded_by)
    VALUES (${fileName}, ${size}, ${sha256}, ${pageCount}, ${Math.ceil(size / CHUNK_BYTES)}, 'uploading', 'Uploading', ${auth.user.id})
    RETURNING id, chunk_count`;
  await logActivity(auth.user.id, "Started report upload", fileName);
  return NextResponse.json({
    reportId: inserted[0].id as number,
    chunkBytes: CHUNK_BYTES,
    chunkCount: inserted[0].chunk_count as number,
  });
}
