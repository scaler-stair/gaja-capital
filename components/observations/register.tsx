"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Search, X } from "lucide-react";
import { SourceViewer, type SourceTarget } from "./source-viewer";
import { OverdueTag, RatingBadge, RefTag, StatusBadge, button, field } from "@/components/ui";
import { formatDate, isOverdue, ratingRank } from "@/lib/format";
import { searchTextFor } from "@/lib/pdf-match";
import { RATINGS, STATUSES, STATUS_LABEL, type ObservationWithReport, type ObsStatus, type Rating } from "@/lib/types";

export type HistoryItem = { period: string; text: string; current: boolean };

export type RegisterFilters = {
  q?: string;
  report?: string;
  area?: string;
  rating?: string;
  status?: string;
  owner?: string;
  due?: string;
  overdue?: string;
  /** Observation id whose detail opens on load (deep links from the overview). */
  open?: string;
};

type SortKey = "order" | "rating" | "target";

type Filters = {
  q: string;
  report: string;
  area: string;
  rating: string;
  status: string;
  owner: string;
  due: string;
  overdue: boolean;
};

function fromInitial(i: RegisterFilters): Filters {
  return {
    q: i.q ?? "",
    report: i.report ?? "",
    area: i.area ?? "",
    rating: i.rating ?? "",
    status: i.status ?? "",
    owner: i.owner ?? "",
    due: i.due ?? "",
    overdue: i.overdue === "1",
  };
}

const NO_FILTERS = fromInitial({});

