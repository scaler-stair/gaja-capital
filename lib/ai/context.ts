import "server-only";
import { allObservations, lineageData, readyReports, toReportRef } from "../data";
import { formatDate, formatInr, isOverdue, todayIso, daysUntil } from "../format";
import { buildThreads, movement, type Thread } from "../lineage";
import { searchTextFor } from "../pdf-match";
import { areaBreakdown, ownerBreakdown, ratingCounts, statusCounts } from "../stats";
import { STATUS_LABEL, type Citation, type ObservationWithReport, type ReportRef, type ReportRow } from "../types";

export type { Citation };

export type AiContext = { text: string; citations: Record<string, Citation>; reports: ReportRef[] };

export const citationKey = (o: { report_id: number; ref: string }) => `R${o.report_id}:${o.ref}`;

function line(label: string, value: string | null | undefined): string | null {
  return value && value.trim() ? `${label}: ${value.trim()}` : null;
}

function reportSection(r: ReportRow, ref: ReportRef, obs: ObservationWithReport[], threadOf: Map<number, Thread>, today: string): string {
  const o = r.overview;
  const out: Array<string | null> = [];
  out.push(`## Report R${r.id}: ${ref.period}: ${ref.title}`);
  out.push(
    [
      line("Meeting", r.meeting),
      line("Report", r.report_label),
      line("Period", [r.period_label, r.period_start && r.period_end ? `${formatDate(r.period_start)} to ${formatDate(r.period_end)}` : null].filter(Boolean).join(", ")),
      line("Date", o?.date_text ?? formatDate(r.report_date)),
      line("Auditor", r.auditor),
      line("Company", r.company),
    ]
      .filter(Boolean)
      .join(" | ")
  );
  if (o) {
    out.push(line("Headline", o.headline));
    out.push(line("Scope", o.scope_note));
    if (o.executive_summary.length > 0) {
      out.push("Executive summary:");
      for (const p of o.executive_summary) out.push(`- ${p.heading}: ${p.detail}`);
    }
    if (o.key_metrics.length > 0) {
      out.push(`Key figures: ${o.key_metrics.map((m) => `${m.label}: ${m.value}${m.ref ? ` (${m.ref})` : ""}`).join("; ")}`);
    }
    if (o.areas.length > 0) {
      out.push("Areas reviewed:");
      for (const a of o.areas) {
        out.push(`- ${a.name}: High ${a.high}, Medium ${a.medium}, Low ${a.low}${a.scope.length ? `. Scope: ${a.scope.join("; ")}` : ""}`);
      }
    }
    if (o.rating_scale.length > 0) out.push(`Rating scale: ${o.rating_scale.map((s) => `${s.rating}: ${s.meaning}`).join(" ")}`);
    if (o.way_forward.length > 0) {
      out.push("Way forward:");
      for (const w of o.way_forward) {
        const due = w.due_date ? formatDate(w.due_date) : w.due_text;
        out.push(`- ${w.label}${due ? ` (by ${due})` : ""}: ${w.items.map((i) => i.text + (i.refs.length ? ` [${i.refs.join(", ")}]` : "")).join("; ")}`);
      }
    }
    if (o.decisions_requested.length > 0) {
      out.push("Asks of the Board or Committee:");
      for (const d of o.decisions_requested) out.push(`- ${d}`);
    }
    if (o.variance) {
      out.push(
        `Variance analysis (${o.variance.title}, ${o.variance.unit}, ${o.variance.previous_label} vs ${o.variance.current_label}): ` +
          o.variance.items
            .map((v) => `${v.label}: ${v.previous ?? "-"} to ${v.current ?? "-"}${v.comment ? ` (${v.comment})` : ""}`)
            .join("; ")
      );
    }
    if (o.prior_updates.length > 0) {
      out.push(
        `Status given in this report for earlier observations: ${o.prior_updates
          .map((u) => `${u.ref} ${u.title}: ${u.status_text ?? STATUS_LABEL[u.status]}${u.remarks ? ` (${u.remarks})` : ""}`)
          .join("; ")}`
      );
    }
  }
  out.push(`Observations (${obs.length}):`);
  for (const ob of obs) {
    const overdue = isOverdue(ob, today) ? " (OVERDUE)" : "";
    out.push(
      `[[${citationKey(ob)}]] ${ob.rating} | ${ob.area} | ${ob.status_text ?? STATUS_LABEL[ob.status]}${overdue} | Owner: ${ob.owner ?? "not stated"} | Target: ${
        ob.target_date ? formatDate(ob.target_date) : ob.target_text ?? "not stated"
      }${ob.source_page ? ` | Page ${ob.source_page}` : ""}`
    );
    out.push(`  Title: ${ob.title}`);
    out.push(line("  Summary", ob.summary));
    out.push(line("  Background", ob.background));
    if (ob.exceptions.length) out.push(`  Exceptions: ${ob.exceptions.join(" / ")}`);
    if (ob.root_causes.length) out.push(`  Root cause: ${ob.root_causes.join(" / ")}`);
    if (ob.recommendations.length) out.push(`  Recommendation: ${ob.recommendations.join(" / ")}`);
    out.push(line("  Management response", ob.management_response));
    out.push(line("  Impact", ob.impact_text));
    out.push(line("  Evidence", ob.evidence));
    const thread = threadOf.get(ob.id);
    if (thread && thread.events.length > 1) {
      out.push(
        `  History: ${thread.events
          .map((e) =>
            e.kind === "observation"
              ? `${e.observation.period} raised as ${e.observation.ref} (${e.observation.rating}, ${STATUS_LABEL[e.observation.status]})`
              : `status update in R${e.reportId}: ${e.update.status_text ?? STATUS_LABEL[e.update.status]}${e.update.remarks ? ` (${e.update.remarks})` : ""}`
          )
          .join("; ")}. Current status: ${STATUS_LABEL[thread.status]}.`
      );
    }
  }
  return out.filter((x): x is string => !!x).join("\n");
}

