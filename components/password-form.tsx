"use client";

import { useState } from "react";
import { button, field } from "@/components/ui";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setMessage({ ok: false, text: "The new passwords do not match" });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (res.ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ ok: true, text: "Password changed." });
    } else {
      setMessage({ ok: false, text: data.error ?? "The password was not changed" });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm text-ink">Current password</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} required />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm text-ink">New password</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={field} required />
        <span className="mt-1 block text-xs text-muted">At least 10 characters, with letters and numbers.</span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm text-ink">New password again</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} required />
      </label>
      {message && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-closed/10 text-closed-ink" : "bg-high/10 text-high-ink"}`}>
          {message.text}
        </p>
      )}
      <button type="submit" disabled={busy || !current || !next || !confirm} className={button.primary}>
        {busy ? "Saving..." : "Change password"}
      </button>
    </form>
  );
}
