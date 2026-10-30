"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileUp, FileText, RotateCcw } from "lucide-react";
import { PillarProgress } from "@/components/brand";
import { button } from "@/components/ui";
import { fileSize } from "@/lib/format";

const MAX_BYTES = 20 * 1024 * 1024;
const POLL_MS = 2500;

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uploading"; done: number; total: number }
  | { kind: "reading"; reportId: number; stage: number; label: string }
  | { kind: "ready"; reportId: number; period: string | null; observations: number }
  | { kind: "failed"; message: string; reportId?: number };

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Opens the PDF locally first, so a locked or damaged file is caught before it is sent. */
async function countPages(buffer: ArrayBuffer): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) });
  try {
    const doc = await task.promise;
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}

async function errorText(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error ?? fallback;
}

export function UploadPanel() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [retrying, setRetrying] = useState(false);
  const busy = phase.kind === "checking" || phase.kind === "uploading" || phase.kind === "reading";

  function pick(candidate: File | null | undefined) {
    if (!candidate || busy) return;
    if (!/\.pdf$/i.test(candidate.name) && candidate.type !== "application/pdf") {
      setPhase({ kind: "failed", message: "Only PDF files can be uploaded." });
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setPhase({ kind: "failed", message: `This PDF is ${fileSize(candidate.size)}. The limit is ${fileSize(MAX_BYTES)}.` });
      return;
    }
    setFile(candidate);
    setPages(null);
    setPhase({ kind: "idle" });
  }

  // While Claude reads the report, follow its progress.
  const readingId = phase.kind === "reading" ? phase.reportId : null;
  useEffect(() => {
    if (readingId === null) return;
    let stopped = false;
    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch(`/api/reports/${readingId}`, { cache: "no-store" });
        if (res.ok) {
          const s = (await res.json()) as { status: string; stage: number; stageLabel: string | null; error: string | null; period: string | null; observations: number };
          if (stopped) return;
          if (s.status === "ready") {
            setPhase({ kind: "ready", reportId: readingId!, period: s.period, observations: s.observations });
            setFile(null);
            router.refresh();
            return;
          }
          if (s.status === "failed") {
            setPhase({ kind: "failed", message: s.error ?? "Reading the report failed.", reportId: readingId! });
            router.refresh();
            return;
          }
          setPhase({ kind: "reading", reportId: readingId!, stage: s.stage, label: s.stageLabel ?? "Queued" });
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (!stopped) window.setTimeout(poll, POLL_MS);
    }
    const first = window.setTimeout(poll, 1200);
    return () => {
      stopped = true;
      window.clearTimeout(first);
    };
  }, [readingId, router]);

  async function upload() {
    if (!file) return;
    setPhase({ kind: "checking" });
    try {
      const buffer = await file.arrayBuffer();
      let pageCount: number;
      try {
        pageCount = await countPages(buffer);
      } catch {
        setPhase({
          kind: "failed",
          message: "This PDF could not be opened. If it is password-protected, remove the password and upload it again.",
        });
        return;
      }
      setPages(pageCount);
      const sha256 = await sha256Hex(buffer);

      const start = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileSize: file.size, sha256, pageCount }),
      });
      if (!start.ok) {
        setPhase({ kind: "failed", message: await errorText(start, "The upload could not start.") });
        return;
      }
      const { reportId, chunkBytes, chunkCount } = (await start.json()) as { reportId: number; chunkBytes: number; chunkCount: number };

      for (let part = 0; part < chunkCount; part++) {
        setPhase({ kind: "uploading", done: part, total: chunkCount });
        const body = file.slice(part * chunkBytes, Math.min(file.size, (part + 1) * chunkBytes));
        let res: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          res = await fetch(`/api/uploads/${reportId}?part=${part}`, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body,
          }).catch(() => null);
          if (res?.ok) break;
        }
        if (!res?.ok) {
          setPhase({ kind: "failed", message: res ? await errorText(res, "Part of the file did not upload.") : "The connection dropped during the upload." });
          // Remove the half-uploaded entry so the same PDF can be uploaded again straight away.
          void fetch(`/api/reports/${reportId}`, { method: "DELETE" }).catch(() => {});
          return;
        }
      }
      setPhase({ kind: "uploading", done: chunkCount, total: chunkCount });

      const done = await fetch(`/api/uploads/${reportId}/complete`, { method: "POST" });
      if (!done.ok) {
        setPhase({ kind: "failed", message: await errorText(done, "The upload could not be completed.") });
        return;
      }
      setPhase({ kind: "reading", reportId, stage: 0, label: "Queued" });
      router.refresh();
    } catch {
      setPhase({ kind: "failed", message: "The upload was interrupted. Check your connection and try again." });
    }
  }

  async function retry(reportId: number) {
    if (retrying) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/retry`, { method: "POST" });
      if (res.ok) setPhase({ kind: "reading", reportId, stage: 0, label: "Queued" });
      else setPhase({ kind: "failed", message: await errorText(res, "Could not restart reading."), reportId });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="space-y-4">
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      {phase.kind === "reading" || phase.kind === "ready" ? null : file ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-rule-strong bg-surface-2 px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-navy text-white">
            <FileText className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{file.name}</p>
            <p className="tabular text-xs text-muted">
              {fileSize(file.size)}
              {pages ? `, ${pages} pages` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className={button.secondary}>
              Choose another
            </button>
            <button type="button" onClick={upload} disabled={busy} className={button.primary}>
              <FileUp className="h-4 w-4" aria-hidden />
              {phase.kind === "checking" ? "Checking the PDF..." : phase.kind === "uploading" ? "Uploading..." : "Upload and read"}
            </button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? "border-navy bg-navy/[0.04]" : "border-rule-strong bg-surface-2 hover:border-navy/40"
          }`}
        >
          <FileUp className="h-7 w-7 text-ink-2" aria-hidden />
          <p className="mt-3 text-[0.95rem] font-medium text-ink">Drop a board or audit committee report here</p>
          <p className="mt-1 text-sm text-ink-2">or click to choose the PDF. Up to {fileSize(MAX_BYTES)}.</p>
        </div>
      )}

      {phase.kind === "uploading" && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-rule">
            <div className="h-full bg-navy transition-[width]" style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }} />
          </div>
          <p className="tabular mt-1.5 text-xs text-muted">Uploading, {Math.round((phase.done / phase.total) * 100)}%</p>
        </div>
      )}

      {phase.kind === "reading" && (
        <div className="flex items-center gap-5 rounded-xl border border-rule bg-surface-2 px-5 py-4" aria-live="polite">
          <PillarProgress stage={phase.stage} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{phase.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              The AI is reading the report: it indexes every observation, then reads each one in detail. A 30-page report
              takes about a minute or two. You can leave this page; the report appears when it is ready.
            </p>
          </div>
        </div>
      )}

      {phase.kind === "ready" && (
        <div className="flex flex-wrap items-center gap-5 rounded-xl border border-closed/30 bg-closed/[0.06] px-5 py-4" aria-live="polite">
          <PillarProgress stage={5} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              {phase.period ? `${phase.period} report is ready` : "The report is ready"}, with {phase.observations} observations.
            </p>
            <p className="mt-0.5 text-xs text-muted">Every finding links back to its page in the PDF.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPhase({ kind: "idle" })} className={button.secondary}>
              Upload another
            </button>
            <Link href={`/reports/${phase.reportId}`} className={button.primary}>
              Open the report
            </Link>
          </div>
        </div>
      )}

      {phase.kind === "failed" && (
        <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-high/[0.07] px-4 py-3 text-sm text-high-ink">
          <span className="min-w-0 flex-1">{phase.message}</span>
          {phase.reportId && (
            <button type="button" onClick={() => retry(phase.reportId!)} disabled={retrying} className={button.secondary}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Try reading again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
