// Small presentational pieces shared by every page. No hooks, so they render on the server too.
import { CircleCheck, CircleDashed, Circle, Clock3, TriangleAlert } from "lucide-react";
import { STATUS_LABEL, type ObsStatus, type Rating } from "@/lib/types";

export const button = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-3 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-rule-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
  quiet:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-high-ink transition-colors hover:bg-high/10 disabled:opacity-50",
};

export const field =
  "w-full rounded-lg border border-rule-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/20";

const RATING_STYLE: Record<Rating, { dot: string; ink: string }> = {
  High: { dot: "bg-high", ink: "text-high-ink" },
  Medium: { dot: "bg-medium", ink: "text-medium-ink" },
  Low: { dot: "bg-low", ink: "text-low-ink" },
};

export const RATING_FILL: Record<Rating, string> = {
  High: "var(--color-high)",
  Medium: "var(--color-medium)",
  Low: "var(--color-low)",
};

export function RatingBadge({ rating }: { rating: Rating }) {
  const s = RATING_STYLE[rating];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${s.ink}`}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-[2px] ${s.dot}`} aria-hidden />
      {rating}
    </span>
  );
}

const STATUS_STYLE: Record<ObsStatus, { icon: typeof Circle; ink: string }> = {
  awaiting: { icon: Clock3, ink: "text-ink-2" },
  open: { icon: Circle, ink: "text-open" },
  in_progress: { icon: CircleDashed, ink: "text-progress" },
  closed: { icon: CircleCheck, ink: "text-closed-ink" },
};

export const STATUS_FILL: Record<ObsStatus, string> = {
  awaiting: "var(--color-awaiting)",
  open: "var(--color-open)",
  in_progress: "var(--color-progress)",
  closed: "var(--color-closed)",
};

export function StatusBadge({ status, text, overdue = false }: { status: ObsStatus; text?: string | null; overdue?: boolean }) {
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${s.ink}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {text || STATUS_LABEL[status]}
      </span>
      {overdue && <OverdueTag />}
    </span>
  );
}

export function OverdueTag() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-high/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-overdue">
      <TriangleAlert className="h-3 w-3" aria-hidden />
      Overdue
    </span>
  );
}

export function RefTag({ value }: { value: string }) {
  return (
    <span className="tabular inline-flex shrink-0 items-center rounded border border-rule bg-surface-2 px-1.5 py-px text-[0.72rem] font-semibold tracking-wide text-ink-2">
      {value}
    </span>
  );
}

export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="font-serif text-[1.9rem] font-medium leading-[1.15] text-ink sm:text-[2.15rem]">{title}</h1>
        {lead && <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">{lead}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className = "",
  bodyClassName = "",
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-xl border border-rule bg-surface ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[0.95rem] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {action && <div className="no-print shrink-0">{action}</div>}
        </header>
      )}
      <div className={`px-5 pb-5 ${title || action ? "pt-3" : "pt-5"} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "high" | "closed" | "overdue";
}) {
  const color = tone === "high" ? "text-high-ink" : tone === "closed" ? "text-closed-ink" : tone === "overdue" ? "text-overdue" : "text-ink";
  return (
    <div className="min-w-0">
      <div className={`text-[1.9rem] font-semibold leading-none ${color}`}>{value}</div>
      <div className="mt-2 text-sm text-ink-2">{label}</div>
      {note && <div className="mt-0.5 text-xs text-muted">{note}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-rule-strong bg-surface px-6 py-12 text-center">
      <h2 className="font-serif text-xl font-medium text-ink">{title}</h2>
      <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">{body}</div>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * Proportional bar of a count split by rating, with the counts written out beside it,
 * so the split never relies on colour alone.
 */
export function SeverityBar({
  counts,
  height = 10,
  legend = true,
  tone = "light",
}: {
  counts: Record<Rating, number>;
  height?: number;
  legend?: boolean;
  /** "dark" when drawn on the navy band. */
  tone?: "light" | "dark";
}) {
  const total = counts.High + counts.Medium + counts.Low;
  const parts = (["High", "Medium", "Low"] as Rating[]).filter((r) => counts[r] > 0);
  const dark = tone === "dark";
  return (
    <div className="w-full">
      <div className={`flex w-full gap-[2px] overflow-hidden rounded-[3px] ${dark ? "bg-navy" : "bg-surface"}`} style={{ height }}>
        {total === 0 ? (
          <span className={`block h-full w-full ${dark ? "bg-white/15" : "bg-rule"}`} />
        ) : (
          parts.map((r) => (
            <span
              key={r}
              className="block h-full first:rounded-l-[3px] last:rounded-r-[3px]"
              style={{ flexGrow: counts[r], flexBasis: 0, background: RATING_FILL[r] }}
              title={`${r}: ${counts[r]}`}
            />
          ))
        )}
      </div>
      {legend && (
        <div className={`tabular mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs ${dark ? "text-white/70" : "text-ink-2"}`}>
          {(["High", "Medium", "Low"] as Rating[]).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: RATING_FILL[r] }} aria-hidden />
              {r} <span className={`font-semibold ${dark ? "text-white" : "text-ink"}`}>{counts[r]}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
