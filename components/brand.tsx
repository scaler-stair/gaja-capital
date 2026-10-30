import { BRAND } from "@/lib/brand";

/** The five pillars of the Gaja Capital mark, redrawn from the logo artwork. */
export function GajaMark({ className = "", title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 275 231"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="currentColor"
    >
      <rect x="0" y="0" width="43" height="231" />
      <rect x="58" y="0" width="43" height="231" />
      <rect x="116" y="0" width="43" height="231" />
      <rect x="174" y="0" width="43" height="231" />
      <rect x="232" y="0" width="43" height="151" />
    </svg>
  );
}

export function GajaLogo({
  tone = "light",
  size = "md",
  className = "",
}: {
  /** "light" for navy type on a light background, "dark" for white type on navy. */
  tone?: "light" | "dark";
  size?: "md" | "lg";
  className?: string;
}) {
  if (BRAND.logoSrc) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- static brand asset, sized by CSS */
      <img src={BRAND.logoSrc} alt={BRAND.name} className={`${size === "lg" ? "h-12" : "h-8"} w-auto ${className}`} />
    );
  }
  return (
    <span className={`inline-flex items-center ${size === "lg" ? "gap-4" : "gap-2.5"} ${className}`} aria-label={BRAND.name} role="img">
      <GajaMark className={`${size === "lg" ? "h-10" : "h-6"} w-auto shrink-0 text-gaja`} />
      <span
        aria-hidden
        className={`whitespace-nowrap font-medium uppercase ${size === "lg" ? "text-xl tracking-[0.1em]" : "text-[0.9rem] tracking-[0.09em]"} ${
          tone === "dark" ? "text-white" : "text-navy"
        }`}
      >
        {BRAND.name}
      </span>
    </span>
  );
}

const PILLAR_HEIGHTS = [1, 1, 1, 1, 0.654];

/** Waiting indicator: the five pillars breathing in sequence. */
export function PillarLoader({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-sm text-ink-2" role="status">
      <span className="flex items-end gap-[2px]" style={{ height: 16 }} aria-hidden>
        {PILLAR_HEIGHTS.map((h, i) => (
          <span
            key={i}
            className="pillar-active block w-[3px] bg-gaja"
            style={{ height: Math.round(16 * h), animationDelay: `${i * 140}ms` }}
          />
        ))}
      </span>
      {label}
    </span>
  );
}

/**
 * Report-reading progress drawn as the Gaja mark: one pillar per stage, the short
 * fifth pillar lighting up when the report is ready. `stage` is 0 (queued) to 5 (ready).
 */
export function PillarProgress({
  stage,
  failed = false,
  size = "md",
  label,
}: {
  stage: number;
  failed?: boolean;
  size?: "sm" | "md";
  label?: string;
}) {
  const height = size === "sm" ? 22 : 46;
  const width = size === "sm" ? 5 : 10;
  const gap = size === "sm" ? 2 : 4;
  return (
    <div
      className="flex items-end"
      style={{ gap, height }}
      role="progressbar"
      aria-label={label ?? "Report reading progress"}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={Math.min(stage, 5)}
    >
      {PILLAR_HEIGHTS.map((h, i) => {
        const n = i + 1;
        const done = stage >= 5 || stage > n;
        const active = !failed && !done && stage === n;
        return (
          <span
            key={n}
            className="relative block overflow-hidden"
            style={{ width, height: Math.round(height * h), background: "var(--color-rule)" }}
          >
            <span
              className={`pillar-fill absolute inset-0 ${active ? "pillar-active" : ""}`}
              style={{
                background: failed && stage === n ? "var(--color-muted)" : "var(--color-gaja)",
                transform: done || active ? "scaleY(1)" : "scaleY(0)",
              }}
            />
          </span>
        );
      })}
    </div>
  );
}
