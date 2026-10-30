import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { authorize, jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/passwords";

/** Change your own password. Other sessions are signed out; this one continues. */
export async function POST(req: Request) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { currentPassword?: unknown; newPassword?: unknown };
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  const problem = passwordProblem(next);
  if (problem) return jsonError(problem, 400);
  if (next === current) return jsonError("Choose a password different from the current one", 400);

  const sql = getSql();
  const rows = await sql`SELECT password_hash FROM users WHERE id = ${auth.user.id}`;
  if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash as string))) {
    return jsonError("Current password is incorrect", 400);
  }
  const updated = await sql`
    UPDATE users SET password_hash = ${await hashPassword(next)}, session_version = session_version + 1
    WHERE id = ${auth.user.id} RETURNING session_version`;
  await logActivity(auth.user.id, "Changed password");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    await createSessionToken(auth.user.id, updated[0].session_version as number),
    sessionCookieOptions()
  );
  return res;
}
