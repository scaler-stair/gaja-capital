import "server-only";
import { getSql } from "./db";
import { OBSERVATION_COLUMNS, REPORT_ORDER } from "./data";
import { shortPeriod } from "./format";
import { buildThreads } from "./lineage";
import { matchAgainstEarlier, type EarlierIssue } from "./ai/match";
import { emptyUsage, refKey } from "./ai/extract";
import type {
  Observation,
  ObservationLink,
  ObservationWithReport,
  ReportOverview,
  ReportRef,
  StatusUpdate,
} from "./types";

type SyncReport = ReportRef & { lineage_basis: string | null; overview: ReportOverview | null };

/**
 * Keeps cross-report links current. Each report remembers which earlier reports it
 * was matched against (lineage_basis). When that set changes, because a report was
 * added or deleted before it, the report is matched again. Reports are walked in
 * chronological order, so every match sees the final history of the reports before it.
 *
 * `includeReportId` is the report being processed, which is not marked ready yet.
 */
export async function syncLineage(includeReportId?: number): Promise<void> {
  const sql = getSql();
  const rows = (await sql.query(
    `SELECT r.id, r.lineage_basis, r.quarter, r.fiscal_year, r.period_label,
            r.report_date::text AS report_date, r.period_end::text AS period_end, r.file_name,
            COALESCE(r.title, r.file_name) AS title, r.overview
     FROM reports r
     WHERE r.status = 'ready' OR r.id = $1
     ORDER BY ${REPORT_ORDER}`,
    [includeReportId ?? -1]
  )) as Array<Record<string, unknown>>;

  const reports: SyncReport[] = rows.map((r) => ({
    id: r.id as number,
    period: shortPeriod({
      quarter: r.quarter as string | null,
      fiscal_year: r.fiscal_year as string | null,
      period_label: r.period_label as string | null,
      report_date: r.report_date as string | null,
      file_name: r.file_name as string,
    }),
    title: r.title as string,
    date: (r.report_date ?? r.period_end) as string | null,
    lineage_basis: r.lineage_basis as string | null,
    overview: r.overview as ReportOverview | null,
  }));

  for (let k = 0; k < reports.length; k++) {
    const basis = reports
      .slice(0, k)
      .map((r) => r.id)
      .join(",");
    if (reports[k].lineage_basis === basis) continue;
    await rematch(reports.slice(0, k), reports[k]);
    await sql`UPDATE reports SET lineage_basis = ${basis} WHERE id = ${reports[k].id}`;
  }
}

async function rematch(earlierReports: SyncReport[], report: SyncReport): Promise<void> {
  const sql = getSql();
  const laterObs = (await sql.query(
    `SELECT ${OBSERVATION_COLUMNS} FROM observations o WHERE o.report_id = $1 ORDER BY o.position`,
    [report.id]
  )) as unknown as Observation[];

  const clear = [
    sql`DELETE FROM observation_links WHERE later_id IN (SELECT id FROM observations WHERE report_id = ${report.id})`,
    sql`DELETE FROM status_updates WHERE report_id = ${report.id}`,
  ];
  if (earlierReports.length === 0) {
    await sql.transaction(clear);
    return;
  }

  const earlierIds = earlierReports.map((r) => r.id);
  const periodOf = new Map(earlierReports.map((r) => [r.id, r.period]));
  const [obsRows, linkRows, updateRows] = await Promise.all([
    sql.query(`SELECT ${OBSERVATION_COLUMNS} FROM observations o WHERE o.report_id = ANY($1::int[])`, [earlierIds]),
    sql.query(
      `SELECT l.earlier_id, l.later_id, l.note FROM observation_links l
       JOIN observations o ON o.id = l.later_id WHERE o.report_id = ANY($1::int[])`,
      [earlierIds]
    ),
    sql.query(
      `SELECT report_id, observation_id, status, status_text, remarks FROM status_updates WHERE report_id = ANY($1::int[])`,
      [earlierIds]
    ),
  ]);
  const earlierObs: ObservationWithReport[] = (obsRows as unknown as Observation[]).map((o) => ({
    ...o,
    period: periodOf.get(o.report_id) ?? "",
    report_title: "",
  }));
  const threads = buildThreads(
    earlierReports,
    earlierObs,
    linkRows as unknown as ObservationLink[],
    updateRows as unknown as StatusUpdate[]
  );

  // Each earlier issue is offered once, under its most recent appearance.
  const byKey = new Map<string, number>();
  const earlier: EarlierIssue[] = threads.map((t) => {
    const key = `R${t.latest.report_id}:${t.latest.ref}`;
    byKey.set(key, t.latest.id);
    return {
      key,
      period: t.latest.period,
      ref: t.latest.ref,
      title: t.latest.title,
      area: t.latest.area,
      rating: t.rating,
      status: t.status,
      summary: t.latest.summary,
      history: t.events
        .filter((e) => e.kind === "observation" && e.observation.id !== t.latest.id)
        .map((e) => (e.kind === "observation" ? `${e.observation.ref} in ${e.observation.period}` : "")),
    };
  });

  const usage = emptyUsage();
  const { result, method } = await matchAgainstEarlier(
    {
      earlier,
      later: {
        period: report.period,
        observations: laterObs.map((o) => ({
          ref: o.ref,
          title: o.title,
          area: o.area,
          rating: o.rating,
          summary: o.summary,
        })),
        priorUpdates: report.overview?.prior_updates ?? [],
      },
    },
    usage
  );

  const laterIdByRef = new Map(laterObs.map((o) => [refKey(o.ref), o.id]));
  const links = result.repeats
    .map((r) => ({
      earlier_id: byKey.get(r.earlier_key),
      later_id: laterIdByRef.get(refKey(r.later_ref)),
      note: r.note || null,
    }))
    .filter((l) => l.earlier_id !== undefined && l.later_id !== undefined);
  const updates = result.updates
    .map((u) => ({
      observation_id: byKey.get(u.earlier_key),
      status: u.status,
      status_text: u.status_text || null,
      remarks: u.remarks || null,
    }))
    .filter((u) => u.observation_id !== undefined);

  await sql.transaction([
    ...clear,
    sql`
      INSERT INTO observation_links (earlier_id, later_id, note)
      SELECT x.earlier_id, x.later_id, x.note
      FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS x(earlier_id int, later_id int, note text)
      ON CONFLICT DO NOTHING`,
    sql`
      INSERT INTO status_updates (report_id, observation_id, status, status_text, remarks)
      SELECT ${report.id}, x.observation_id, x.status, x.status_text, x.remarks
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
        AS x(observation_id int, status text, status_text text, remarks text)
      ON CONFLICT (report_id, observation_id) DO NOTHING`,
  ]);
  console.log(
    `Lineage for report ${report.id} (${method}): ${links.length} repeats, ${updates.length} status updates, ${usage.calls} AI calls.`
  );
}
