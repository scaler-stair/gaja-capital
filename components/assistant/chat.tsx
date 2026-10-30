"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, CircleStop, Copy, RotateCcw } from "lucide-react";
import { PillarLoader } from "@/components/brand";
import { button } from "@/components/ui";
import { SourceViewer, type SourceTarget } from "@/components/observations/source-viewer";
import { Answer, readAnswerStream } from "./answer";
import type { Citation } from "@/lib/types";

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Record<string, Citation>;
  notice?: string;
  error?: string;
};

const STORE = "gc-assistant-v1";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text.replace(/\[\[R\d+:([^\]\s]+)\]\]/g, "$1"));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className={button.quiet}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function Chat({
  reports,
  initialScope,
  suggestions,
}: {
  reports: Array<{ id: number; period: string; title: string }>;
  initialScope: string;
  suggestions: string[];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [scope, setScope] = useState(initialScope);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<SourceTarget | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  // Keep the conversation for this browser tab, so moving between pages does not lose it.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as { messages?: Message[] } | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from sessionStorage after hydration
      if (saved?.messages?.length) setMessages(saved.messages);
    } catch {
      // Storage unavailable (private mode); start fresh.
    }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current || busy) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ messages: messages.slice(-30) }));
    } catch {
      // Ignore quota or privacy-mode failures.
    }
  }, [messages, busy]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  function updateLast(patch: (m: Message) => Message) {
    setMessages((list) => (list.length === 0 ? list : [...list.slice(0, -1), patch(list[list.length - 1])]));
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history: Message[] = [...messages.filter((m) => !m.error || m.content), { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          reportIds: scope === "all" ? [] : [Number(scope)],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        updateLast((m) => ({ ...m, error: data.error ?? "The assistant could not answer. Try again." }));
        return;
      }
      await readAnswerStream(res, {
        onMeta: (citations) => updateLast((m) => ({ ...m, citations })),
        onText: (delta) => updateLast((m) => ({ ...m, content: m.content + delta })),
        onNotice: (notice) => updateLast((m) => ({ ...m, notice })),
        onError: (error) => updateLast((m) => ({ ...m, error })),
      });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") updateLast((m) => ({ ...m, notice: "Stopped." }));
      else updateLast((m) => ({ ...m, error: "The connection dropped. Try again." }));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  function cite(c: Citation) {
    setSource({
      observationId: c.observationId,
      observationTitle: `${c.ref}: ${c.title}`,
      reportId: c.reportId,
      reportTitle: c.reportTitle,
      periodLabel: c.period,
      quote: c.quote,
      page: c.page,
      searchText: c.searchText,
    });
  }

  const scopeLabel = scope === "all" ? "all board reports" : reports.find((r) => String(r.id) === scope)?.period ?? "the selected report";

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Answer from
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-lg border border-rule-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
          >
            <option value="all">All board reports</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.period} only
              </option>
            ))}
          </select>
        </label>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              abort.current?.abort();
              setMessages([]);
            }}
            className={button.quiet}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            New conversation
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <section className="rounded-xl border border-rule bg-surface p-6">
          <h2 className="font-serif text-xl font-medium text-ink">What would you like to know?</h2>
          <p className="mt-1 text-sm text-ink-2">
            Answers come only from the reports on this dashboard, with each finding linked to the page it was read from.
          </p>
          <ul className="mt-5 divide-y divide-rule border-y border-rule">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => ask(s)}
                  className="flex w-full items-center justify-between gap-4 py-3 text-left text-sm text-ink transition-colors hover:text-navy-3"
                >
                  {s}
                  <ArrowUp className="h-4 w-4 shrink-0 rotate-45 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-6">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-navy px-4 py-2.5 text-[0.95rem] text-white">
                {m.content}
              </p>
            </div>
          ) : (
            <article key={i} className="rounded-xl border border-rule bg-surface px-5 py-4">
              {m.content ? (
                <Answer text={m.content} citations={m.citations ?? {}} onCite={cite} streaming={busy && i === messages.length - 1} />
              ) : (
                !m.error && <PillarLoader label={`Reading ${scopeLabel}...`} />
              )}
              {m.notice && <p className="mt-3 text-xs text-muted">{m.notice}</p>}
              {m.error && <p className="mt-1 text-sm text-high-ink">{m.error}</p>}
              {m.content && !(busy && i === messages.length - 1) && (
                <div className="no-print mt-3 flex justify-end border-t border-rule pt-2">
                  <CopyButton text={m.content} />
                </div>
              )}
            </article>
          )
        )}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="no-print sticky bottom-0 mt-6 bg-paper pb-4 pt-2"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-rule-strong bg-surface p-2 shadow-sm focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/20">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={Math.min(5, Math.max(1, input.split("\n").length))}
            placeholder="Ask about findings, owners, deadlines or what changed"
            aria-label="Your question"
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-3 py-2 text-[0.95rem] text-ink placeholder:text-muted focus:outline-none"
          />
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} className={`${button.secondary} h-10`} aria-label="Stop the answer">
              <CircleStop className="h-4 w-4" aria-hidden />
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className={`${button.primary} h-10 w-10 px-0`} aria-label="Send">
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-xs text-muted">AI answers can be wrong. Check important figures against the source page.</p>
      </form>

      <SourceViewer target={source} onClose={() => setSource(null)} />
    </div>
  );
}
