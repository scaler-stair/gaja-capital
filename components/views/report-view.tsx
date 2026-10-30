import Link from "next/link";
import { ArrowUpRight, Download, ExternalLink, MessageSquareText } from "lucide-react";
import { daysUntil, formatDate, formatTimestamp, plural, reportRef, shortPeriod } from "@/lib/format";
import { buildThreads, historyByObservation, movement } from "@/lib/lineage";
import { areaBreakdown, deadlineGroups, overdueCount, ownerBreakdown, ratingCounts, statusCounts } from "@/lib/stats";
import type { Observation, ObservationLink, ObservationWithReport, ReportRow, StatusUpdate } from "@/lib/types";
import { PageHeader, Panel, RefTag, SeverityBar, Stat, button } from "@/components/ui";
import { SeverityBars, SeverityColumns, VarianceBars } from "@/components/charts";
import { ObservationRegister, type RegisterFilters } from "@/components/observations/register";
import { DeleteReportButton, RetryButton } from "@/components/reports/report-actions";

function metaLine(r: ReportRow): string {
  const parts = [
    r.meeting ? `Presented to the ${r.meeting}` : null,
    r.overview?.date_text ?? (r.report_date ? formatDate(r.report_date) : null),
    r.auditor ? `by ${r.auditor}` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

/** One processed board report: headline, figures, charts, the observation register and next steps. */
export function ReportView({
  report,
  observations,
  everything,
  links,
  updates,
  reports,
  isAdmin,
  initial,
  today,
}: {
  report: ReportRow;
  observations: Observation[];
  /** Every observation from every processed report, for cross-meeting history. */
  everything: ObservationWithReport[];
  links: ObservationLink[];
  updates: StatusUpdate[];
  /** Processed reports in chronological order. */
  reports: ReportRow[];
  isAdmin: boolean;
  initial: RegisterFilters;
  today: string;
}) {
  const period = shortPeriod(report);
  const title = report.title ?? report.file_name;
  const overview = report.overview;
  const rows: ObservationWithReport[] = observations.map((o) => ({ ...o, period, report_title: title }));

  const refs = reports.map(reportRef);
  const threads = buildThreads(refs, everything, links, updates);
  const periodOf = new Map(refs.map((r) => [r.id, r.period]));
  const history = historyByObservation(threads, (rid) => periodOf.get(rid) ?? "");
  const position = refs.findIndex((r) => r.id === report.id);
  const previous = position > 0 ? refs[position - 1] : null;
  const moved = previous ? movement(threads, position - 1, position) : null;

  const counts = ratingCounts(observations);
  const statuses = statusCounts(observations);
  const deadlines = deadlineGroups(observations, today);
  const nextDue = deadlines.find((d) => d.date >= today);
  const overdue = overdueCount(observations, today);
  const base = `/reports/${report.id}`;
  const linkTo = (param: string) => ({ base, param, hash: "#register" });


  return (
    <div className="space-y-8">
      <div>
        <nav className="no-print mb-4 text-sm text-muted" aria-label="Breadcrumb">
          <Link href="/reports" className="hover:text-ink">
            Board reports
          </Link>
          <span className="mx-2" aria-hidden>
            /
          </span>
          <span className="text-ink-2">{period}</span>
        </nav>
        <PageHeader
          title={title}
          lead={
            <>
              <span className="font-medium text-ink">{report.period_label ?? period}</span>
              {report.report_label ? `, ${report.report_label}` : ""}. {metaLine(report)}.
            </>
          }
          actions={
            <>
              <Link href={`/assistant?report=${report.id}`} className={button.primary}>
                <MessageSquareText className="h-4 w-4" aria-hidden />
                Ask about this report
              </Link>
              <a href={`/api/reports/${report.id}/pdf`} target="_blank" rel="noreferrer" className={button.secondary}>
                Open PDF <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              <a href={`/api/observations/export?report=${report.id}`} className={button.secondary}>
                <Download className="h-4 w-4" aria-hidden /> Excel
              </a>
            </>
          }
        />
      </div>

      {isAdmin && overview && overview.warnings.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-medium/40 bg-medium/[0.08] px-4 py-3 text-sm text-medium-ink">
          <span>{overview.warnings.join(" ")}</span>
          <RetryButton reportId={report.id} />
        </div>
      )}

      <section className="relative overflow-hidden rounded-xl border border-rule bg-surface p-6 sm:p-8">
        <span className="absolute inset-y-0 left-0 w-1 bg-gaja" aria-hidden />
        {overview?.headline && (
          <p className="max-w-4xl font-serif text-[1.35rem] leading-snug text-ink sm:text-[1.6rem]">{overview.headline}</p>
        )}
        <div className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[2.6rem] font-semibold leading-none text-ink">{observations.length}</span>
              <span className="text-sm text-ink-2">observations</span>
            </div>
            <div className="mt-3 max-w-sm">
              <SeverityBar counts={counts} />
            </div>
          </div>
          <Stat label="Rated High" value={counts.High} tone={counts.High > 0 ? "high" : undefined} />
          <Stat
            label={statuses.awaiting > 0 ? "Awaiting management response" : "Closed"}
            value={statuses.awaiting > 0 ? statuses.awaiting : statuses.closed}
            note={statuses.awaiting > 0 && statuses.closed > 0 ? `${statuses.closed} closed` : undefined}
            tone={statuses.awaiting > 0 ? undefined : "closed"}
          />
          {overdue > 0 ? (
            <Stat label="Overdue actions" value={overdue} tone="overdue" note={nextDue ? `Next due ${formatDate(nextDue.date)}` : undefined} />
          ) : nextDue ? (
            <Stat
              label={`Due ${formatDate(nextDue.date)}`}
              value={nextDue.total}
              note={`${plural(daysUntil(nextDue.date, today), "day")} from today`}
            />
          ) : (
            <Stat label="Open actions with a date" value={0} />
          )}
        </div>
      </section>

      {previous && moved && (
        <Panel
          title={`Since the ${previous.period} report`}
          action={
            <Link href={`/compile?reports=${previous.id},${report.id}`} className={button.quiet}>
              Compare in detail <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Newly raised" value={moved.raised.length} />
            <Stat label="Raised again" value={moved.repeated.length} note={moved.escalated.length ? `${moved.escalated.length} rated higher` : undefined} />
            <Stat label="Reported closed" value={moved.closed.length} tone={moved.closed.length ? "closed" : undefined} />
            <Stat label="Open with no update" value={moved.silent.length} />
          </div>
        </Panel>
      )}

      {overview && (overview.executive_summary.length > 0 || overview.key_metrics.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          {overview.executive_summary.length > 0 && (
            <Panel title="Executive summary" description={overview.scope_note ?? undefined}>
              <ul className="space-y-4">
                {overview.executive_summary.map((p, i) => (
                  <li key={i} className="border-t border-rule pt-4 first:border-0 first:pt-0">
                    <p className="font-medium text-ink">{p.heading}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">{p.detail}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {overview.key_metrics.length > 0 && (
            <Panel title="Key figures" description="As highlighted by the auditor">
              <ul>
                {overview.key_metrics.map((m, i) => (
                  <li key={i} className="border-t border-rule py-3.5 first:border-0 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-[1.6rem] font-semibold leading-none text-ink">{m.value}</span>
                      {m.ref && <RefTag value={m.ref} />}
                    </div>
                    <p className="mt-1.5 text-sm leading-snug text-ink-2">{m.label}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Findings by area" description="Click a bar to list its observations">
          <SeverityBars rows={areaBreakdown(observations)} link={linkTo("area")} />
        </Panel>
        <Panel title="Who owns the actions" description="Shared actions count for each owner">
          <SeverityBars rows={ownerBreakdown(observations, { openOnly: false }).slice(0, 10)} link={linkTo("owner")} labelWidth={150} />
        </Panel>
      </div>

      {deadlines.length > 0 && (
        <Panel title="What falls due" description={`Target dates for actions not yet closed. Today is ${formatDate(today)}.`}>
          <SeverityColumns
            rows={deadlines.map((d) => ({ name: formatDate(d.date), key: d.date, High: d.High, Medium: d.Medium, Low: d.Low, total: d.total }))}
            link={linkTo("due")}
          />
        </Panel>
      )}

      <section id="register" className="scroll-mt-6 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-serif text-[1.5rem] font-medium text-ink">Observations</h2>
          <p className="text-sm text-muted">Open any observation for the full finding and its source page.</p>
        </div>
        <ObservationRegister
          rows={rows}
          history={history}
          initial={initial}
          today={today}
          exportHref={`/api/observations/export?report=${report.id}`}
        />
      </section>

      {overview && (overview.way_forward.length > 0 || overview.decisions_requested.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {overview.way_forward.length > 0 && (
            <Panel title="Way forward" description="Agreed next steps, as set out in the report">
              <ol className="relative space-y-6 border-l border-rule-strong pl-6">
                {overview.way_forward.map((step, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[1.85rem] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-navy text-[0.65rem] font-semibold text-white">
                      {i + 1}
                    </span>
                    <p className="font-medium text-ink">
                      {step.label}
                      {(step.due_date || step.due_text) && (
                        <span className="ml-2 text-sm font-normal text-muted">{step.due_date ? `by ${formatDate(step.due_date)}` : step.due_text}</span>
                      )}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {step.items.map((item, j) => (
                        <li key={j} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-ink-2">
                          <span>{item.text}</span>
                          {item.refs.map((ref) => (
                            <RefTag key={ref} value={ref} />
                          ))}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
          {overview.decisions_requested.length > 0 && (
            <Panel title={`Asked of the ${report.meeting ?? "Committee"}`}>
              <ul className="space-y-3">
                {overview.decisions_requested.map((d, i) => (
                  <li key={i} className="border-l-2 border-gaja pl-3 text-sm leading-relaxed text-ink">
                    {d}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {overview?.variance && overview.variance.items.length > 0 && (
        <Panel
          title={overview.variance.title || "Period-on-period movement"}
          description={`${overview.variance.current_label} against ${overview.variance.previous_label}, ${overview.variance.unit}. Orange is an increase, blue a decrease.`}
        >
          <VarianceBars
            items={overview.variance.items}
            unit={overview.variance.unit}
            previousLabel={overview.variance.previous_label}
            currentLabel={overview.variance.current_label}
          />
        </Panel>
      )}

      {overview && (overview.areas.length > 0 || overview.rating_scale.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {overview.areas.length > 0 && (
            <Panel title="Audit scope">
              <ul className="divide-y divide-rule">
                {overview.areas.map((a) => (
                  <li key={a.name} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{a.name}</span>
                      <span className="tabular text-xs text-muted">
                        High {a.high}, Medium {a.medium}, Low {a.low}
                      </span>
                    </div>
                    {a.scope.length > 0 && <p className="mt-1 text-sm leading-relaxed text-ink-2">{a.scope.join("; ")}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {overview.rating_scale.length > 0 && (
            <Panel title="How the auditor rates findings">
              <dl className="space-y-3">
                {overview.rating_scale.map((s) => (
                  <div key={s.rating}>
                    <dt className="text-sm font-semibold text-ink">{s.rating}</dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ink-2">{s.meaning}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5 text-xs text-muted">
        <span>
          {report.file_name}
          {report.page_count ? `, ${report.page_count} pages` : ""}. Read by AI on {formatTimestamp(report.processed_at)}
          {report.uploaded_by_name ? `, uploaded by ${report.uploaded_by_name}` : ""}. Check figures against the PDF before relying on them.
        </span>
        {isAdmin && (
          <span className="no-print flex gap-1">
            <DeleteReportButton reportId={report.id} name={`the ${period} report`} after="list" />
          </span>
        )}
      </footer>
    </div>
  );
}
