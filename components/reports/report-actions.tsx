"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RotateCcw, Trash } from "lucide-react";
import { PillarProgress } from "@/components/brand";
import { button } from "@/components/ui";

/** Follows a report that is still being read and refreshes the page once it is done. */
export function ProcessingStatus({ reportId, stage, label }: { reportId: number; stage: number; label: string | null }) {
  const router = useRouter();
  const [state, setState] = useState({ stage, label });

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    async function poll() {
      try {
        const res = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
        if (res.ok) {
          const s = (await res.json()) as { status: string; stage: number; stageLabel: string | null };
          if (stopped) return;
          if (s.status === "ready" || s.status === "failed") {
            router.refresh();
            return;
          }
          setState({ stage: s.stage, label: s.stageLabel });
        }
      } catch {
        // Try again on the next tick.
      }
      if (!stopped) timer = window.setTimeout(poll, 3000);
    }
    timer = window.setTimeout(poll, 3000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [reportId, router]);

  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <PillarProgress stage={state.stage} size="sm" />
      <span className="text-sm text-ink-2">{state.label ?? "Queued"}</span>
    </div>
  );
}

export function RetryButton({ reportId, label = "Read again" }: { reportId: number; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function retry() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/reports/${reportId}/retry`, { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not restart");
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={retry} disabled={busy} className={button.secondary}>
        <RotateCcw className="h-4 w-4" aria-hidden />
        {busy ? "Starting..." : label}
      </button>
      {error && <span className="text-xs text-high-ink">{error}</span>}
    </span>
  );
}

export function DeleteReportButton({ reportId, name, after = "refresh" }: { reportId: number; name: string; after?: "refresh" | "list" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm(`Delete ${name} and every observation read from it? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      window.alert(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Delete failed");
      return;
    }
    if (after === "list") router.push("/reports");
    router.refresh();
  }
  return (
    <button type="button" onClick={remove} disabled={busy} className={button.danger}>
      <Trash className="h-4 w-4" aria-hidden />
      {busy ? "Deleting..." : "Delete"}
    </button>
  );
}
