import "server-only";
import { createHash } from "crypto";
import { getSql } from "./db";
import { readPdf } from "./pdf-store";
import { syncLineage } from "./lineage-sync";
import { MODEL, friendlyAiError } from "./ai/client";
import { emptyUsage, extractDetails, extractIndex, extractNarrative, refKey, type Usage } from "./ai/extract";
import { EMPTY_NARRATIVE, type DetailOutput, type IndexOutput, type OverviewOutput } from "./ai/schemas";
import type { ReportOverview } from "./types";

/**
 * The five stages a report moves through. The upload screen draws them as the
 * five pillars of the Gaja mark, filling one by one.
 */
export const STAGES = [
  "Reading the document",
  "Indexing the observations",
  "Reading each finding in detail",
  "Linking with earlier reports",
  "Ready",
] as const;

async function setStage(reportId: number, stage: number, label: string): Promise<void> {
  await getSql()`
    UPDATE reports SET status = 'processing', stage = ${stage}, stage_label = ${label}, updated_at = now()
    WHERE id = ${reportId}`;
}

/**
 * Turns a stored PDF into a published report: Claude reads it twice (an index pass,
 * then detail passes in parallel), the findings are saved, and the report is linked
 * to earlier ones. Runs after the upload response via next/server's after(), so it
 * must finish inside the route's maxDuration. Any failure is saved on the report
 * for the super admin to see and retry.
 */
export async function processReport(reportId: number): Promise<void> {
  const sql = getSql();
  const usage = emptyUsage();
  // Claim the queued report atomically, so two triggers can never read it twice in parallel.
  const claimed = await sql`
    UPDATE reports SET status = 'processing', stage = 1, stage_label = ${STAGES[0]}, updated_at = now()
    WHERE id = ${reportId} AND status = 'queued'
    RETURNING chunk_count, file_size, file_sha256`;
  const report = claimed[0] as { chunk_count: number; file_size: number; file_sha256: string } | undefined;
  if (!report) return;
  try {
    const pdf = await readPdf(reportId, report.chunk_count);
    if (pdf.length !== report.file_size || createHash("sha256").update(pdf).digest("hex") !== report.file_sha256) {
      throw new Error("The stored file does not match what was uploaded. Delete this entry and upload the PDF again.");
    }
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new Error("This file is not a PDF.");
    }
    const base64 = pdf.toString("base64");
    const areaRows = await sql`
      SELECT DISTINCT o.area FROM observations o JOIN reports r ON r.id = o.report_id
      WHERE r.status = 'ready' AND r.id <> ${reportId} ORDER BY o.area`;
    const knownAreas = areaRows.map((a) => a.area as string);

    await setStage(reportId, 2, STAGES[1]);
    const indexed = await extractIndex(base64, knownAreas, usage);
    const index = uniqueRefs(indexed.observations);

    // The overview sections are read alongside the per-finding detail.
    await setStage(reportId, 3, `${STAGES[2]} (0 of ${index.length})`);
    const [narrative, { details, missing }] = await Promise.all([
      extractNarrative(base64, usage),
      extractDetails(base64, index, usage, (done, total) => setStage(reportId, 3, `${STAGES[2]} (${done} of ${total})`)),
    ]);
    const overview: OverviewOutput = { ...indexed, ...(narrative ?? EMPTY_NARRATIVE) };
    const warnings: string[] = [];
    if (!narrative) {
      warnings.push("The summary sections (headline, key figures, way forward) could not be read; retry processing to fill them in.");
    }
    if (index.length === 0) warnings.push("No audit observations were found in this document.");
    if (missing.length > 0) {
      warnings.push(
        `Full detail could not be read for ${missing.join(", ")}. These show tracker-level information only; retry processing to fill them in.`
      );
    }
    await saveExtraction(reportId, overview, index, details, warnings, usage);

    await setStage(reportId, 4, STAGES[3]);
    try {
      await syncLineage(reportId);
    } catch (err) {
      console.error(`Linking report ${reportId} to earlier reports failed:`, err);
    }

    await sql`
      UPDATE reports
      SET status = 'ready', stage = 5, stage_label = ${STAGES[4]}, error = NULL,
          processed_at = now(), updated_at = now()
      WHERE id = ${reportId}`;
  } catch (err) {
    console.error(`Processing report ${reportId} failed:`, err);
    await sql`
      UPDATE reports SET status = 'failed', error = ${friendlyAiError(err)}, usage = ${JSON.stringify(usage)}::jsonb,
             updated_at = now()
      WHERE id = ${reportId}`;
  }
}

/** Refs must be unique within a report; a repeated or blank ref gets a suffix. */
function uniqueRefs(items: IndexOutput[]): IndexOutput[] {
  const seen = new Set<string>();
  return items.map((item, i) => {
    let ref = item.ref.trim() || `OBS-${i + 1}`;
    let n = 2;
    while (seen.has(refKey(ref))) ref = `${item.ref.trim() || "OBS"}-${n++}`;
    seen.add(refKey(ref));
    return { ...item, ref };
  });
}

const blank = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

function isoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
}

const positive = (n: number): number | null => (Number.isFinite(n) && n > 0 ? n : null);
const strings = (list: string[]): string[] => list.map((s) => s.trim()).filter(Boolean);

