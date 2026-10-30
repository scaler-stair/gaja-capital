"use client";

import { isValidElement } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { AnswerChart, parseChartSpec } from "@/components/charts";
import type { Citation } from "@/lib/types";

const CITE = /\[\[(R\d+:[^\]\s]+)\]\]/g;

/** [[R12:FR-1]] becomes a link the renderer turns into a source chip. Unknown keys fall back to their ref. */
function linkCitations(text: string, citations: Record<string, Citation>): string {
  return text.replace(CITE, (_, key: string) =>
    citations[key] ? ` [${key}](cite:${encodeURIComponent(key)})` : key.split(":").slice(1).join(":")
  );
}

export function Answer({
  text,
  citations,
  onCite,
  streaming = false,
}: {
  text: string;
  citations: Record<string, Citation>;
  onCite: (c: Citation) => void;
  streaming?: boolean;
}) {
  return (
    <div className="answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("cite:") ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("cite:")) {
              const c = citations[decodeURIComponent(href.slice(5))];
              if (!c) return <>{children}</>;
              return (
                <button
                  type="button"
                  onClick={() => onCite(c)}
                  title={`${c.title} (${c.period}${c.page ? `, page ${c.page}` : ""})`}
                  className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded border border-rule-strong bg-surface-2 px-1.5 py-px align-middle text-[0.72rem] font-semibold text-ink-2 transition-colors hover:border-navy hover:text-ink"
                >
                  <FileText className="h-3 w-3" aria-hidden />
                  {c.ref}
                  <span className="font-normal text-muted">{c.period}</span>
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="underline">
                {children}
              </a>
            );
          },
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children;
            if (isValidElement<{ className?: string; children?: unknown }>(child) && child.props.className?.includes("language-chart")) {
              const spec = parseChartSpec(String(child.props.children ?? ""));
              if (spec) return <AnswerChart spec={spec} />;
              return streaming ? <p className="text-sm text-muted">Drawing the chart...</p> : null;
            }
            return <pre className="overflow-x-auto rounded-lg border border-rule bg-surface-2 p-3 text-xs">{children}</pre>;
          },
        }}
      >
        {linkCitations(text, citations)}
      </ReactMarkdown>
    </div>
  );
}

/** Reads the NDJSON stream from /api/chat and /api/brief. */
export async function readAnswerStream(
  res: Response,
  handlers: {
    onMeta: (citations: Record<string, Citation>) => void;
    onText: (delta: string) => void;
    onNotice: (message: string) => void;
    onError: (message: string) => void;
  }
): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    let text = "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: "meta"; citations: Record<string, Citation> }
        | { type: "text"; text: string }
        | { type: "notice"; message: string }
        | { type: "error"; message: string }
        | { type: "done" };
      if (event.type === "text") text += event.text;
      else if (event.type === "meta") handlers.onMeta(event.citations);
      else if (event.type === "notice") handlers.onNotice(event.message);
      else if (event.type === "error") handlers.onError(event.message);
    }
    // One state update per network chunk, not per token.
    if (text) handlers.onText(text);
  }
}
