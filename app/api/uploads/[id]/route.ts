import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { authorize, jsonError, parseId } from "@/lib/api";
import { CHUNK_BYTES, saveChunk } from "@/lib/pdf-store";

/** Step 2 of an upload: one 2 MB part of the PDF as the raw request body. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  const id = parseId((await ctx.params).id);
  const part = Number(new URL(req.url).searchParams.get("part"));
  if (!id || !Number.isInteger(part) || part < 0) return jsonError("Bad upload part", 400);

  const sql = getSql();
  const rows = await sql`SELECT status, file_size, chunk_count FROM reports WHERE id = ${id}`;
  const report = rows[0] as { status: string; file_size: number; chunk_count: number } | undefined;
  if (!report) return jsonError("Upload not found", 404);
  if (report.status !== "uploading") return jsonError("This upload is already complete", 409);
  if (part >= report.chunk_count) return jsonError("Upload part out of range", 400);

  const data = Buffer.from(await req.arrayBuffer());
  const expected = part < report.chunk_count - 1 ? CHUNK_BYTES : report.file_size - CHUNK_BYTES * (report.chunk_count - 1);
  if (data.length !== expected) {
    return jsonError(`Upload part ${part + 1} arrived incomplete. Try the upload again.`, 400);
  }
  await saveChunk(id, part, data);
  await sql`UPDATE reports SET updated_at = now() WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
