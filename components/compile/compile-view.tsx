"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Check, CircleStop, FileText, Printer, RotateCcw } from "lucide-react";
import { SeverityColumns } from "@/components/charts";
import { PillarLoader } from "@/components/brand";
import { Answer, readAnswerStream } from "@/components/assistant/answer";
import { SourceViewer, type SourceTarget } from "@/components/observations/source-viewer";
import { Panel, RatingBadge, RefTag, Stat, StatusBadge, button, RATING_FILL } from "@/components/ui";
import { isOverdue } from "@/lib/format";
import { buildThreads, movement, stateAt, type Thread } from "@/lib/lineage";
import { ratingCounts } from "@/lib/stats";
import type { Citation, ObservationLink, ObservationWithReport, ReportRef, StatusUpdate } from "@/lib/types";

type CompileReport = ReportRef & { meeting: string | null };

const STATUS_DOT: Record<string, string> = {
  awaiting: "var(--color-awaiting)",
  open: "var(--color-open)",
  in_progress: "var(--color-progress)",
  closed: "var(--color-closed)",
};

function Cell({ thread, order }: { thread: Thread; order: number }) {
  const event = thread.events.find((e) => e.order === order && e.kind === "observation") ?? thread.events.find((e) => e.order === order);
  const state = stateAt(thread, order);
  if (!state) return <td className="border-l border-rule px-2 py-2" />;
  if (!event) {
    // Raised earlier, not mentioned in this report: carried forward without an update.
    return (
      <td className="border-l border-rule px-2 py-2 text-center" title="Not mentioned in this report">
        <span className="mx-auto block h-px w-5 bg-rule-strong" aria-label="No update" />
      </td>
    );
  }
  const raised = event.kind === "observation";
  const label = raised ? `${event.observation.ref}, ${event.observation.rating}, ${state.status.replace("_", " ")}` : `Status update: ${state.status.replace("_", " ")}`;
  return (
    <td className="border-l border-rule px-2 py-2" title={label}>
      <span className="flex items-center justify-center gap-1.5">
        {raised && <span className="h-3 w-3 rounded-[2px]" style={{ background: RATING_FILL[event.observation.rating] }} aria-hidden />}
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={
            raised
              ? { background: STATUS_DOT[state.status] }
              : { border: `2px solid ${STATUS_DOT[state.status]}`, background: "var(--color-surface)" }
          }
          aria-hidden
        />
        <span className="sr-only">{label}</span>
      </span>
    </td>
  );
}

