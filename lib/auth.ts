import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { getSql } from "./db";

export type Role = "super_admin" | "member";

export type CurrentUser = {
  id: number;
  email: string;
  name: string;
  designation: string | null;
  role: Role;
};

export const SESSION_COOKIE = "gc_session";
const SESSION_DAYS = 7;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode("development-only-session-secret-do-not-deploy");
}

/** The JWT carries only the user id and their session version; everything else is read fresh from the database. */
export async function createSessionToken(userId: number, sessionVersion: number): Promise<string> {
  return new SignJWT({ v: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  };
}

/**
 * The signed-in user, or null. A token stops working the moment the account is
 * deactivated or its password is reset, because both bump session_version.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let userId: number;
  let version: number;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    userId = Number(payload.sub);
    version = Number(payload.v);
  } catch {
    return null;
  }
  if (!Number.isInteger(userId) || !Number.isInteger(version)) return null;

  const rows = await getSql()`
    SELECT id, email, name, designation, role, active, session_version
    FROM users WHERE id = ${userId}`;
  const row = rows[0] as
    | {
        id: number;
        email: string;
        name: string;
        designation: string | null;
        role: Role;
        active: boolean;
        session_version: number;
      }
    | undefined;
  if (!row || !row.active || row.session_version !== version) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    designation: row.designation,
    role: row.role,
  };
});

/** For pages: the signed-in user, or a redirect to the login screen. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages only super admins may open. */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "super_admin") redirect("/");
  return user;
}

export function maxUsers(): number {
  const n = Number(process.env.MAX_USERS);
  return Number.isInteger(n) && n > 0 ? n : 5;
}