function toOverview(o: OverviewOutput, warnings: string[]): ReportOverview {
  const variance = o.variance.items.length > 0
    ? {
        title: o.variance.title,
        unit: o.variance.unit,
        previous_label: o.variance.previous_label,
        current_label: o.variance.current_label,
        items: o.variance.items.map((v) => ({
          label: v.label,
          previous: Number.isFinite(v.previous) ? v.previous : null,
          current: Number.isFinite(v.current) ? v.current : null,
          comment: blank(v.comment),
        })),
      }
    : null;
  return {
    headline: o.headline.trim(),
    scope_note: blank(o.scope_note),
    date_text: blank(o.report_date_text),
    executive_summary: o.executive_summary.filter((p) => p.heading.trim() || p.detail.trim()),
    key_metrics: o.key_metrics.map((m) => ({
      label: m.label,
      value: m.value,
      amount_inr: positive(m.amount_inr),
      ref: blank(m.ref),
    })),
    areas: o.areas.map((a) => ({ name: a.name, scope: strings(a.scope), high: a.high, medium: a.medium, low: a.low })),
    rating_scale: o.rating_scale.filter((r) => r.meaning.trim()),
    way_forward: o.way_forward.map((w) => ({
      label: w.label,
      due_date: isoDate(w.due_date),
      due_text: blank(w.due_text),
      items: w.items.map((i) => ({ text: i.text, refs: strings(i.refs) })),
    })),
    decisions_requested: strings(o.decisions_requested),
    variance,
    prior_updates: o.prior_updates.map((u) => ({
      ref: u.ref,
      title: u.title,
      previous_report: blank(u.previous_report),
      status: u.status,
      status_text: blank(u.status_text),
      remarks: blank(u.remarks),
    })),
    warnings,
  };
}

async function saveExtraction(
  reportId: number,
  o: OverviewOutput,
  index: IndexOutput[],
  details: Map<string, DetailOutput>,
  warnings: string[],
  usage: Usage
): Promise<void> {
  const sql = getSql();
  const observations = index.map((item, i) => {
    const d = details.get(item.ref);
    return {
      position: i + 1,
      ref: item.ref,
      title: item.title.trim(),
      area: item.area.trim() || "General",
      rating: item.rating,
      status: item.status,
      status_text: blank(item.status_text),
      owner: blank(item.owner),
      owners: strings(item.owners),
      target_date: isoDate(item.target_date),
      target_text: blank(item.target_text),
      summary: blank(d?.summary),
      background: blank(d?.background),
      exceptions: strings(d?.exceptions ?? []),
      root_causes: strings(d?.root_causes ?? []),
      recommendations: strings(d?.recommendations ?? []),
      management_response: blank(d?.management_response),
      impact_text: blank(d?.impact_text),
      impact_inr: d ? positive(d.impact_inr) : null,
      evidence: blank(item.evidence),
      source_page: (d && d.source_page > 0 ? d.source_page : null) ?? (item.source_page > 0 ? item.source_page : null),
      source_quote: blank(d?.source_quote),
    };
  });

  await sql.transaction([
    sql`DELETE FROM observations WHERE report_id = ${reportId}`,
    sql`
      INSERT INTO observations (
        report_id, position, ref, title, area, rating, status, status_text, owner, owners,
        target_date, target_text, summary, background, exceptions, root_causes, recommendations,
        management_response, impact_text, impact_inr, evidence, source_page, source_quote)
      SELECT ${reportId}, x.position, x.ref, x.title, x.area, x.rating, x.status, x.status_text, x.owner,
             COALESCE(x.owners, '[]'::jsonb), x.target_date, x.target_text, x.summary, x.background,
             COALESCE(x.exceptions, '[]'::jsonb), COALESCE(x.root_causes, '[]'::jsonb),
             COALESCE(x.recommendations, '[]'::jsonb), x.management_response, x.impact_text, x.impact_inr,
             x.evidence, x.source_page, x.source_quote
      FROM jsonb_to_recordset(${JSON.stringify(observations)}::jsonb) AS x(
        position int, ref text, title text, area text, rating text, status text, status_text text,
        owner text, owners jsonb, target_date date, target_text text, summary text, background text,
        exceptions jsonb, root_causes jsonb, recommendations jsonb, management_response text,
        impact_text text, impact_inr numeric, evidence text, source_page int, source_quote text)`,
    sql`
      UPDATE reports SET
        title = ${blank(o.title)}, company = ${blank(o.company)}, auditor = ${blank(o.auditor)},
        meeting = ${blank(o.meeting)}, report_label = ${blank(o.report_label)},
        period_label = ${blank(o.period_label)}, quarter = ${/^Q[1-4]$/.test(o.quarter.trim()) ? o.quarter.trim() : null},
        fiscal_year = ${blank(o.fiscal_year)}, period_start = ${isoDate(o.period_start)},
        period_end = ${isoDate(o.period_end)}, report_date = ${isoDate(o.report_date)},
        overview = ${JSON.stringify(toOverview(o, warnings))}::jsonb,
        model = ${MODEL}, usage = ${JSON.stringify(usage)}::jsonb, updated_at = now()
      WHERE id = ${reportId}`,
    // Replacing the observations cascades away every link and action-taken update that
    // touched them, in this report and in later ones. Mark this report and every report
    // from its (new) position onward for re-matching, so syncLineage rebuilds them.
    sql`
      UPDATE reports SET lineage_basis = NULL
      WHERE id = ${reportId}
         OR COALESCE(period_end, report_date, created_at::date) >= (
              SELECT COALESCE(period_end, report_date, created_at::date) FROM reports WHERE id = ${reportId})`,
  ]);
}
