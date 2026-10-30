import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { crossSite, jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { DECOY_HASH, normalizeEmail, verifyPassword } from "@/lib/passwords";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const WRONG = "Email or password is incorrect";

type Claimed = { id: number; password_hash: string; active: boolean; session_version: number; failed_attempts: number };

export async function POST(req: Request) {
  if (crossSite(req)) return jsonError("Cross-site request blocked", 403);
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return jsonError("Enter your email and password", 400);

  let sql: ReturnType<typeof getSql>;
  let user: Claimed | undefined;
  try {
    sql = getSql();
    // Count the attempt before the password is checked, in one statement, so parallel
    // requests cannot all read "not locked" and slip past the limit. A success resets it.
    const claimed = await sql`
      UPDATE users SET
        failed_attempts = CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_attempts + 1 END,
        locked_until = CASE
          WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_attempts + 1 END) >= ${MAX_FAILURES}
          THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE NULL END
      WHERE email = ${email} AND (locked_until IS NULL OR locked_until <= now())
      RETURNING id, password_hash, active, session_version, failed_attempts`;
    user = claimed[0] as Claimed | undefined;
    if (!user) {
      const locked = await sql`
        SELECT CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60)::int AS minutes_left
        FROM users WHERE email = ${email} AND locked_until > now()`;
      if (locked[0]) {
        const minutes = Math.max(1, (locked[0].minutes_left as number) ?? LOCK_MINUTES);
        return jsonError(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, 429);
      }
    }
  } catch (err) {
    console.error("Sign-in could not reach the database:", err);
    return jsonError("The dashboard cannot reach its database right now. Try again shortly.", 503);
  }

  if (!user) {
    // Same bcrypt cost as a real check, so response time does not reveal which IDs exist.
    await verifyPassword(password, DECOY_HASH);
    return jsonError(WRONG, 401);
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const nowLocked = user.failed_attempts >= MAX_FAILURES;
    await logActivity(user.id, "Failed sign-in", nowLocked ? `Locked for ${LOCK_MINUTES} minutes` : undefined);
    if (nowLocked) return jsonError(`Too many failed attempts. The account is locked for ${LOCK_MINUTES} minutes.`, 429);
    return jsonError(WRONG, 401);
  }

  if (!user.active) {
    await sql`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ${user.id}`;
    return jsonError("This account has been deactivated. Contact the administrator.", 403);
  }
  await sql`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = ${user.id}`;
  await logActivity(user.id, "Signed in");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id, user.session_version), sessionCookieOptions());
  return res;
}
