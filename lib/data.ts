import "server-only";
import { getSql } from "./db";
import { reportRef, shortPeriod } from "./format";
import type {
  Observation,
  ObservationLink,
  ObservationWithReport,
  ReportRef,
  ReportRow,
  StatusUpdate,
} from "./types";

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/** Chronological order of board reports: the period they cover, else the meeting date, else upload date. */
export const REPORT_ORDER = `COALESCE(r.period_end, r.report_date, r.created_at::date), r.id`;

/**
 * Processing runs inside one serverless invocation. If that invocation is killed,
 * the row would sit at "processing" forever, so stale rows are reported as failed.
 */
const REPORT_SELECT = `
  SELECT r.id, r.file_name, r.file_size, r.page_count,
         CASE
           WHEN r.status IN ('queued', 'processing') AND r.updated_at < now() - interval '15 minutes' THEN 'failed'
           WHEN r.status = 'uploading' AND r.updated_at < now() - interval '60 minutes' THEN 'failed'
           ELSE r.status
         END AS status,
         r.stage, r.stage_label,
         CASE
           WHEN r.status IN ('queued', 'processing') AND r.updated_at < now() - interval '15 minutes'
             THEN 'Processing stopped before it finished. Retry to process the report again.'
           WHEN r.status = 'uploading' AND r.updated_at < now() - interval '60 minutes'
             THEN 'The upload did not finish. Delete this entry and upload the PDF again.'
           ELSE r.error
         END AS error,
         r.title, r.company, r.auditor, r.meeting, r.report_label, r.period_label, r.quarter, r.fiscal_year,
         r.period_start::text AS period_start, r.period_end::text AS period_end, r.report_date::text AS report_date,
         r.overview,
         to_char(r.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at,
         to_char(r.processed_at AT TIME ZONE 'UTC', ${ISO}) AS processed_at,
         u.name AS uploaded_by_name,
         COUNT(o.id)::int AS observation_count,
         (COUNT(o.id) FILTER (WHERE o.rating = 'High'))::int AS high,
         (COUNT(o.id) FILTER (WHERE o.rating = 'Medium'))::int AS medium,
         (COUNT(o.id) FILTER (WHERE o.rating = 'Low'))::int AS low
  FROM reports r
  LEFT JOIN users u ON u.id = r.uploaded_by
  LEFT JOIN observations o ON o.report_id = r.id`;

export const OBSERVATION_COLUMNS = `
  o.id, o.report_id, o.position, o.ref, o.title, o.area, o.rating, o.status, o.status_text,
  o.owner, o.owners, o.target_date::text AS target_date, o.target_text, o.summary, o.background,
  o.exceptions, o.root_causes, o.recommendations, o.management_response, o.impact_text,
  o.impact_inr::float8 AS impact_inr, o.evidence, o.source_page, o.source_quote`;

export async function listReports(): Promise<ReportRow[]> {
  const rows = await getSql().query(`${REPORT_SELECT} GROUP BY r.id, u.name ORDER BY ${REPORT_ORDER}`);
  return rows as unknown as ReportRow[];
}

export async function readyReports(): Promise<ReportRow[]> {
  return (await listReports()).filter((r) => r.status === "ready");
}

export async function getReport(id: number): Promise<ReportRow | null> {
  const rows = await getSql().query(`${REPORT_SELECT} WHERE r.id = $1 GROUP BY r.id, u.name`, [id]);
  return (rows[0] as unknown as ReportRow) ?? null;
}

export async function reportObservations(reportId: number): Promise<Observation[]> {
  const rows = await getSql().query(
    `SELECT ${OBSERVATION_COLUMNS} FROM observations o WHERE o.report_id = $1 ORDER BY o.position`,
    [reportId]
  );
  return rows as unknown as Observation[];
}

/** Every observation from every processed report, oldest report first. */
export async function allObservations(): Promise<ObservationWithReport[]> {
  const rows = await getSql().query(
    `SELECT ${OBSERVATION_COLUMNS},
            r.quarter, r.fiscal_year, r.period_label, r.report_date::text AS report_date, r.file_name,
            COALESCE(r.title, r.file_name) AS report_title
     FROM observations o JOIN reports r ON r.id = o.report_id
     WHERE r.status = 'ready'
     ORDER BY ${REPORT_ORDER}, o.position`
  );
  return (rows as Array<Record<string, unknown>>).map((row) => {
    const { quarter, fiscal_year, period_label, report_date, file_name, ...rest } = row;
    return {
      ...(rest as unknown as ObservationWithReport),
      period: shortPeriod({
        quarter: quarter as string | null,
        fiscal_year: fiscal_year as string | null,
        period_label: period_label as string | null,
        report_date: report_date as string | null,
        file_name: file_name as string,
      }),
    };
  });
}

export async function lineageData(): Promise<{ links: ObservationLink[]; updates: StatusUpdate[] }> {
  const sql = getSql();
  const [links, updates] = await Promise.all([
    sql`
      SELECT l.earlier_id, l.later_id, l.note
      FROM observation_links l
      JOIN observations o ON o.id = l.later_id
      JOIN reports r ON r.id = o.report_id
      WHERE r.status = 'ready'`,
    sql`
      SELECT s.report_id, s.observation_id, s.status, s.status_text, s.remarks
      FROM status_updates s JOIN reports r ON r.id = s.report_id
      WHERE r.status = 'ready'`,
  ]);
  return {
    links: links as unknown as ObservationLink[],
    updates: updates as unknown as StatusUpdate[],
  };
}

export const toReportRef: (r: ReportRow) => ReportRef = reportRef;

export type UserRow = {
  id: number;
  email: string;
  name: string;
  designation: string | null;
  role: "super_admin" | "member";
  active: boolean;
  locked: boolean;
  last_login_at: string | null;
  created_at: string;
};

export async function listUsers(): Promise<UserRow[]> {
  const rows = await getSql().query(`
    SELECT id, email, name, designation, role, active,
           (locked_until IS NOT NULL AND locked_until > now()) AS locked,
           to_char(last_login_at AT TIME ZONE 'UTC', ${ISO}) AS last_login_at,
           to_char(created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at
    FROM users ORDER BY (role = 'super_admin') DESC, id`);
  return rows as unknown as UserRow[];
}

export type ActivityRow = { id: number; user_name: string | null; action: string; detail: string | null; created_at: string };

export async function recentActivity(limit = 40): Promise<ActivityRow[]> {
  const rows = await getSql().query(
    `SELECT a.id, u.name AS user_name, a.action, a.detail,
            to_char(a.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at
     FROM activity a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows as unknown as ActivityRow[];
}

export async function aiUsageSummary(): Promise<{ questions_30d: number; briefs_30d: number; output_tokens_30d: number }> {
  const rows = await getSql()`
    SELECT (COUNT(*) FILTER (WHERE kind = 'chat'))::int AS questions_30d,
           (COUNT(*) FILTER (WHERE kind = 'brief'))::int AS briefs_30d,
           COALESCE(SUM(output_tokens), 0)::int AS output_tokens_30d
    FROM ai_questions WHERE created_at > now() - interval '30 days'`;
  return rows[0] as { questions_30d: number; briefs_30d: number; output_tokens_30d: number };
}