function statsSection(obs: ObservationWithReport[], refs: ReportRef[], today: string): string {
  const out: string[] = ["## Precomputed statistics for the reports above"];
  const r = ratingCounts(obs);
  const s = statusCounts(obs);
  out.push(`Total observations: ${obs.length} (High ${r.High}, Medium ${r.Medium}, Low ${r.Low}).`);
  out.push(
    `By status: ${STATUS_LABEL.awaiting} ${s.awaiting}, ${STATUS_LABEL.open} ${s.open}, ${STATUS_LABEL.in_progress} ${s.in_progress}, ${STATUS_LABEL.closed} ${s.closed}.`
  );
  const overdue = obs.filter((o) => isOverdue(o, today));
  out.push(`Overdue as of today: ${overdue.length}${overdue.length ? ` (${overdue.map((o) => citationKey(o)).join(", ")})` : ""}.`);
  out.push(`By report: ${refs.map((ref) => {
    const inR = obs.filter((o) => o.report_id === ref.id);
    const c = ratingCounts(inR);
    return `${ref.period} (R${ref.id}): ${inR.length} (High ${c.High}, Medium ${c.Medium}, Low ${c.Low})`;
  }).join("; ")}.`);
  out.push(`By area: ${areaBreakdown(obs).map((a) => `${a.name}: ${a.total} (High ${a.High}, Medium ${a.Medium}, Low ${a.Low})`).join("; ")}.`);
  out.push(`Not-closed observations by owner (shared items count for each owner): ${ownerBreakdown(obs).map((o) => `${o.name}: ${o.total}`).join("; ")}.`);
  const soon = obs
    .filter((o) => o.status !== "closed" && o.target_date && daysUntil(o.target_date, today) >= 0 && daysUntil(o.target_date, today) <= 60)
    .sort((a, b) => (a.target_date! < b.target_date! ? -1 : 1));
  if (soon.length) {
    out.push(`Due in the next 60 days: ${soon.map((o) => `${citationKey(o)} by ${formatDate(o.target_date)}`).join("; ")}.`);
  }
  const impacts = obs.filter((o) => o.impact_inr).sort((a, b) => (b.impact_inr ?? 0) - (a.impact_inr ?? 0)).slice(0, 8);
  if (impacts.length) {
    out.push(`Largest stated rupee amounts: ${impacts.map((o) => `${citationKey(o)} ${o.impact_text ?? formatInr(o.impact_inr)}`).join("; ")}.`);
  }
  return out.join("\n");
}

function movementSection(threads: Thread[], refs: ReportRef[], order: Map<number, number>): string | null {
  if (refs.length < 2) return null;
  const out: string[] = ["## Movement between consecutive reports"];
  const keyOf = (t: Thread) => citationKey(t.latest);
  for (let i = 1; i < refs.length; i++) {
    const m = movement(threads, order.get(refs[i - 1].id)!, order.get(refs[i].id)!);
    const list = (ts: Thread[]) => (ts.length ? ` (${ts.map(keyOf).join(", ")})` : "");
    out.push(
      `${refs[i - 1].period} to ${refs[i].period}: newly raised ${m.raised.length}${list(m.raised)}; repeated ${m.repeated.length}${list(m.repeated)}; escalated ${m.escalated.length}${list(m.escalated)}; reported closed ${m.closed.length}${list(m.closed)}; open with no update ${m.silent.length}${list(m.silent)}.`
    );
  }
  return out.join("\n");
}

/**
 * Everything the assistant may use, as compact text: each report's summary and
 * findings with citation keys, the history of repeated issues, and the counts it
 * should quote rather than compute. `reportIds` narrows the scope; empty means all.
 */
export async function buildAiContext(reportIds: number[] = []): Promise<AiContext> {
  const [reports, observations, { links, updates }] = await Promise.all([
    readyReports(),
    allObservations(),
    lineageData(),
  ]);
  const today = todayIso();
  const allRefs = reports.map(toReportRef);
  const threads = buildThreads(allRefs, observations, links, updates);
  const threadOf = new Map<number, Thread>();
  for (const t of threads) for (const e of t.events) if (e.kind === "observation") threadOf.set(e.observation.id, t);

  const scoped = reportIds.length > 0 ? reports.filter((r) => reportIds.includes(r.id)) : reports;
  const scopedIds = new Set(scoped.map((r) => r.id));
  const scopedObs = observations.filter((o) => scopedIds.has(o.report_id));
  const scopedRefs = scoped.map(toReportRef);
  const order = new Map(allRefs.map((r, i) => [r.id, i]));

  const sections = [
    `Board reports in scope: ${scoped.length} of ${reports.length} on the dashboard, oldest first.`,
    ...scoped.map((r, i) =>
      reportSection(r, scopedRefs[i], scopedObs.filter((o) => o.report_id === r.id), threadOf, today)
    ),
    movementSection(threads, scopedRefs, order),
    statsSection(scopedObs, scopedRefs, today),
  ].filter((s): s is string => !!s);

  const citations: Record<string, Citation> = {};
  for (const o of scopedObs) {
    const key = citationKey(o);
    citations[key] = {
      key,
      observationId: o.id,
      reportId: o.report_id,
      ref: o.ref,
      title: o.title,
      rating: o.rating,
      period: o.period,
      reportTitle: o.report_title,
      page: o.source_page,
      quote: o.source_quote,
      searchText: searchTextFor(o),
    };
  }
  return { text: sections.join("\n\n"), citations, reports: scopedRefs };
}
