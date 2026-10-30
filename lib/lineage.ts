// Follows each audit issue across board reports.
//
// A "thread" is one issue over time: the observation where it was first raised,
// any later observations that repeat it (observation_links), and any action-taken
// updates later reports give on it (status_updates). Pure functions, so the
// compile page, the overview and the AI context all read the same history.
import { ratingRank } from "./format";
import type {
  ObsStatus,
  ObservationLink,
  ObservationWithReport,
  Rating,
  ReportRef,
  StatusUpdate,
} from "./types";

export type ThreadEvent =
  | { kind: "observation"; reportId: number; order: number; observation: ObservationWithReport }
  | { kind: "update"; reportId: number; order: number; update: StatusUpdate };

export type Thread = {
  key: string;
  first: ObservationWithReport;
  latest: ObservationWithReport;
  events: ThreadEvent[];
  /** Reports in which the issue was raised as an observation. */
  appearances: number;
  rating: Rating;
  peakRating: Rating;
  escalated: boolean;
  status: ObsStatus;
  /** The report the current status comes from. */
  statusReportId: number;
};

export type ThreadState = { status: ObsStatus; rating: Rating; kind: ThreadEvent["kind"]; reportId: number };

export function buildThreads(
  reports: ReportRef[],
  observations: ObservationWithReport[],
  links: ObservationLink[],
  updates: StatusUpdate[]
): Thread[] {
  const order = new Map(reports.map((r, i) => [r.id, i]));
  const known = observations.filter((o) => order.has(o.report_id));
  const byId = new Map(known.map((o) => [o.id, o]));
  const parentOf = new Map<number, number>();
  for (const l of links) {
    const earlier = byId.get(l.earlier_id);
    const later = byId.get(l.later_id);
    if (earlier && later && order.get(earlier.report_id)! < order.get(later.report_id)!) {
      parentOf.set(l.later_id, l.earlier_id);
    }
  }

  const sorted = [...known].sort(
    (a, b) => order.get(a.report_id)! - order.get(b.report_id)! || a.position - b.position
  );
  const threadOf = new Map<number, ThreadEvent[]>();
  const threads: ThreadEvent[][] = [];
  for (const o of sorted) {
    const event: ThreadEvent = { kind: "observation", reportId: o.report_id, order: order.get(o.report_id)!, observation: o };
    const parentId = parentOf.get(o.id);
    const parentThread = parentId !== undefined ? threadOf.get(parentId) : undefined;
    const tail = parentThread?.filter((e) => e.kind === "observation").at(-1);
    // Keep threads linear: continue only from the issue's most recent appearance.
    if (parentThread && tail?.kind === "observation" && tail.observation.id === parentId) {
      parentThread.push(event);
      threadOf.set(o.id, parentThread);
    } else {
      const fresh = [event];
      threads.push(fresh);
      threadOf.set(o.id, fresh);
    }
  }

  for (const u of updates) {
    const thread = threadOf.get(u.observation_id);
    const at = order.get(u.report_id);
    const target = byId.get(u.observation_id);
    if (!thread || at === undefined || !target || at <= order.get(target.report_id)!) continue;
    thread.push({ kind: "update", reportId: u.report_id, order: at, update: u });
  }

  return threads.map((events) => {
    // Within one report an update comes before a repeat, so the repeat's own status wins.
    events.sort((a, b) => a.order - b.order || (a.kind === "update" ? -1 : 1) - (b.kind === "update" ? -1 : 1));
    const raised = events.filter((e): e is Extract<ThreadEvent, { kind: "observation" }> => e.kind === "observation");
    const first = raised[0].observation;
    const latest = raised[raised.length - 1].observation;
    const last = events[events.length - 1];
    let escalated = false;
    let peak: Rating = first.rating;
    for (let i = 1; i < raised.length; i++) {
      if (ratingRank(raised[i].observation.rating) > ratingRank(raised[i - 1].observation.rating)) escalated = true;
      if (ratingRank(raised[i].observation.rating) > ratingRank(peak)) peak = raised[i].observation.rating;
    }
    return {
      key: `T${first.id}`,
      first,
      latest,
      events,
      appearances: raised.length,
      rating: latest.rating,
      peakRating: peak,
      escalated,
      status: last.kind === "observation" ? last.observation.status : last.update.status,
      statusReportId: last.reportId,
    };
  });
}

/** The issue as it stood in a given report: the latest event at or before it, or null if not yet raised. */
export function stateAt(thread: Thread, reportOrder: number): ThreadState | null {
  let state = null as ThreadState | null;
  for (const e of thread.events) {
    if (e.order > reportOrder) break;
    state =
      e.kind === "observation"
        ? { status: e.observation.status, rating: e.observation.rating, kind: "observation", reportId: e.reportId }
        : { status: e.update.status, rating: state?.rating ?? thread.rating, kind: "update", reportId: e.reportId };
  }
  return state;
}

/** Each observation's issue history, oldest first, for the detail drawer. Single-appearance issues are left out. */
export function historyByObservation(
  threads: Thread[],
  periodOf: (reportId: number) => string
): Record<number, Array<{ period: string; text: string; current: boolean }>> {
  const labels: Record<ObsStatus, string> = {
    awaiting: "response awaited",
    open: "open",
    in_progress: "in progress",
    closed: "closed",
  };
  const out: Record<number, Array<{ period: string; text: string; current: boolean }>> = {};
  for (const t of threads) {
    if (t.events.length < 2) continue;
    const items = t.events.map((e, i) => ({
      period: periodOf(e.reportId),
      current: i === t.events.length - 1,
      text:
        e.kind === "observation"
          ? `${i === 0 ? "raised" : "raised again"} as ${e.observation.ref}, rated ${e.observation.rating}, ${e.observation.status_text?.toLowerCase() ?? labels[e.observation.status]}`
          : `status reported as ${e.update.status_text?.toLowerCase() ?? labels[e.update.status]}${e.update.remarks ? ` (${e.update.remarks})` : ""}`,
    }));
    for (const e of t.events) if (e.kind === "observation") out[e.observation.id] = items;
  }
  return out;
}

export type Movement = {
  /** First raised in `to`. */
  raised: Thread[];
  /** Raised again in `to` after appearing in `from` or earlier. */
  repeated: Thread[];
  /** Repeats whose rating went up. */
  escalated: Thread[];
  /** Open as of `from`, reported closed by `to`. */
  closed: Thread[];
  /** Open as of `from`, with no repeat or update in any report after `from` up to `to`. */
  silent: Thread[];
};

/** What changed between two reports (by their position in the chronological order). */
export function movement(threads: Thread[], from: number, to: number): Movement {
  const result: Movement = { raised: [], repeated: [], escalated: [], closed: [], silent: [] };
  for (const t of threads) {
    const before = stateAt(t, from);
    const after = stateAt(t, to);
    const raisedInTo = t.events.some((e) => e.kind === "observation" && e.order === to);
    const firstOrder = t.events[0].order;
    if (raisedInTo && firstOrder === to) {
      result.raised.push(t);
      continue;
    }
    if (!before) continue;
    if (raisedInTo) {
      result.repeated.push(t);
      if (after && ratingRank(after.rating) > ratingRank(before.rating)) result.escalated.push(t);
    }
    if (before.status !== "closed" && after?.status === "closed") result.closed.push(t);
    const touched = t.events.some((e) => e.order > from && e.order <= to);
    if (before.status !== "closed" && !touched) result.silent.push(t);
  }
  return result;
}
