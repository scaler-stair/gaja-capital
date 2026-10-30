"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Rating } from "@/lib/types";

const RATINGS: Rating[] = ["High", "Medium", "Low"];
const FILL: Record<Rating, string> = { High: "#cf3a35", Medium: "#e3a019", Low: "#6b8fcf" };
const AXIS = { fontSize: 12, fill: "#667185" };
const GRID = "#e2e5ea";
const BASE = "#c9cfd8";
const SURFACE = "#ffffff";

/** Categorical order for charts the assistant draws (validated set; never cycled past eight). */
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

/** `key` is the value used in links when it differs from the label (e.g. an ISO date shown as "30 Nov 2026"). */
type Row = { name: string; key?: string; High: number; Medium: number; Low: number; total: number };

/** Where a bar click goes: `${base}?${param}=<row key>${hash}`. Plain data, so server pages can pass it. */
export type ChartLink = { base: string; param: string; hash?: string };

function linkFor(link: ChartLink, row: { name?: string; key?: string }): string | null {
  const value = row.key ?? row.name;
  if (!value) return null;
  const sep = link.base.includes("?") ? "&" : "?";
  return `${link.base}${sep}${link.param}=${encodeURIComponent(value)}${link.hash ?? ""}`;
}

type BarEntry = { name?: string; payload?: { name?: string; key?: string } };

/** The last rating with a non-zero count in a stack: where the row total is written. */
function topRating(row: Row): Rating | null {
  for (let i = RATINGS.length - 1; i >= 0; i--) if (row[RATINGS[i]] > 0) return RATINGS[i];
  return null;
}

type TipEntry = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number };

