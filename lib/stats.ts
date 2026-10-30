// Aggregations behind the dashboard charts. Pure functions over observation rows.
import { isOverdue, ratingRank, todayIso } from "./format";
import type { ObsStatus, Observation, Rating } from "./types";

export type RatingCounts = Record<Rating, number>;

export function ratingCounts(rows: Pick<Observation, "rating">[]): RatingCounts {
  const counts: RatingCounts = { High: 0, Medium: 0, Low: 0 };
  for (const o of rows) counts[o.rating]++;
  return counts;
}

export function statusCounts(rows: Pick<Observation, "status">[]): Record<ObsStatus, number> {
  const counts: Record<ObsStatus, number> = { awaiting: 0, open: 0, in_progress: 0, closed: 0 };
  for (const o of rows) counts[o.status]++;
  return counts;
}

export type RatingBreakdown = RatingCounts & { name: string; total: number };

/** Observations per area, split by rating, most findings first (ties: most High first). */
export function areaBreakdown(rows: Pick<Observation, "area" | "rating">[]): RatingBreakdown[] {
  const map = new Map<string, RatingBreakdown>();
  for (const o of rows) {
    const entry = map.get(o.area) ?? { name: o.area, total: 0, High: 0, Medium: 0, Low: 0 };
    entry[o.rating]++;
    entry.total++;
    map.set(o.area, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.High - a.High || a.name.localeCompare(b.name));
}

/** Observations per accountable role. A shared finding counts once for each of its owners. */
export function ownerBreakdown(
  rows: Pick<Observation, "owners" | "owner" | "rating" | "status">[],
  { openOnly = true } = {}
): RatingBreakdown[] {
  const map = new Map<string, RatingBreakdown>();
  for (const o of rows) {
    if (openOnly && o.status === "closed") continue;
    const owners = o.owners.length > 0 ? o.owners : o.owner ? [o.owner] : ["Unassigned"];
    for (const name of owners) {
      const entry = map.get(name) ?? { name, total: 0, High: 0, Medium: 0, Low: 0 };
      entry[o.rating]++;
      entry.total++;
      map.set(name, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.High - a.High || a.name.localeCompare(b.name));
}

export type DeadlineGroup = RatingCounts & { date: string; total: number; overdue: boolean; refs: string[] };

/** Open actions grouped by target date, earliest first. Findings without a date are left out. */
export function deadlineGroups(
  rows: Pick<Observation, "target_date" | "status" | "rating" | "ref">[],
  today: string = todayIso()
): DeadlineGroup[] {
  const map = new Map<string, DeadlineGroup>();
  for (const o of rows) {
    if (o.status === "closed" || !o.target_date) continue;
    const entry =
      map.get(o.target_date) ??
      { date: o.target_date, total: 0, High: 0, Medium: 0, Low: 0, overdue: o.target_date < today, refs: [] };
    entry[o.rating]++;
    entry.total++;
    entry.refs.push(o.ref);
    map.set(o.target_date, entry);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function overdueCount(rows: Pick<Observation, "status" | "target_date">[], today = todayIso()): number {
  return rows.filter((o) => isOverdue(o, today)).length;
}

/** Highest-rated first, then by report order. */
export function bySeverity<T extends Pick<Observation, "rating" | "position">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => ratingRank(b.rating) - ratingRank(a.rating) || a.position - b.position);
}

/** Sum of the headline rupee impact across findings that state one. */
export function totalImpact(rows: Pick<Observation, "impact_inr">[]): number {
  return rows.reduce((sum, o) => sum + (o.impact_inr && o.impact_inr > 0 ? o.impact_inr : 0), 0);
}
