"use client";

import { GajaLogo } from "@/components/brand";
import { button } from "@/components/ui";

/** Catches failures above the page level, such as the signed-in layout not reaching the database. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
      <GajaLogo />
      <div className="max-w-md">
        <h1 className="font-serif text-2xl font-medium text-ink">The dashboard could not load</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          It could not reach its database or one of its services. Try again in a moment; if it keeps happening, the
          administrator should check the DATABASE_URL and ANTHROPIC_API_KEY settings.
        </p>
        {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      </div>
      <button type="button" onClick={reset} className={button.primary}>
        Try again
      </button>
    </main>
  );
}