function Tip({
  active,
  label,
  payload,
  unit,
}: {
  active?: boolean;
  label?: string | number;
  payload?: TipEntry[];
  unit?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-md">
      {label !== undefined && <div className="mb-1 font-semibold text-ink">{label}</div>}
      <div className="tabular space-y-0.5">
        {payload.map((p) => (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-ink-2">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} aria-hidden />
            <span>{p.name}</span>
            <span className="ml-auto pl-4 font-semibold text-ink">
              {p.value}
              {unit ? ` ${unit}` : ""}
            </span>
          </div>
        ))}
        {payload.length > 1 && (
          <div className="mt-1 flex justify-between border-t border-rule pt-1 text-ink-2">
            <span>Total</span>
            <span className="font-semibold text-ink">{total}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function legendFormatter(value: string) {
  return <span className="text-xs text-ink-2">{value}</span>;
}

/**
 * Counts split by rating, one bar per row (areas, owners). Click a bar to open the
 * matching observations. Totals are written at the bar ends; the split is in the tooltip.
 */
export function SeverityBars({ rows, link, labelWidth = 170 }: { rows: Row[]; link?: ChartLink; labelWidth?: number }) {
  const router = useRouter();
  const height = Math.max(150, rows.length * 38 + 56);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 0 }} barCategoryGap={9}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} tick={AXIS} stroke={BASE} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={labelWidth}
            tick={{ ...AXIS, fill: "#465063" }}
            stroke={BASE}
            tickLine={false}
            interval={0}
          />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(23,31,45,0.04)" }} />
          <Legend itemSorter={null} verticalAlign="top" align="right" height={28} iconType="square" iconSize={9} formatter={legendFormatter} />
          {RATINGS.map((r) => (
            <Bar
              key={r}
              dataKey={r}
              name={r}
              stackId="s"
              fill={FILL[r]}
              stroke={SURFACE}
              strokeWidth={2}
              radius={2}
              cursor={link ? "pointer" : undefined}
              onClick={(entry: BarEntry) => {
                const href = link ? linkFor(link, entry?.payload ?? { name: entry?.name }) : null;
                if (href) router.push(href);
              }}
            >
              <LabelList
                valueAccessor={(entry: { payload: Row }) => (topRating(entry.payload) === r ? entry.payload.total : "")}
                position="right"
                offset={8}
                style={{ fontSize: 12, fontWeight: 600, fill: "#171f2d" }}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** X-axis label that puts a trailing year (or FY) on its own line, so dates fit on narrow screens. */
function TwoLineTick({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value?: string | number } }) {
  const label = String(payload?.value ?? "");
  const m = /^(.*\S)\s+((?:FY)?\d{2,4})$/.exec(label);
  return (
    <text x={Number(x)} y={Number(y) + 4} textAnchor="middle" fontSize={12} fill="#465063">
      <tspan x={Number(x)} dy="0.71em">
        {m ? m[1] : label}
      </tspan>
      {m && (
        <tspan x={Number(x)} dy="1.25em" fill="#667185">
          {m[2]}
        </tspan>
      )}
    </text>
  );
}

/** Rating split per category along the x-axis: reports over time, or due dates. */
export function SeverityColumns({
  rows,
  link,
  height = 260,
  highlight,
}: {
  rows: Row[];
  link?: ChartLink;
  height?: number;
  /** Category to mark with a reference line, e.g. today's position among due dates. */
  highlight?: { name: string; label: string };
}) {
  const router = useRouter();
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 22, right: 8, bottom: 0, left: -18 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="name" tick={<TwoLineTick />} height={40} stroke={BASE} tickLine={false} interval={0} />
          <YAxis allowDecimals={false} tick={AXIS} stroke={BASE} tickLine={false} axisLine={false} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(23,31,45,0.04)" }} />
          <Legend itemSorter={null} verticalAlign="top" align="right" height={26} iconType="square" iconSize={9} formatter={legendFormatter} />
          {highlight && (
            <ReferenceLine
              x={highlight.name}
              stroke="#ad2620"
              strokeWidth={1}
              label={{ value: highlight.label, position: "insideTopLeft", fontSize: 11, fill: "#ad2620" }}
            />
          )}
          {RATINGS.map((r) => (
            <Bar
              key={r}
              dataKey={r}
              name={r}
              stackId="s"
              fill={FILL[r]}
              stroke={SURFACE}
              strokeWidth={2}
              radius={2}
              maxBarSize={56}
              cursor={link ? "pointer" : undefined}
              onClick={(entry: BarEntry) => {
                const href = link ? linkFor(link, entry?.payload ?? { name: entry?.name }) : null;
                if (href) router.push(href);
              }}
            >
              <LabelList
                valueAccessor={(entry: { payload: Row }) => (topRating(entry.payload) === r ? entry.payload.total : "")}
                position="top"
                offset={6}
                style={{ fontSize: 12, fontWeight: 600, fill: "#171f2d" }}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Period-on-period movement per line item (e.g. expense heads), largest moves first. */
export function VarianceBars({
  items,
  unit,
  previousLabel,
  currentLabel,
}: {
  items: Array<{ label: string; previous: number | null; current: number | null; comment: string | null }>;
  unit: string;
  previousLabel: string;
  currentLabel: string;
}) {
  const rows = items
    .filter((v) => v.previous !== null || v.current !== null)
    .map((v) => ({
      name: v.label,
      change: Math.round(((v.current ?? 0) - (v.previous ?? 0)) * 100) / 100,
      previous: v.previous ?? 0,
      current: v.current ?? 0,
      comment: v.comment,
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 14);
  const height = Math.max(200, rows.length * 32 + 40);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={AXIS} stroke={BASE} tickLine={false} />
          <YAxis type="category" dataKey="name" width={170} tick={{ ...AXIS, fill: "#465063" }} stroke={BASE} tickLine={false} interval={0} />
          <ReferenceLine x={0} stroke="#8b94a3" />
          <Tooltip
            cursor={{ fill: "rgba(23,31,45,0.04)" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !p) return null;
              return (
                <div className="max-w-xs rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-md">
                  <div className="font-semibold text-ink">{p.name}</div>
                  <div className="tabular mt-1 text-ink-2">
                    {previousLabel} {p.previous} to {currentLabel} {p.current} {unit}: change{" "}
                    <span className="font-semibold text-ink">{p.change > 0 ? `+${p.change}` : p.change}</span>
                  </div>
                  {p.comment && <div className="mt-1 text-ink-2">{p.comment}</div>}
                </div>
              );
            }}
          />
          <Bar dataKey="change" name={`Change (${unit})`} radius={2}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.change >= 0 ? "#d9762b" : "#3b6fe0"} />
            ))}
            <LabelList
              dataKey="change"
              position="right"
              offset={6}
              style={{ fontSize: 11, fontWeight: 600, fill: "#171f2d" }}
              formatter={(v: unknown) => {
                const n = Number(v);
                return n > 0 ? `+${n}` : String(n);
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Shape of a chart the AI assistant asks for in a ```chart block. */
export type ChartSpec = {
  type: "bar" | "stacked" | "donut" | "line";
  title?: string;
  unit?: string;
  series?: string[];
  data: Array<{ label: string; value?: number; values?: Record<string, number> }>;
};

export function parseChartSpec(source: string): ChartSpec | null {
  try {
    const spec = JSON.parse(source) as ChartSpec;
    if (!spec || !["bar", "stacked", "donut", "line"].includes(spec.type) || !Array.isArray(spec.data)) return null;
    const data = spec.data
      .filter((d) => d && typeof d.label === "string")
      .slice(0, 16)
      .map((d) => ({
        label: d.label,
        value: typeof d.value === "number" ? d.value : undefined,
        values: d.values && typeof d.values === "object" ? d.values : undefined,
      }));
    if (data.length === 0) return null;
    const series = Array.isArray(spec.series) ? spec.series.filter((s) => typeof s === "string").slice(0, 8) : undefined;
    return { ...spec, data, series };
  } catch {
    return null;
  }
}

function seriesColor(name: string, index: number): string {
  return (FILL as Record<string, string>)[name] ?? SERIES[index % SERIES.length];
}

/** Renders the assistant's chart, with the values repeated in a small table underneath. */
export function AnswerChart({ spec }: { spec: ChartSpec }) {
  const unit = spec.unit && spec.unit !== "count" ? spec.unit : undefined;
  const series =
    spec.series && spec.series.length > 0
      ? spec.series
      : [...new Set(spec.data.flatMap((d) => Object.keys(d.values ?? {})))].slice(0, 8);
  const flat = spec.data.map((d) => ({ name: d.label, value: d.value ?? 0, ...(d.values ?? {}) }));
  const height = spec.type === "donut" ? 240 : Math.min(360, Math.max(220, spec.data.length * 30 + 70));

  let chart: React.ReactNode;
  if (spec.type === "donut") {
    chart = (
      <PieChart>
        <Pie data={flat} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" stroke={SURFACE} strokeWidth={2}>
          {flat.map((d, i) => (
            <Cell key={d.name} fill={seriesColor(d.name, i)} />
          ))}
        </Pie>
        <Tooltip content={<Tip unit={unit} />} />
        <Legend itemSorter={null} verticalAlign="middle" align="right" layout="vertical" iconType="square" iconSize={9} formatter={legendFormatter} />
      </PieChart>
    );
  } else if (spec.type === "line") {
    chart = (
      <LineChart data={flat} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={AXIS} stroke={BASE} tickLine={false} />
        <YAxis tick={AXIS} stroke={BASE} tickLine={false} axisLine={false} />
        <Tooltip content={<Tip unit={unit} />} />
        <Legend itemSorter={null} verticalAlign="top" align="right" height={26} iconType="square" iconSize={9} formatter={legendFormatter} />
        {(series.length > 0 ? series : ["value"]).map((s, i) => (
          <Line key={s} type="monotone" dataKey={s} name={s === "value" ? spec.title ?? "Value" : s} stroke={seriesColor(s, i)} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: SURFACE }} />
        ))}
      </LineChart>
    );
  } else if (spec.type === "stacked" && series.length > 0) {
    chart = (
      <BarChart data={flat} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 0 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} stroke={BASE} tickLine={false} />
        <YAxis type="category" dataKey="name" width={150} tick={{ ...AXIS, fill: "#465063" }} stroke={BASE} tickLine={false} interval={0} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "rgba(23,31,45,0.04)" }} />
        <Legend itemSorter={null} verticalAlign="top" align="right" height={26} iconType="square" iconSize={9} formatter={legendFormatter} />
        {series.map((s, i) => (
          <Bar key={s} dataKey={s} name={s} stackId="s" fill={seriesColor(s, i)} stroke={SURFACE} strokeWidth={2} radius={2} />
        ))}
      </BarChart>
    );
  } else {
    chart = (
      <BarChart data={flat} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 0 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={AXIS} stroke={BASE} tickLine={false} />
        <YAxis type="category" dataKey="name" width={150} tick={{ ...AXIS, fill: "#465063" }} stroke={BASE} tickLine={false} interval={0} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "rgba(23,31,45,0.04)" }} />
        <Bar dataKey="value" name={spec.title ?? "Value"} fill="#2d394e" radius={2}>
          {flat.map((d) => (
            <Cell key={d.name} fill={(FILL as Record<string, string>)[d.name] ?? "#2d394e"} />
          ))}
          <LabelList dataKey="value" position="right" offset={6} style={{ fontSize: 11, fontWeight: 600, fill: "#171f2d" }} />
        </Bar>
      </BarChart>
    );
  }

  return (
    <figure className="my-3 rounded-lg border border-rule bg-surface p-3">
      {spec.title && <figcaption className="mb-2 text-sm font-semibold text-ink">{spec.title}</figcaption>}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart as React.ReactElement}
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs text-ink-2">
        <summary className="cursor-pointer select-none text-muted hover:text-ink">Show the numbers</summary>
        <table className="tabular mt-2 w-full">
          <tbody>
            {spec.data.map((d) => (
              <tr key={d.label} className="border-t border-rule">
                <td className="py-1 pr-3">{d.label}</td>
                <td className="py-1 text-right font-medium text-ink">
                  {d.values
                    ? Object.entries(d.values)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(", ")
                    : d.value}
                  {unit ? ` ${unit}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
