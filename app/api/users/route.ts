import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { maxUsers } from "@/lib/auth";
import { authorize, jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { listUsers } from "@/lib/data";
import { emailProblem, generatePassword, hashPassword, normalizeEmail, passwordProblem } from "@/lib/passwords";

export async function GET(req: Request) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  return NextResponse.json({ users: await listUsers(), maxUsers: maxUsers() });
}

/**
 * Creates a user who signs in with their email. The super admin may set the password;
 * if not, one is generated. Either way it is returned once for the admin to pass on.
 */
export async function POST(req: Request) {
  const auth = await authorize(req, { superAdmin: true });
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    email?: unknown;
    designation?: unknown;
    role?: unknown;
    password?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const designation = typeof body.designation === "string" && body.designation.trim() ? body.designation.trim() : null;
  const role = body.role === "super_admin" ? "super_admin" : "member";
  const chosen = typeof body.password === "string" ? body.password : "";
  if (name.length < 2 || name.length > 80) return jsonError("Enter the person's full name", 400);
  const badEmail = emailProblem(email);
  if (badEmail) return jsonError(badEmail, 400);
  if (designation && designation.length > 80) return jsonError("Designation is too long", 400);
  if (chosen) {
    const badPassword = passwordProblem(chosen);
    if (badPassword) return jsonError(badPassword, 400);
  }

  const sql = getSql();
  const limit = maxUsers();
  const [{ n }] = (await sql`SELECT COUNT(*)::int AS n FROM users`) as Array<{ n: number }>;
  if (n >= limit) {
    return jsonError(`All ${limit} user accounts are in use. Remove one before adding another.`, 409);
  }
  const password = chosen || generatePassword();
  try {
    await sql`
      INSERT INTO users (email, name, designation, role, password_hash, created_by)
      VALUES (${email}, ${name}, ${designation}, ${role}, ${await hashPassword(password)}, ${auth.user.id})`;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return jsonError("A user with that email already exists", 409);
    throw err;
  }
  await logActivity(auth.user.id, "Created user", `${email} (${role === "super_admin" ? "super admin" : "member"})`);
  return NextResponse.json({ ok: true, email, password });
}
