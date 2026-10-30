import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { authorize, jsonError, parseId } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { generatePassword, hashPassword } from "@/lib/passwords";

type Target = { id: number; email: string; role: string; active: boolean };

async function loadTarget(id: number): Promise<Target | null> {
  const rows = await getSql()`SELECT id, email, role, active FROM users WHERE id = ${id}`;
  return (rows[0] as Target) ?? null;
}

/** True when `target` is the only active super admin left, so it must stay that way. */
async function isLastSuperAdmin(target: Target): Promise<boolean> {
  if (target.role !== "super_admin" || !target.active) return false;
  const rows = await getSql()`
    SELECT COUNT(*)::int AS n FROM users WHERE role = 'super_admin' AND active AND id <> ${target.id}`;
  return (rows[0].n as number) === 0;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  const id = parseId((await ctx.params).id);
  const target = id ? await loadTarget(id) : null;
  if (!target) return jsonError("User not found", 404);
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; role?: unknown; name?: unknown; designation?: unknown };
  const sql = getSql();
  const self = target.id === auth.user.id;

  switch (body.action) {
    case "reset_password": {
      const password = generatePassword();
      await sql`
        UPDATE users SET password_hash = ${await hashPassword(password)}, session_version = session_version + 1,
                         failed_attempts = 0, locked_until = NULL
        WHERE id = ${target.id}`;
      await logActivity(auth.user.id, "Reset password", target.email);
      return NextResponse.json({ ok: true, password, signedOut: self });
    }
    case "deactivate": {
      if (self) return jsonError("You cannot deactivate your own account", 400);
      if (await isLastSuperAdmin(target)) return jsonError("Keep at least one active super admin", 400);
      await sql`UPDATE users SET active = false, session_version = session_version + 1 WHERE id = ${target.id}`;
      await logActivity(auth.user.id, "Deactivated user", target.email);
      return NextResponse.json({ ok: true });
    }
    case "activate": {
      await sql`UPDATE users SET active = true, failed_attempts = 0, locked_until = NULL WHERE id = ${target.id}`;
      await logActivity(auth.user.id, "Reactivated user", target.email);
      return NextResponse.json({ ok: true });
    }
    case "set_role": {
      const role = body.role === "super_admin" ? "super_admin" : body.role === "member" ? "member" : null;
      if (!role) return jsonError("Unknown role", 400);
      if (self) return jsonError("You cannot change your own role", 400);
      if (role === "member" && (await isLastSuperAdmin(target))) return jsonError("Keep at least one active super admin", 400);
      await sql`UPDATE users SET role = ${role}, session_version = session_version + 1 WHERE id = ${target.id}`;
      await logActivity(auth.user.id, "Changed role", `${target.email} to ${role === "super_admin" ? "super admin" : "member"}`);
      return NextResponse.json({ ok: true });
    }
    case "update": {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const designation = typeof body.designation === "string" && body.designation.trim() ? body.designation.trim() : null;
      if (name.length < 2 || name.length > 80) return jsonError("Enter the person's full name", 400);
      await sql`UPDATE users SET name = ${name}, designation = ${designation} WHERE id = ${target.id}`;
      await logActivity(auth.user.id, "Updated profile", target.email);
      return NextResponse.json({ ok: true });
    }
    default:
      return jsonError("Unknown action", 400);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  const id = parseId((await ctx.params).id);
  const target = id ? await loadTarget(id) : null;
  if (!target) return jsonError("User not found", 404);
  if (target.id === auth.user.id) return jsonError("You cannot remove your own account", 400);
  if (await isLastSuperAdmin(target)) return jsonError("Keep at least one active super admin", 400);
  await getSql()`DELETE FROM users WHERE id = ${target.id}`;
  await logActivity(auth.user.id, "Removed user", target.email);
  return NextResponse.json({ ok: true });
}
