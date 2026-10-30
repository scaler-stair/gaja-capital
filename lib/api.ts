import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "./auth";

type Guard = { user: CurrentUser; error?: undefined } | { user?: undefined; error: NextResponse };

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Rejects state-changing requests that come from another site. Session cookies are
 * SameSite=Lax already; this is the second lock on the same door.
 */
export function crossSite(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.get("host");
  } catch {
    return true;
  }
}

/** Route-handler guard: signed in, same-site, and a super admin when `superAdmin` is set. */
export async function authorize(req: Request, opts: { superAdmin?: boolean } = {}): Promise<Guard> {
  if (crossSite(req)) return { error: jsonError("Cross-site request blocked", 403) };
  const user = await getCurrentUser();
  if (!user) return { error: jsonError("Your session has ended. Sign in again.", 401) };
  if (opts.superAdmin && user.role !== "super_admin") {
    return { error: jsonError("Only the super admin can do this", 403) };
  }
  return { user };
}

export function parseId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}
