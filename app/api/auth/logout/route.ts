import { NextResponse } from "next/server";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { crossSite, jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";

export async function POST(req: Request) {
  if (crossSite(req)) return jsonError("Cross-site request blocked", 403);
  const user = await getCurrentUser();
  if (user) await logActivity(user.id, "Signed out");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
