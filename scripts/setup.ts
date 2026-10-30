// One-time setup: applies db/schema.sql to Neon and creates the first super admin.
// Usage: npm run setup   (reads DATABASE_URL and SUPERADMIN_* from .env.local)
// Safe to re-run: the schema is idempotent and an existing super admin is left untouched.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import {
  generatePassword,
  hashPassword,
  emailProblem,
  normalizeEmail,
  passwordProblem,
} from "../lib/passwords";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing. Paste the Neon connection string into .env.local first.");
  const sql = neon(url);

  console.log("Applying schema...");
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  const statements = schema
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
  for (const statement of statements) await sql.query(statement);
  console.log(`  ${statements.length} statements applied.`);

  const email = normalizeEmail(process.env.SUPERADMIN_EMAIL || "superadmin@gajacapital.com");
  const name = (process.env.SUPERADMIN_NAME || "Super Admin").trim();
  const badEmail = emailProblem(email);
  if (badEmail) throw new Error(`SUPERADMIN_EMAIL: ${badEmail}`);

  const existing = await sql`SELECT id, role FROM users WHERE email = ${email}`;
  if (existing.length > 0) {
    console.log(`Super admin "${email}" already exists; password unchanged.`);
  } else {
    let password = process.env.SUPERADMIN_PASSWORD || "";
    const generated = !password;
    if (generated) password = `${generatePassword()}-${generatePassword().slice(0, 4)}`;
    const badPassword = passwordProblem(password);
    if (badPassword) throw new Error(`SUPERADMIN_PASSWORD: ${badPassword}`);
    await sql`
      INSERT INTO users (email, name, role, password_hash)
      VALUES (${email}, ${name}, 'super_admin', ${await hashPassword(password)})`;
    console.log(`Super admin created. Sign in with: ${email}`);
    if (generated) {
      console.log(`Generated password (shown once, store it safely): ${password}`);
    }
  }

  const [{ n }] = (await sql`SELECT COUNT(*)::int AS n FROM users`) as Array<{ n: number }>;
  console.log(`Users on file: ${n} of ${process.env.MAX_USERS || 5} allowed.`);
  console.log("Setup complete. Start the app with: npm run dev");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
