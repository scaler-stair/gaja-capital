import "server-only";
import { getSql } from "./db";

/** Audit trail of sign-ins, uploads and account changes. Never blocks the action it records. */
export async function logActivity(userId: number | null, action: string, detail?: string): Promise<void> {
  try {
    await getSql()`
      INSERT INTO activity (user_id, action, detail) VALUES (${userId}, ${action}, ${detail ?? null})`;
  } catch (err) {
    console.error("Activity log write failed:", err);
  }
}
