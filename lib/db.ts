import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

let client: Sql | null = null;

/** Neon's HTTP driver: every query is a single fetch, so there are no connections to pool or leak. */
export function getSql(): Sql {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Paste the Neon connection string into .env.local (local) or the Vercel project settings (production)."
    );
  }
  client = neon(url);
  return client;
}

/** bytea arrives as a Buffer from the driver's type parser, or as '\x..' hex text without it. */
export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string" && value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  throw new Error("Unexpected binary column format");
}
