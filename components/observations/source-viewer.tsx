"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs --
 * Ported unchanged from the audit dashboard's viewer, where it is proven in use. It drives
 * pdf.js imperatively: effects reset viewer state when the document changes, and pages
 * register their DOM nodes through callback refs used only for scrolling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findQuote,
  normalizeText,
  type PageText,
  type QuoteMatch,
} from "@/lib/pdf-match";

/** Minimal shape of the pdf.js objects we touch, so we can keep the import dynamic. */
type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
};
type Viewport = {
  width: number;
  height: number;
  transform: number[];
  scale: number;
};
type PdfPage = {
  getViewport: (opts: { scale: number }) => Viewport;
  getTextContent: () => Promise<{ items: TextItem[] }>;
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: Viewport;
    canvas: HTMLCanvasElement;
  }) => { promise: Promise<void>; cancel: () => void };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfLoadingTask = {
  promise: Promise<PdfDoc>;
  destroy: () => Promise<void>;
};

/** A highlight box in page coordinates at scale 1, so it survives zooming. */
type Box = { left: number; top: number; width: number; height: number };

/** Per page: the raw text items and where each one landed in the page's text. */
type ItemIndex = Map<
  number,
  {
    items: TextItem[];
    ranges: Array<{ item: number; start: number; end: number }>;
  }
>;

