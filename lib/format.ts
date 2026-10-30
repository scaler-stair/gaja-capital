// Display helpers. Pure functions, safe on the server and in the browser.
import type { ObsStatus, Rating, ReportRef, ReportRow } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Gaja is in India, so "today" (for overdue checks) is today in IST. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** "2026-11-30" -> "30 Nov 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "2026-11-30" -> "Nov 2026". */
export function formatMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/** Timestamps from the database, shown in IST: "29 Oct 2026, 18:05". */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Rupees in the units Indian board papers use: 117000000 -> "₹11.70 Cr", 7519000 -> "₹75.19 L". */
export function formatInr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ratingRank(rating: Rating | string | null): number {
  return rating === "High" ? 3 : rating === "Medium" ? 2 : rating === "Low" ? 1 : 0;
}

export function isOverdue(
  o: { status: ObsStatus; target_date: string | null },
  today: string = todayIso()
): boolean {
  return o.status !== "closed" && !!o.target_date && o.target_date < today;
}

/** Days from today until a date (negative when past). */
export function daysUntil(iso: string, today: string = todayIso()): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * Short label for a report, used in charts and chips: "Q2 FY 2026-27" -> "Q2 FY27".
 * Falls back to the meeting month, then the file name.
 */
export function shortPeriod(r: {
  quarter?: string | null;
  fiscal_year?: string | null;
  period_label?: string | null;
  report_date?: string | null;
  file_name?: string;
}): string {
  const fy = r.fiscal_year ?? r.period_label ?? "";
  const years = /(\d{2,4})\s*[-–/]\s*(\d{2,4})/.exec(fy);
  const single = /FY\s*'?(\d{2,4})\b/i.exec(fy);
  const fyShort = years ? `FY${years[2].slice(-2)}` : single ? `FY${single[1].slice(-2)}` : "";
  const quarter = r.quarter ?? /\bQ[1-4]\b/.exec(r.period_label ?? "")?.[0] ?? "";
  if (quarter && fyShort) return `${quarter} ${fyShort}`;
  if (r.period_label) return r.period_label;
  if (r.report_date) return formatMonth(r.report_date);
  return (r.file_name ?? "Report").replace(/\.pdf$/i, "");
}

/** The identity of a report used by charts, pickers and lineage. */
export function reportRef(r: ReportRow): ReportRef {
  return {
    id: r.id,
    period: shortPeriod(r),
    title: r.title ?? r.file_name.replace(/\.pdf$/i, ""),
    date: r.report_date ?? r.period_end,
  };
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
