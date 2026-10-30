import "server-only";
import { getSql, toBuffer } from "./db";

/**
 * PDFs are stored in Neon as 2 MB rows. bytea travels as hex over Neon's HTTP driver
 * (twice the size), so 2 MB keeps every request and response well inside its limits,
 * and each browser upload request stays under Vercel's 4.5 MB body cap.
 */
export const CHUNK_BYTES = 2 * 1024 * 1024;

/**
 * Claude reads PDFs up to 32 MB per request, base64 included (about 4/3 of the file),
 * which puts the ceiling near 24 MB. 20 MB leaves room for the prompt.
 */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;

export async function saveChunk(reportId: number, index: number, data: Buffer): Promise<void> {
  await getSql()`
    INSERT INTO report_chunks (report_id, idx, data) VALUES (${reportId}, ${index}, ${data})
    ON CONFLICT (report_id, idx) DO UPDATE SET data = EXCLUDED.data`;
}

export async function storedChunkCount(reportId: number): Promise<number> {
  const rows = await getSql()`SELECT COUNT(*)::int AS n FROM report_chunks WHERE report_id = ${reportId}`;
  return rows[0].n as number;
}

async function readChunk(reportId: number, index: number): Promise<Buffer> {
  const rows = await getSql()`SELECT data FROM report_chunks WHERE report_id = ${reportId} AND idx = ${index}`;
  if (rows.length === 0) throw new Error(`Part ${index + 1} of the stored PDF is missing`);
  return toBuffer(rows[0].data);
}

/** The whole PDF, one chunk query at a time. */
export async function readPdf(reportId: number, chunkCount: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (let i = 0; i < chunkCount; i++) parts.push(await readChunk(reportId, i));
  return Buffer.concat(parts);
}

/** Streams the PDF to the browser without holding the whole file in memory. */
export function streamPdf(reportId: number, chunkCount: number): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= chunkCount) {
        controller.close();
        return;
      }
      try {
        controller.enqueue(new Uint8Array(await readChunk(reportId, index++)));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export async function deleteChunks(reportId: number): Promise<void> {
  await getSql()`DELETE FROM report_chunks WHERE report_id = ${reportId}`;
}