export type SourceTarget = {
  observationId: number;
  observationTitle: string;
  reportId: number;
  reportTitle: string;
  periodLabel: string;
  quote: string | null;
  page: number | null;
  /** Used to search the document when there is no stored quote. */
  searchText: string;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/** Horizontal padding of the scroll area, so a page can be fitted to its width. */
const GUTTER = 40;

export function SourceViewer({
  target,
  onClose,
}: {
  target: SourceTarget | null;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [match, setMatch] = useState<QuoteMatch | null>(null);
  const [boxes, setBoxes] = useState<Record<number, Box[]>>({});
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [visiblePage, setVisiblePage] = useState(1);
  const scale = fitScale * zoom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const textCache = useRef<{
    reportId: number;
    pages: PageText[];
    items: ItemIndex;
  } | null>(null);
  const reportId = target?.reportId ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (!target) return;
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [target, onClose]);

  // Load the document whenever a different report is asked for.
  useEffect(() => {
    if (!reportId) {
      setDoc(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let task: PdfLoadingTask | null = null;
    setStatus("loading");
    setError("");
    setDoc(null);
    setBoxes({});
    setMatch(null);
    setZoom(1);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = pdfjs.getDocument({
          url: `/api/reports/${reportId}/pdf`,
        }) as unknown as PdfLoadingTask;
        const loaded = await task.promise;
        if (cancelled) return;
        setDoc(loaded);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      const closing = task;
      task = null;
      // Drop the document first so the page canvases unmount, then tear down the
      // worker. Destroying it while they are still rendering kills their transport.
      setDoc(null);
      setTimeout(() => closing?.destroy().catch(() => {}), 0);
    };
  }, [reportId]);

  // Find the passage, and turn the hit into highlight boxes in page space.
  useEffect(() => {
    if (!doc || !target) return;
    let cancelled = false;

    (async () => {
      try {
        let pages: PageText[];
        let itemsByPage: ItemIndex;

        const cached = textCache.current;
        if (cached && cached.reportId === target.reportId) {
          pages = cached.pages;
          itemsByPage = cached.items;
        } else {
          pages = [];
          itemsByPage = new Map();
          for (let n = 1; n <= doc.numPages; n++) {
            if (cancelled) return;
            const page = await doc.getPage(n);
            const content = await page.getTextContent();
            let text = "";
            const ranges: Array<{ item: number; start: number; end: number }> =
              [];
            content.items.forEach((item, index) => {
              const piece = normalizeText(item.str ?? "");
              if (piece) {
                if (text && !text.endsWith(" ")) text += " ";
                const start = text.length;
                text += piece;
                ranges.push({ item: index, start, end: text.length });
              }
              if (item.hasEOL && text && !text.endsWith(" ")) text += " ";
            });
            pages.push({ pageNumber: n, text });
            itemsByPage.set(n, { items: content.items, ranges });
          }
          textCache.current = {
            reportId: target.reportId,
            pages,
            items: itemsByPage,
          };
        }
        if (cancelled) return;

        const found = findQuote(
          pages,
          target.quote?.trim() ? target.quote : target.searchText,
          target.page,
        );
        setMatch(found);
        if (!found || found.end <= found.start) return;

        const source = itemsByPage.get(found.pageNumber);
        if (!source) return;
        const page = await doc.getPage(found.pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const pdfjs = await import("pdfjs-dist");

        const rects: Box[] = [];
        for (const range of source.ranges) {
          if (range.end <= found.start || range.start >= found.end) continue;
          const item = source.items[range.item];
          if (!item?.str) continue;
          const tx = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]) || item.height;
          const spanLength = Math.max(1, range.end - range.start);
          // Partially covered items are clipped proportionally by character count.
          const fromChar = Math.max(0, found.start - range.start) / spanLength;
          const toChar =
            Math.min(spanLength, found.end - range.start) / spanLength;
          rects.push({
            left: tx[4] + item.width * fromChar,
            top: tx[5] - fontHeight,
            width: Math.max(2, item.width * (toChar - fromChar)),
            height: fontHeight * 1.25,
          });
        }
        if (!cancelled) setBoxes({ [found.pageNumber]: rects });
      } catch {
        // Closed mid-scan; the next open starts over.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, target]);

  // Pages are fitted to the panel so nothing is cut off; zoom multiplies that.
  useEffect(() => {
    if (!doc) return;
    const container = scrollRef.current;
    if (!container) return;
    let cancelled = false;

    const loaded = doc;
    async function fit() {
      try {
        const page = await loaded.getPage(1);
        const width = page.getViewport({ scale: 1 }).width;
        const available = (scrollRef.current?.clientWidth ?? 0) - GUTTER;
        if (!cancelled && width > 0 && available > 0)
          setFitScale(available / width);
      } catch {
        // The document was closed while measuring; nothing to fit.
      }
    }

    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(container);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [doc]);

  const scrollToMatch = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !match) return;
    const el = pageRefs.current.get(match.pageNumber);
    if (!el) return;
    const rects = boxes[match.pageNumber] ?? [];
    const highest = rects.length > 0 ? Math.min(...rects.map((b) => b.top)) : 0;
    // Park the passage a third of the way down, so its context stays visible.
    const offset =
      rects.length > 0 ? highest * scale - container.clientHeight / 3 : -12;
    container.scrollTo({
      top: Math.max(0, el.offsetTop + offset),
      behavior: "smooth",
    });
  }, [match, boxes, scale]);

  // Jump to the passage once its page has been laid out.
  useEffect(() => {
    if (!match) return;
    const id = window.setTimeout(scrollToMatch, 180);
    return () => window.clearTimeout(id);
  }, [match, scrollToMatch]);

  const onScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    // The page occupying the middle of the panel is the one being read.
    const marker = container.scrollTop + container.clientHeight / 2;
    let current = 1;
    for (const [pageNumber, el] of pageRefs.current) {
      if (el.offsetTop <= marker && pageNumber > current) current = pageNumber;
    }
    setVisiblePage(current);
  }, []);

  const pageNumbers = useMemo(
    () => (doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : []),
    [doc],
  );

  if (!target) return null;

  const matchNote =
    match?.kind === "exact"
      ? `Highlighted on page ${match.pageNumber}`
      : match?.kind === "partial"
        ? `Closest wording highlighted on page ${match.pageNumber}`
        : match?.kind === "page"
          ? `The exact wording is not in the PDF's text layer, so the most likely page (${match.pageNumber}) is open`
          : status === "ready"
            ? "Could not locate this passage in the document"
            : "";

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(23,31,45,0.35)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="slide-in fixed right-0 top-0 z-50 flex h-full w-full flex-col shadow-2xl sm:w-[46rem] sm:max-w-[92vw]"
        style={{
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-rule)",
        }}
        role="dialog"
        aria-label="Source document"
      >
        <header
          className="shrink-0 border-b px-5 py-3"
          style={{ borderColor: "var(--color-rule)" }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {target.observationTitle}
              </p>
              <p className="truncate text-xs" style={{ color: "var(--color-muted)" }}>
                {target.periodLabel}: {target.reportTitle}
              </p>
            </div>
            <a
              href={`/api/reports/${target.reportId}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium"
              style={{ borderColor: "var(--color-navy)", color: "var(--color-navy)" }}
            >
              Open PDF
            </a>
            <button
              onClick={onClose}
              aria-label="Close source document"
              className="shrink-0 rounded-lg border px-2.5 py-1 text-xs"
              style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-2)" }}
            >
              Close
            </button>
          </div>

          {target.quote && (
            <blockquote
              className="mt-3 rounded-lg border-l-4 px-3 py-2 text-xs leading-relaxed"
              style={{
                borderColor: "var(--color-medium)",
                background: "var(--color-paper)",
                color: "var(--color-ink-2)",
              }}
            >
              {target.quote}
            </blockquote>
          )}

          <div
            className="mt-3 flex items-center gap-3 text-xs"
            style={{ color: "var(--color-muted)" }}
          >
            {status === "ready" && doc && (
              <>
                <span>
                  Page {visiblePage} of {doc.numPages}
                </span>
                {match && (
                  <button
                    onClick={scrollToMatch}
                    className="underline"
                    style={{ color: "var(--color-navy)" }}
                  >
                    Go to highlight
                  </button>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() =>
                      setZoom((z) =>
                        Math.max(MIN_ZOOM, Math.round((z - 0.15) * 100) / 100),
                      )
                    }
                    className="rounded border px-2 py-0.5"
                    style={{ borderColor: "var(--color-rule)" }}
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <span className="w-10 text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    onClick={() =>
                      setZoom((z) =>
                        Math.min(MAX_ZOOM, Math.round((z + 0.15) * 100) / 100),
                      )
                    }
                    className="rounded border px-2 py-0.5"
                    style={{ borderColor: "var(--color-rule)" }}
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                </span>
              </>
            )}
          </div>
          {matchNote && (
            <p
              className="mt-2 text-xs"
              style={{
                color:
                  match?.kind === "exact"
                    ? "var(--color-closed-ink)"
                    : "var(--color-muted)",
              }}
            >
              {matchNote}
            </p>
          )}
        </header>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-5 py-4"
          style={{ background: "var(--color-paper)" }}
        >
          {status === "loading" && (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Loading the report…
            </p>
          )}
          {status === "error" && (
            <p className="text-sm" style={{ color: "var(--color-high-ink)" }}>
              Could not open the report: {error}
            </p>
          )}
          {status === "ready" &&
            doc &&
            pageNumbers.map((n) => (
              <PageCanvas
                key={n}
                doc={doc}
                pageNumber={n}
                scale={scale}
                boxes={boxes[n] ?? []}
                container={scrollRef}
                register={(el) => {
                  if (el) pageRefs.current.set(n, el);
                  else pageRefs.current.delete(n);
                }}
              />
            ))}
        </div>
      </aside>
    </>
  );
}

/** One page, painted only once it is near the viewport. */
function PageCanvas({
  doc,
  pageNumber,
  scale,
  boxes,
  container,
  register,
}: {
  doc: PdfDoc;
  pageNumber: number;
  scale: number;
  boxes: Box[];
  container: React.RefObject<HTMLDivElement | null>;
  register: (el: HTMLDivElement | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [near, setNear] = useState(false);

  useEffect(() => {
    let cancelled = false;
    doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        setSize({ width: viewport.width, height: viewport.height });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, scale]);

  useEffect(() => {
    const el = wrapRef.current;
    const root = container.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { root, rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [container]);

  useEffect(() => {
    if (!near || !size) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    doc
      .getPage(pageNumber)
      .then((page) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const render = page.render({
          canvasContext: context,
          viewport,
          canvas,
        });
        task = render;
        render.promise.catch(() => {});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, scale, near, size]);

  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        register(el);
      }}
      className="relative mx-auto mb-4 overflow-hidden rounded-lg border shadow-sm"
      style={{
        width: size?.width ?? "100%",
        height: size?.height ?? 480,
        background: "#fff",
        borderColor: "var(--color-rule)",
      }}
    >
      <canvas ref={canvasRef} className="block" />
      {boxes.map((box, i) => (
        <mark
          key={i}
          className="source-highlight pointer-events-none absolute rounded-[2px]"
          style={{
            left: box.left * scale,
            top: box.top * scale,
            width: box.width * scale,
            height: box.height * scale,
            background: "rgba(227, 160, 25, 0.38)",
            boxShadow: "0 0 0 1.5px rgba(207, 58, 53, 0.7)",
            mixBlendMode: "multiply",
          }}
        />
      ))}
      <span
        className="absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{ background: "rgba(23,31,45,0.6)", color: "#fff" }}
      >
        {pageNumber}
      </span>
    </div>
  );
}