export function CompileView({
  reports,
  observations,
  links,
  updates,
  initialSelected,
  aiReady,
}: {
  reports: CompileReport[];
  observations: ObservationWithReport[];
  links: ObservationLink[];
  updates: StatusUpdate[];
  initialSelected: number[];
  aiReady: boolean;
}) {
  const [selected, setSelected] = useState<number[]>(initialSelected);
  const [brief, setBrief] = useState<{ text: string; citations: Record<string, Citation>; error?: string; notice?: string } | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [source, setSource] = useState<SourceTarget | null>(null);
  const abort = useRef<AbortController | null>(null);

  const order = useMemo(() => new Map(reports.map((r, i) => [r.id, i])), [reports]);
  const threads = useMemo(() => buildThreads(reports, observations, links, updates), [reports, observations, links, updates]);
  const chosen = useMemo(() => reports.filter((r) => selected.includes(r.id)), [reports, selected]);
  const chosenOrders = useMemo(() => chosen.map((r) => order.get(r.id)!), [chosen, order]);
  const last = chosenOrders[chosenOrders.length - 1];

  function toggle(id: number) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (next.length === 0) return;
    const sorted = reports.filter((r) => next.includes(r.id)).map((r) => r.id);
    setSelected(sorted);
    setBrief(null);
    window.history.replaceState(window.history.state, "", `/compile?reports=${sorted.join(",")}`);
  }

  const inScope = useMemo(
    () => threads.filter((t) => t.events.some((e) => chosenOrders.includes(e.order))),
    [threads, chosenOrders]
  );
  const raisedInScope = observations.filter((o) => selected.includes(o.report_id));
  const repeatedInScope = inScope.filter((t) => t.events.filter((e) => e.kind === "observation" && chosenOrders.includes(e.order)).length > 1);
  const nowStates = inScope.map((t) => ({ t, s: stateAt(t, last)! }));
  const closedNow = nowStates.filter((x) => x.s.status === "closed").length;
  const openHighNow = nowStates.filter((x) => x.s.status !== "closed" && x.s.rating === "High").length;

  const perReport = chosen.map((r) => {
    const c = ratingCounts(observations.filter((o) => o.report_id === r.id));
    return { name: r.period, key: String(r.id), ...c, total: c.High + c.Medium + c.Low };
  });

  const areas = [...new Set(raisedInScope.map((o) => o.area))];
  const areaMatrix = areas
    .map((area) => ({
      area,
      counts: chosen.map((r) => raisedInScope.filter((o) => o.report_id === r.id && o.area === area).length),
    }))
    .sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0));
  const areaMax = Math.max(1, ...areaMatrix.flatMap((a) => a.counts));

  const steps = chosen.slice(1).map((r, i) => ({ from: chosen[i], to: r, m: movement(threads, order.get(chosen[i].id)!, order.get(r.id)!) }));

  const matrix = [...inScope].sort((a, b) => {
    const sa = stateAt(a, last)!;
    const sb = stateAt(b, last)!;
    const closedA = sa.status === "closed" ? 1 : 0;
    const closedB = sb.status === "closed" ? 1 : 0;
    const rank = (r: string) => (r === "High" ? 3 : r === "Medium" ? 2 : 1);
    return closedA - closedB || rank(sb.rating) - rank(sa.rating) || a.first.id - b.first.id;
  });

  async function writeBrief() {
    setBriefBusy(true);
    setBrief({ text: "", citations: {} });
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportIds: selected }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setBrief({ text: "", citations: {}, error: data.error ?? "The brief could not be written." });
        return;
      }
      await readAnswerStream(res, {
        onMeta: (citations) => setBrief((b) => ({ text: b?.text ?? "", citations })),
        onText: (delta) => setBrief((b) => ({ ...(b ?? { citations: {} }), text: (b?.text ?? "") + delta })),
        onNotice: (notice) => setBrief((b) => ({ ...(b ?? { text: "", citations: {} }), notice })),
        onError: (error) => setBrief((b) => ({ ...(b ?? { text: "", citations: {} }), error })),
      });
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        setBrief((b) => ({ ...(b ?? { text: "", citations: {} }), error: "The connection dropped. Try again." }));
      }
    } finally {
      abort.current = null;
      setBriefBusy(false);
    }
  }

  function cite(c: Citation) {
    setSource({
      observationId: c.observationId,
      observationTitle: `${c.ref}: ${c.title}`,
      reportId: c.reportId,
      reportTitle: c.reportTitle,
      periodLabel: c.period,
      quote: c.quote,
      page: c.page,
      searchText: c.searchText,
    });
  }

  return (
    <div className="space-y-8">
      <section className="no-print">
        <p className="mb-2 text-sm text-ink-2">Reports to compile</p>
        <div className="flex flex-wrap gap-2">
          {reports.map((r) => {
            const on = selected.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  on ? "border-navy bg-navy text-white" : "border-rule-strong bg-surface text-ink-2 hover:border-navy/50"
                }`}
              >
                {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                <span className="font-medium">{r.period}</span>
                {r.meeting && <span className={on ? "text-white/70" : "text-muted"}>{r.meeting}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-x-6 gap-y-8 rounded-xl border border-rule bg-surface p-6 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Observations raised" value={raisedInScope.length} note={`Across ${chosen.length} report${chosen.length === 1 ? "" : "s"}`} />
        <Stat label="Distinct issues" value={inScope.length} note="Repeats counted once" />
        <Stat label="Raised at more than one meeting" value={repeatedInScope.length} />
        <Stat label="Closed by the latest report" value={closedNow} tone={closedNow > 0 ? "closed" : undefined} />
        <Stat label="Open and rated High" value={openHighNow} tone={openHighNow > 0 ? "high" : undefined} />
      </section>

      {chosen.length < 2 && (
        <p className="rounded-xl border border-dashed border-rule-strong bg-surface px-5 py-4 text-sm text-ink-2">
          {reports.length < 2
            ? "Only one report is on the dashboard so far. When the next board report is uploaded, this page shows what was newly raised, repeated, escalated or closed between meetings."
            : "Select two or more reports to see how findings moved between meetings."}
        </p>
      )}

      {chosen.length > 1 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Observations raised at each meeting" description="Click a column to list that report's findings">
            <SeverityColumns rows={perReport} link={{ base: "/observations", param: "report" }} />
          </Panel>
          <Panel title="Findings by area and meeting" description="Darker cells hold more findings">
            <div className="overflow-x-auto">
              <table className="tabular w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Area</th>
                    {chosen.map((r) => (
                      <th key={r.id} className="px-1 py-2 text-center font-medium">
                        {r.period}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {areaMatrix.map((row) => (
                    <tr key={row.area} className="border-t border-rule">
                      <td className="py-1.5 pr-3 text-ink-2">{row.area}</td>
                      {row.counts.map((n, i) => (
                        <td key={i} className="px-1 py-1.5">
                          <span
                            className={`grid h-8 place-items-center rounded text-sm font-semibold ${n / areaMax > 0.5 ? "text-white" : "text-ink"}`}
                            style={{ background: n === 0 ? "var(--color-surface-2)" : `rgba(23, 31, 45, ${0.12 + 0.78 * (n / areaMax)})` }}
                          >
                            {n || ""}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {steps.map(({ from, to, m }) => (
        <Panel key={`${from.id}-${to.id}`} title={`From ${from.period} to ${to.period}`}>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
            <Stat label="Newly raised" value={m.raised.length} />
            <Stat label="Raised again" value={m.repeated.length} />
            <Stat label="Rated higher" value={m.escalated.length} tone={m.escalated.length ? "high" : undefined} />
            <Stat label="Reported closed" value={m.closed.length} tone={m.closed.length ? "closed" : undefined} />
            <Stat label="Open, no update" value={m.silent.length} />
          </div>
          {(m.escalated.length > 0 || m.silent.length > 0) && (
            <div className="mt-5 grid gap-5 border-t border-rule pt-4 lg:grid-cols-2">
              {[
                { title: "Rated higher than before", list: m.escalated },
                { title: `Not mentioned in ${to.period} while still open`, list: m.silent },
              ]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <div key={g.title}>
                    <h3 className="text-xs font-semibold text-muted">{g.title}</h3>
                    <ul className="mt-2 space-y-1.5">
                      {g.list.slice(0, 8).map((t) => (
                        <li key={t.key} className="flex items-start gap-2 text-sm">
                          <RefTag value={t.latest.ref} />
                          <Link href={`/observations?open=${t.latest.id}`} className="text-ink hover:underline">
                            {t.latest.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </Panel>
      ))}

      {chosen.length > 1 && matrix.length > 0 && (
        <Panel
          title="Issue tracker across meetings"
          description="Each row is one issue. A square shows its rating when raised; a dot shows its status at that meeting (hollow when the status came from a follow-up note); a dash means it was not mentioned."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Issue</th>
                  {chosen.map((r) => (
                    <th key={r.id} className="border-l border-rule px-2 py-2 text-center font-medium">
                      {r.period}
                    </th>
                  ))}
                  <th className="border-l border-rule px-3 py-2 font-medium">Now</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((t) => {
                  const now = stateAt(t, last)!;
                  return (
                    <tr key={t.key} className="border-b border-rule last:border-0">
                      <td className="max-w-sm py-2 pr-3">
                        <div className="flex items-start gap-2">
                          <RefTag value={t.latest.ref} />
                          <Link href={`/observations?open=${t.latest.id}`} className="leading-snug text-ink hover:underline">
                            {t.latest.title}
                          </Link>
                        </div>
                      </td>
                      {chosenOrders.map((o) => (
                        <Cell key={o} thread={t} order={o} />
                      ))}
                      <td className="border-l border-rule px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <RatingBadge rating={now.rating} />
                          <StatusBadge status={now.status} overdue={isOverdue({ status: now.status, target_date: t.latest.target_date })} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title="Board brief"
        description={`A consolidated brief written by the AI from ${chosen.length === 1 ? `the ${chosen[0]?.period} report` : `${chosen.length} selected reports`}, for the next meeting.`}
        action={
          brief?.text && !briefBusy ? (
            <button type="button" onClick={() => window.print()} className={button.secondary}>
              <Printer className="h-4 w-4" aria-hidden /> Print
            </button>
          ) : undefined
        }
        className="print-plain"
      >
        {!aiReady ? (
          <p className="text-sm text-ink-2">The AI service is not switched on yet (ANTHROPIC_API_KEY is missing).</p>
        ) : !brief ? (
          <button type="button" onClick={writeBrief} className={button.primary}>
            <FileText className="h-4 w-4" aria-hidden />
            Write the board brief
          </button>
        ) : (
          <div>
            {brief.text ? (
              <Answer text={brief.text} citations={brief.citations} onCite={cite} streaming={briefBusy} />
            ) : (
              !brief.error && <PillarLoader label="Writing the brief..." />
            )}
            {brief.notice && <p className="mt-3 text-xs text-muted">{brief.notice}</p>}
            {brief.error && <p className="mt-2 text-sm text-high-ink">{brief.error}</p>}
            <div className="no-print mt-4 flex gap-2 border-t border-rule pt-3">
              {briefBusy ? (
                <button type="button" onClick={() => abort.current?.abort()} className={button.secondary}>
                  <CircleStop className="h-4 w-4" aria-hidden /> Stop
                </button>
              ) : (
                <button type="button" onClick={writeBrief} className={button.secondary}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Write again
                </button>
              )}
            </div>
          </div>
        )}
      </Panel>

      <SourceViewer target={source} onClose={() => setSource(null)} />
    </div>
  );
}
