import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { daysUntil, formatDate, isOverdue, plural, ratingRank, reportRef, shortPeriod } from "@/lib/format";
import { buildThreads } from "@/lib/lineage";
import { areaBreakdown, deadlineGroups, ratingCounts } from "@/lib/stats";
import type { ObservationLink, ObservationWithReport, ReportRow, StatusUpdate } from "@/lib/types";
import { PageHeader, Panel, RatingBadge, RefTag, SeverityBar, Stat, StatusBadge, button } from "@/components/ui";
import { SeverityBars, SeverityColumns } from "@/components/charts";

/** The board's landing view: the latest report, open issues counted once, deadlines and trends. */
export function OverviewView({
  ready,
  everything,
  links,
  updates,
  today,
}: {
  /** Processed reports in chronological order (at least one). */
  ready: ReportRow[];
  everything: ObservationWithReport[];
  links: ObservationLink[];
  updates: StatusUpdate[];
  today: string;
}) {
  const refs = ready.map(reportRef);
  const threads = buildThreads(refs, everything, links, updates);
  const latest = ready[ready.length - 1];
  const latestObs = everything.filter((o) => o.report_id === latest.id);
  const latestCounts = ratingCounts(latestObs);

  // Each issue once, as it stands now: repeats across meetings are not double counted.
  const open = threads.filter((t) => t.status !== "closed").map((t) => ({ ...t.latest, status: t.status }));
  const openCounts = ratingCounts(open);
  const overdue = open.filter((o) => isOverdue(o, today));
  const dueSoon = open.filter((o) => o.target_date && daysUntil(o.target_date, today) >= 0 && daysUntil(o.target_date, today) <= 45);
  const closed = threads.length - open.length;
  const deadlines = deadlineGroups(open, today);
  const serious = [...open]
    .sort(
      (a, b) =>
        ratingRank(b.rating) - ratingRank(a.rating) ||
        Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
        (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999")
    )
    .slice(0, 6);
  const perReport = refs.map((ref) => {
    const c = ratingCounts(everything.filter((o) => o.report_id === ref.id));
    return { name: ref.period, key: String(ref.id), ...c, total: c.High + c.Medium + c.Low };
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Board overview"
        lead={`The internal audit position across ${plural(ready.length, "board report")}, as of ${formatDate(today)}.`}
      />

      <Link
        href={`/reports/${latest.id}`}
        className="group relative block overflow-hidden rounded-xl bg-navy p-6 text-white sm:p-8"
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-gaja" aria-hidden />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-end">
          <div className="min-w-0">
            <p className="text-sm text-white/60">
              Latest: {shortPeriod(latest)}
              {latest.meeting ? `, ${latest.meeting}` : ""}
              {latest.overview?.date_text ? `, ${latest.overview.date_text}` : ""}
            </p>
            <h2 className="mt-2 font-serif text-[1.6rem] font-medium leading-snug sm:text-[1.9rem]">
              {latest.title ?? latest.file_name}
            </h2>
            {latest.overview?.headline && <p className="mt-3 max-w-2xl leading-relaxed text-white/75">{latest.overview.headline}</p>}
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-white/90 group-hover:text-white">
              Open the report <ArrowUpRight className="h-4 w-4" aria-hidden />
            </span>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[3rem] font-semibold leading-none">{latestObs.length}</span>
              <span className="text-sm text-white/70">observations in this report</span>
            </div>
            <div className="mt-4">
              <SeverityBar counts={latestCounts} tone="dark" height={12} />
            </div>
          </div>
        </div>
      </Link>

      <section className="grid grid-cols-2 gap-x-6 gap-y-8 rounded-xl border border-rule bg-surface p-6 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Open issues" value={open.length} note={ready.length > 1 ? "Repeats counted once" : undefined} />
        <Stat label="Open and rated High" value={openCounts.High} tone={openCounts.High > 0 ? "high" : undefined} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length > 0 ? "overdue" : undefined} note={overdue.length === 0 ? "None past their target date" : undefined} />
        <Stat label="Due in the next 45 days" value={dueSoon.length} />
        <Stat label="Closed to date" value={closed} tone={closed > 0 ? "closed" : undefined} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel
          title="Most serious open issues"
          action={
            <Link href="/observations" className={button.quiet}>
              All observations <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        >
          <ul className="divide-y divide-rule">
            {serious.map((o) => (
              <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <RefTag value={o.ref} />
                  <span>{o.period}</span>
                  <RatingBadge rating={o.rating} />
                </div>
                <Link href={`/observations?open=${o.id}`} className="mt-1.5 block font-medium leading-snug text-ink hover:underline">
                  {o.title}
                </Link>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
                  {o.owner && <span>{o.owner}</span>}
                  {o.target_date && <span>Target {formatDate(o.target_date)}</span>}
                  <StatusBadge status={o.status} overdue={isOverdue(o, today)} />
                </div>
              </li>
            ))}
            {serious.length === 0 && <li className="text-sm text-ink-2">Every observation is closed.</li>}
          </ul>
        </Panel>
        <div className="space-y-6">
          <Panel title="What falls due" description="Open issues by target date. Click a bar to list them.">
            {deadlines.length > 0 ? (
              <SeverityColumns
                rows={deadlines.map((d) => ({ name: formatDate(d.date), key: d.date, High: d.High, Medium: d.Medium, Low: d.Low, total: d.total }))}
                link={{ base: "/observations", param: "due" }}
                height={250}
              />
            ) : (
              <p className="text-sm text-ink-2">No open issue has a target date.</p>
            )}
          </Panel>
          <Panel title="Open issues by area" description="Click a bar to list them">
            <SeverityBars rows={areaBreakdown(open)} link={{ base: "/observations", param: "area" }} labelWidth={150} />
          </Panel>
        </div>
      </div>

      {refs.length > 1 && (
        <Panel
          title="Observations raised at each meeting"
          action={
            <Link href="/compile" className={button.quiet}>
              Compare meetings <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        >
          <SeverityColumns rows={perReport} link={{ base: "/observations", param: "report" }} />
        </Panel>
      )}

      <Panel
        title="Board reports on file"
        action={
          <Link href="/reports" className={button.quiet}>
            All reports <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-muted">
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Report</th>
                <th className="py-2 pr-4 font-medium">Observations</th>
                <th className="w-56 py-2 font-medium">Rating split</th>
              </tr>
            </thead>
            <tbody>
              {[...ready].reverse().map((r) => (
                <tr key={r.id} className="border-b border-rule last:border-0">
                  <td className="whitespace-nowrap py-3 pr-4 font-medium text-ink">{shortPeriod(r)}</td>
                  <td className="py-3 pr-4">
                    <Link href={`/reports/${r.id}`} className="text-ink hover:underline">
                      {r.title ?? r.file_name}
                    </Link>
                    {r.meeting && <div className="text-xs text-muted">{r.meeting}</div>}
                  </td>
                  <td className="tabular py-3 pr-4 text-ink">{r.observation_count}</td>
                  <td className="py-3">
                    <SeverityBar counts={{ High: r.high, Medium: r.medium, Low: r.low }} height={8} legend={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
