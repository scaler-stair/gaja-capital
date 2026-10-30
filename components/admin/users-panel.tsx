"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { button, field } from "@/components/ui";
import { formatTimestamp } from "@/lib/format";
import type { UserRow } from "@/lib/data";

type Issued = { name: string; email: string; password: string; reason: "created" | "reset" };

function CredentialCard({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Gaja Capital Board Intelligence\nEmail: ${issued.email}\nPassword: ${issued.password}`;
  return (
    <div className="rounded-xl border border-closed/30 bg-closed/[0.06] p-5" role="status">
      <p className="font-medium text-ink">
        {issued.reason === "created" ? `Account created for ${issued.name}` : `New password for ${issued.name}`}
      </p>
      <p className="mt-1 text-sm text-ink-2">
        Share these privately. The password is shown only once; {issued.name.split(" ")[0]} can change it after signing in.
      </p>
      <dl className="tabular mt-4 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-rule bg-surface p-4 text-sm">
        <dt className="text-muted">Email</dt>
        <dd className="font-semibold text-ink">{issued.email}</dd>
        <dt className="text-muted">Password</dt>
        <dd className="font-semibold tracking-wide text-ink">{issued.password}</dd>
      </dl>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
          className={button.secondary}
        >
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy details"}
        </button>
        <button type="button" onClick={onDone} className={button.quiet}>
          Done
        </button>
      </div>
    </div>
  );
}

export function UsersPanel({ users, maxUsers, currentUserId }: { users: UserRow[]; maxUsers: number; currentUserId: number }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", designation: "", role: "member", password: "" });
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const seatsLeft = maxUsers - users.length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; email?: string; password?: string };
    setAdding(false);
    if (!res.ok) {
      setError(data.error ?? "Could not create the user");
      return;
    }
    setIssued({ name: form.name, email: data.email!, password: data.password!, reason: "created" });
    setForm({ name: "", email: "", designation: "", role: "member", password: "" });
    router.refresh();
  }

  async function act(user: UserRow, action: string, extra: Record<string, unknown> = {}) {
    const confirmText: Record<string, string> = {
      reset_password: `Issue a new password for ${user.name}? Their current password stops working and they are signed out.`,
      deactivate: `Deactivate ${user.name}? They are signed out at once and cannot sign in until reactivated.`,
      remove: `Remove ${user.name}'s account permanently? This frees up one of the user places.`,
      set_role:
        extra.role === "super_admin"
          ? `Make ${user.name} a super admin? They will be able to upload reports and manage access.`
          : `Make ${user.name} a member? They will keep read and AI access only.`,
    };
    if (confirmText[action] && !window.confirm(confirmText[action])) return;
    setBusyId(user.id);
    setError("");
    const res =
      action === "remove"
        ? await fetch(`/api/users/${user.id}`, { method: "DELETE" })
        : await fetch(`/api/users/${user.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...extra }),
          });
    const data = (await res.json().catch(() => ({}))) as { error?: string; password?: string; signedOut?: boolean };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "That change did not go through");
      return;
    }
    if (action === "reset_password" && data.password) {
      if (data.signedOut) {
        window.alert(`Your new password is ${data.password}. You will now be signed out; sign in again with it.`);
        router.push("/login");
        return;
      }
      setIssued({ name: user.name, email: user.email, password: data.password, reason: "reset" });
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {issued && <CredentialCard issued={issued} onDone={() => setIssued(null)} />}
      {error && (
        <p role="alert" className="rounded-lg bg-high/10 px-3 py-2 text-sm text-high-ink">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-3 py-3 font-medium">Email</th>
              <th className="px-3 py-3 font-medium">Access</th>
              <th className="px-3 py-3 font-medium">Last sign-in</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === currentUserId;
              const busy = busyId === u.id;
              return (
                <tr key={u.id} className="border-b border-rule align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">
                      {u.name}
                      {self && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
                    </div>
                    {u.designation && <div className="text-xs text-muted">{u.designation}</div>}
                  </td>
                  <td className="px-3 py-3 text-ink-2">{u.email}</td>
                  <td className="px-3 py-3">
                    <div className="text-ink">{u.role === "super_admin" ? "Super admin" : "Member"}</div>
                    <div className={`text-xs ${!u.active || u.locked ? "text-high-ink" : "text-muted"}`}>
                      {!u.active ? "Deactivated" : u.locked ? "Locked after failed sign-ins" : "Active"}
                    </div>
                  </td>
                  <td className="tabular px-3 py-3 text-ink-2">{u.last_login_at ? formatTimestamp(u.last_login_at) : "Never"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button type="button" disabled={busy} onClick={() => act(u, "reset_password")} className={button.quiet}>
                        {u.locked ? "Unlock and reset password" : "Reset password"}
                      </button>
                      {!self && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(u, "set_role", { role: u.role === "super_admin" ? "member" : "super_admin" })}
                            className={button.quiet}
                          >
                            {u.role === "super_admin" ? "Make member" : "Make super admin"}
                          </button>
                          <button type="button" disabled={busy} onClick={() => act(u, u.active ? "deactivate" : "activate")} className={button.quiet}>
                            {u.active ? "Deactivate" : "Reactivate"}
                          </button>
                          <button type="button" disabled={busy} onClick={() => act(u, "remove")} className={button.danger}>
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {seatsLeft > 0 ? (
        <form onSubmit={add} className="rounded-xl border border-rule bg-surface p-5">
          <h3 className="font-medium text-ink">Add a user</h3>
          <p className="mt-0.5 text-sm text-muted">
            {seatsLeft} of {maxUsers} places left. Set a password, or leave it blank to have one generated. Either way it is shown
            once for you to pass on.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-sm text-ink">Full name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-ink">Email</span>
              <input
                type="email"
                inputMode="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={field}
                placeholder="name@gajacapital.com"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-ink">
                Password <span className="text-muted">(optional)</span>
              </span>
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={field}
                placeholder="Leave blank to generate one"
                autoComplete="new-password"
                spellCheck={false}
              />
              <span className="mt-1 block text-xs text-muted">At least 10 characters, with letters and numbers.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-ink">
                Designation <span className="text-muted">(optional)</span>
              </span>
              <input
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
                className={field}
                placeholder="e.g. Chair, Audit Committee"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-ink">Access</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={field}>
                <option value="member">Member</option>
                <option value="super_admin">Super admin</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">
            Members can read every report and use the AI assistant. Super admins can also upload reports and manage users.
          </p>
          <button type="submit" disabled={adding || !form.name.trim() || !form.email.trim()} className={`${button.primary} mt-4`}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {adding ? "Creating..." : "Create user"}
          </button>
        </form>
      ) : (
        <p className="rounded-xl border border-dashed border-rule-strong bg-surface px-5 py-4 text-sm text-ink-2">
          All {maxUsers} user accounts are in use. Remove one to add someone new.
        </p>
      )}
    </div>
  );
}
