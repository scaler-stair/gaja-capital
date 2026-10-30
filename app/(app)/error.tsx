"use client";

import { button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-xl space-y-4 rounded-xl border border-rule bg-surface p-8">
      <h1 className="font-serif text-2xl font-medium text-ink">This page could not load</h1>
      <p className="text-sm leading-relaxed text-ink-2">
        The dashboard could not reach its database or one of its services. Try again in a moment; if it keeps happening, the
        administrator should check the DATABASE_URL and ANTHROPIC_API_KEY settings.
      </p>
      {error.digest && <p className="text-xs text-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className={button.primary}>
        Try again
      </button>
    </div>
  );
}
