import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { anthropic, EXTRACTION_EFFORT, FALLBACK, MODEL } from "./client";
import { EXTRACTION_SYSTEM, detailsInstruction, indexInstruction, narrativeInstruction } from "./prompts";
import {
  DetailsExtraction,
  IndexExtraction,
  NarrativeExtraction,
  type DetailOutput,
  type IndexOutput,
  type IndexResult,
  type NarrativeOutput,
} from "./schemas";

export type Usage = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export function emptyUsage(): Usage {
  return { calls: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

export function addUsage(total: Usage, u: Anthropic.Beta.BetaUsage): void {
  total.calls++;
  total.input_tokens += u.input_tokens;
  total.output_tokens += u.output_tokens;
  total.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
  total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
}

/** Observations per detail call. Small batches run in parallel and fail independently. */
const DETAIL_BATCH = 6;
const DETAIL_CONCURRENCY = 3;

/**
 * One structured-output call over the PDF. The system prompt and the document are
 * identical across every call for a report, and the document block carries the
 * cache breakpoint, so after the first call the PDF is read from the prompt cache.
 */
async function readDocument<S extends z.ZodType>(
  schema: S,
  pdfBase64: string,
  instruction: string,
  maxTokens: number,
  usage: Usage
): Promise<z.infer<S>> {
  const { format, parse } = jsonFormat(schema);
  const stream = anthropic().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    ...FALLBACK,
    output_config: { effort: EXTRACTION_EFFORT, format },
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: instruction },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  addUsage(usage, message.usage);
  return parse(message);
}

/**
 * Structured output, parsed by us rather than inside the SDK stream, so a refusal or a
 * truncated answer is reported as such instead of as a JSON syntax error.
 */
export function jsonFormat<S extends z.ZodType>(schema: S) {
  const auto = betaZodOutputFormat(schema);
  return {
    format: { type: "json_schema" as const, schema: auto.schema },
    parse(message: Anthropic.Beta.BetaMessage): z.infer<S> {
      if (message.stop_reason === "refusal") throw new Error("The AI declined to read this document.");
      if (message.stop_reason === "max_tokens") throw new Error("The AI ran out of room while reading this report.");
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      try {
        return auto.parse(text) as z.infer<S>;
      } catch (err) {
        console.error("Structured output did not validate:", err);
        throw new Error("The AI's answer could not be read as structured data.");
      }
    },
  };
}

/** Pass 1: the report's details and the index of every observation. */
export async function extractIndex(pdfBase64: string, knownAreas: string[], usage: Usage): Promise<IndexResult> {
  return readDocument(IndexExtraction, pdfBase64, indexInstruction(knownAreas), 24000, usage);
}

/**
 * The overview sections: headline, executive summary, key figures, areas, way forward, asks
 * of the Committee, variance and status updates on earlier reports. Runs alongside pass 2.
 * Returns null after two failures, so the observations can still be published.
 */
export async function extractNarrative(pdfBase64: string, usage: Usage): Promise<NarrativeOutput | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await readDocument(NarrativeExtraction, pdfBase64, narrativeInstruction(), 24000, usage);
    } catch (err) {
      console.error("Narrative extraction failed:", err);
    }
  }
  return null;
}

/**
 * Pass 2: the full write-up of every indexed observation, in parallel batches.
 * A batch that fails twice is reported in `missing` instead of failing the report:
 * those observations still appear, with their tracker-level fields.
 */
export async function extractDetails(
  pdfBase64: string,
  index: IndexOutput[],
  usage: Usage,
  onProgress?: (done: number, total: number) => Promise<void>
): Promise<{ details: Map<string, DetailOutput>; missing: string[] }> {
  const batches: IndexOutput[][] = [];
  for (let i = 0; i < index.length; i += DETAIL_BATCH) batches.push(index.slice(i, i + DETAIL_BATCH));

  const details = new Map<string, DetailOutput>();
  const missing: string[] = [];
  let done = 0;
  let next = 0;

  async function runBatch(batch: IndexOutput[]) {
    const instruction = detailsInstruction(
      batch.map((o) => ({ ref: o.ref, title: o.title, page: o.source_page > 0 ? o.source_page : null }))
    );
    let result: z.infer<typeof DetailsExtraction> | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await readDocument(DetailsExtraction, pdfBase64, instruction, 24000, usage);
      } catch (err) {
        console.error(`Detail extraction failed for ${batch.map((o) => o.ref).join(", ")}:`, err);
      }
    }
    const wanted = new Map(batch.map((o) => [refKey(o.ref), o.ref]));
    for (const d of result?.observations ?? []) {
      const ref = wanted.get(refKey(d.ref));
      if (ref && !details.has(ref)) details.set(ref, d);
    }
    for (const o of batch) if (!details.has(o.ref)) missing.push(o.ref);
    done += batch.length;
    await onProgress?.(done, index.length);
  }

  async function worker() {
    while (next < batches.length) await runBatch(batches[next++]);
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, batches.length) }, worker));
  return { details, missing };
}

export function refKey(ref: string): string {
  return ref.trim().toUpperCase().replace(/\s+/g, "");
}
