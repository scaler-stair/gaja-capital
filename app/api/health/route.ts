import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/client";

/** For uptime monitors: is the database reachable and is the AI key set. Reveals no data. */
export async function GET() {
  let database = false;
  try {
    await getSql()`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const ai = aiConfigured();
  return NextResponse.json(
    { ok: database && ai, database, ai },
    { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