export function ObservationRegister({
  rows,
  history = {},
  initial = {},
  showReport = false,
  today,
  exportHref,
  syncUrl = true,
}: {
  rows: ObservationWithReport[];
  history?: Record<number, HistoryItem[]>;
  initial?: RegisterFilters;
  showReport?: boolean;
  today: string;
  exportHref?: string;
  /** Mirror filters into the address bar so a filtered view can be shared or revisited. */
  syncUrl?: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(() => fromInitial(initial));
  const [sort, setSort] = useState<SortKey>("order");
  const [openId, setOpenId] = useState<number | null>(initial.open ? Number(initial.open) : null);
  const [source, setSource] = useState<SourceTarget | null>(null);

  // A chart click navigates here with new filters in the URL; adopt them.
  const initialKey = JSON.stringify(initial);
  const [seenKey, setSeenKey] = useState(initialKey);
  if (seenKey !== initialKey) {
    setSeenKey(initialKey);
    setFilters(fromInitial(initial));
    if (initial.open) setOpenId(Number(initial.open));
  }

  const { q, report, area, rating, status, owner, due, overdue: overdueOnly } = filters;
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const reports = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of rows) if (!seen.has(r.report_id)) seen.set(r.report_id, r.period);
    return [...seen.entries()].map(([id, period]) => ({ id, period }));
  }, [rows]);
  const areas = useMemo(() => [...new Set(rows.map((r) => r.area))].sort(), [rows]);
  const owners = useMemo(
    () => [...new Set(rows.flatMap((r) => (r.owners.length ? r.owners : r.owner ? [r.owner] : [])))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (!report || String(r.report_id) === report) &&
        (!area || r.area === area) &&
        (!rating || r.rating === rating) &&
        (!status || r.status === status) &&
        (!owner || r.owners.includes(owner) || r.owner === owner) &&
        (!due || r.target_date === due) &&
        (!overdueOnly || isOverdue(r, today)) &&
        (!needle ||
          `${r.ref} ${r.title} ${r.summary ?? ""} ${r.area} ${r.owner ?? ""}`.toLowerCase().includes(needle))
    );
    if (sort === "rating") return [...list].sort((a, b) => ratingRank(b.rating) - ratingRank(a.rating));
    if (sort === "target") {
      return [...list].sort((a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"));
    }
    return list;
  }, [rows, q, report, area, rating, status, owner, due, overdueOnly, sort, today]);

  // The address bar follows the filters without a server round trip (history API, not router).
  useEffect(() => {
    if (!syncUrl) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (report) params.set("report", report);
      if (area) params.set("area", area);
      if (rating) params.set("rating", rating);
      if (status) params.set("status", status);
      if (owner) params.set("owner", owner);
      if (due) params.set("due", due);
      if (overdueOnly) params.set("overdue", "1");
      const next = params.toString();
      const url = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
      if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, "", url);
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [syncUrl, q, report, area, rating, status, owner, due, overdueOnly]);

  const active = !!(q || report || area || rating || status || owner || due || overdueOnly);
  const clearAll = () => setFilters(NO_FILTERS);

  const open = openId !== null ? rows.find((r) => r.id === openId) ?? null : null;

  function viewSource(r: ObservationWithReport) {
    setSource({
      observationId: r.id,
      observationTitle: `${r.ref}: ${r.title}`,
      reportId: r.report_id,
      reportTitle: r.report_title,
      periodLabel: r.period,
      quote: r.source_quote,
      page: r.source_page,
      searchText: searchTextFor(r),
    });
  }

  const select =
    "rounded-lg border border-rule-strong bg-surface py-1.5 pl-3 pr-8 text-sm text-ink focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/20";

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search observations"
            aria-label="Search observations"
            className={`${field} py-1.5 pl-9`}
          />
        </div>
        {showReport && reports.length > 1 && (
          <select value={report} onChange={(e) => set("report", e.target.value)} className={select} aria-label="Report">
            <option value="">All reports</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.period}
              </option>
            ))}
          </select>
        )}
        <select value={area} onChange={(e) => set("area", e.target.value)} className={select} aria-label="Area">
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-lg border border-rule-strong bg-surface text-sm" role="group" aria-label="Rating">
          {["", ...RATINGS].map((r) => (
            <button
              key={r || "all"}
              type="button"
              onClick={() => set("rating", r)}
              aria-pressed={rating === r}
              className={`px-3 py-1.5 transition-colors ${rating === r ? "bg-navy text-white" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {r || "All"}
            </button>
          ))}
        </div>
        <select value={status} onChange={(e) => set("status", e.target.value)} className={select} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {owners.length > 0 && (
          <select value={owner} onChange={(e) => set("owner", e.target.value)} className={select} aria-label="Owner">
            <option value="">All owners</option>
            {owners.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-2">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => set("overdue", e.target.checked)} className="h-4 w-4 accent-navy" />
          Overdue only
        </label>
        {due && (
          <span className="inline-flex items-center gap-1 rounded-full bg-navy/10 px-2.5 py-1 text-xs font-medium text-ink">
            Due {formatDate(due)}
            <button type="button" onClick={() => set("due", "")} aria-label="Remove due date filter" className="rounded-full p-0.5 hover:bg-navy/10">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {active && (
          <button type="button" onClick={clearAll} className={button.quiet}>
            Clear filters
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="tabular">
          Showing <span className="font-semibold text-ink">{filtered.length}</span> of {rows.length} observations
        </span>
        <span className="no-print flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border border-rule bg-surface px-1.5 py-0.5 text-xs text-ink">
              <option value="order">As in the report</option>
              <option value="rating">Highest rating first</option>
              <option value="target">Earliest target first</option>
            </select>
          </label>
          {exportHref && (
            <a href={exportHref} className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink">
              <Download className="h-3.5 w-3.5" aria-hidden /> Export to Excel
            </a>
          )}
        </span>
      </div>

      {/* Phones: one card per observation instead of a wide table. */}
      <ul className="space-y-2 sm:hidden">
        {filtered.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setOpenId(r.id)}
              className="block w-full rounded-xl border border-rule bg-surface p-4 text-left transition-colors active:bg-surface-2"
            >
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <RefTag value={r.ref} />
                {showReport && <span>{r.period}</span>}
                <RatingBadge rating={r.rating} />
              </span>
              <span className="mt-2 block font-medium leading-snug text-ink">{r.title}</span>
              <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                {r.owner && <span>{r.owner}</span>}
                {(r.target_date || r.target_text) && <span>Target {r.target_date ? formatDate(r.target_date) : r.target_text}</span>}
                <StatusBadge status={r.status} text={r.status_text} overdue={isOverdue(r, today)} />
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="rounded-xl border border-rule bg-surface px-4 py-8 text-center text-sm text-muted">No observations match these filters.</li>
        )}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-rule bg-surface sm:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs font-medium text-muted">
              <th className="w-20 px-4 py-3 font-medium">Ref</th>
              {showReport && <th className="px-3 py-3 font-medium">Report</th>}
              <th className="px-3 py-3 font-medium">Observation</th>
              <th className="hidden px-3 py-3 font-medium md:table-cell">Area</th>
              <th className="px-3 py-3 font-medium">Rating</th>
              <th className="hidden px-3 py-3 font-medium lg:table-cell">Owner</th>
              <th className="px-3 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const overdue = isOverdue(r, today);
              return (
                <tr
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="cursor-pointer border-b border-rule align-top transition-colors last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-3">
                    <RefTag value={r.ref} />
                  </td>
                  {showReport && <td className="whitespace-nowrap px-3 py-3 text-ink-2">{r.period}</td>}
                  <td className="max-w-md px-3 py-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(r.id);
                      }}
                      className="text-left font-medium text-ink hover:underline"
                    >
                      {r.title}
                    </button>
                    {r.impact_text && <div className="tabular mt-0.5 text-xs text-muted">{r.impact_text}</div>}
                  </td>
                  <td className="hidden px-3 py-3 text-ink-2 md:table-cell">{r.area}</td>
                  <td className="px-3 py-3">
                    <RatingBadge rating={r.rating} />
                  </td>
                  <td className="hidden px-3 py-3 text-ink-2 lg:table-cell">{r.owner ?? ""}</td>
                  <td className="tabular whitespace-nowrap px-3 py-3 text-ink-2">
                    {r.target_date ? formatDate(r.target_date) : r.target_text ?? ""}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} text={r.status_text} overdue={overdue} />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showReport ? 8 : 7} className="px-4 py-10 text-center text-sm text-muted">
                  No observations match these filters.{" "}
                  {active && (
                    <button type="button" onClick={clearAll} className="font-medium text-ink underline">
                      Clear filters
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <ObservationDrawer
          o={open}
          history={history[open.id] ?? []}
          overdue={isOverdue(open, today)}
          onClose={() => setOpenId(null)}
          onSource={() => viewSource(open)}
          listenEscape={!source}
        />
      )}
      <SourceViewer target={source} onClose={() => setSource(null)} />
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold text-muted">{title}</h3>
      <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-ink">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-ink-2" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

export function ObservationDrawer({
  o,
  history,
  overdue,
  onClose,
  onSource,
  listenEscape = true,
}: {
  o: ObservationWithReport;
  history: HistoryItem[];
  overdue: boolean;
  onClose: () => void;
  onSource: () => void;
  /** Off while the source viewer is open on top, so Escape closes only the top layer. */
  listenEscape?: boolean;
}) {
  useEffect(() => {
    if (!listenEscape) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, listenEscape]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30" onClick={onClose} aria-hidden />
      <aside
        className="slide-in fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-surface shadow-2xl sm:w-[40rem] sm:max-w-[94vw]"
        role="dialog"
        aria-modal="true"
        aria-label={`Observation ${o.ref}`}
      >
        <header className="flex items-start gap-3 border-b border-rule px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <RefTag value={o.ref} />
              <span>{o.period}</span>
              <span aria-hidden>/</span>
              <span className="truncate">{o.area}</span>
            </div>
            <h2 className="mt-2 font-serif text-[1.35rem] font-medium leading-snug text-ink">{o.title}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <RatingBadge rating={o.rating as Rating} />
              <StatusBadge status={o.status as ObsStatus} text={o.status_text} />
              {overdue && <OverdueTag />}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Meta label="Owner" value={o.owner} />
            <Meta label="Target date" value={o.target_date ? formatDate(o.target_date) : o.target_text} />
            <Meta label="Amount involved" value={o.impact_text} />
            <Meta label="Evidence" value={o.evidence} />
          </dl>

          {o.summary && <p className="text-[0.95rem] leading-relaxed text-ink">{o.summary}</p>}
          {o.background && (
            <section>
              <h3 className="text-xs font-semibold text-muted">Background</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{o.background}</p>
            </section>
          )}
          <List title="Exceptions noted" items={o.exceptions} />
          <List title="Root cause" items={o.root_causes} />
          <List title="Recommendation" items={o.recommendations} />
          {o.management_response && (
            <section>
              <h3 className="text-xs font-semibold text-muted">Management response</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{o.management_response}</p>
            </section>
          )}

          {history.length > 1 && (
            <section>
              <h3 className="text-xs font-semibold text-muted">Across board meetings</h3>
              <ol className="mt-2 space-y-2 border-l border-rule-strong pl-4">
                {history.map((h, i) => (
                  <li key={i} className="relative text-sm">
                    <span
                      className={`absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full ${h.current ? "bg-gaja" : "bg-rule-strong"}`}
                      aria-hidden
                    />
                    <span className="font-medium text-ink">{h.period}</span>
                    <span className="text-ink-2">: {h.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="rounded-lg border border-rule bg-surface-2 p-4">
            <h3 className="text-xs font-semibold text-muted">From the report</h3>
            {o.source_quote ? (
              <blockquote className="mt-2 border-l-2 border-medium pl-3 text-sm italic leading-relaxed text-ink-2">
                {o.source_quote}
              </blockquote>
            ) : (
              <p className="mt-2 text-sm text-ink-2">Open the report to see this finding in context.</p>
            )}
            <button type="button" onClick={onSource} className={`${button.primary} mt-3`}>
              <FileText className="h-4 w-4" aria-hidden />
              View in the report{o.source_page ? `, page ${o.source_page}` : ""}
            </button>
          </section>
        </div>
      </aside>
    </>
  );
}
