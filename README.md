# Gaja Capital Board Intelligence

A private dashboard for Gaja Capital's Board and Audit Committee. The super admin uploads each board or audit committee report (PDF). Claude reads it and turns it into a live dashboard: every observation with its rating, owner, target date and source page, the executive summary, key figures, next steps and the asks of the Committee. Reports are linked across meetings, so the board can see what is new, repeated, escalated or closed, and an AI assistant answers questions from the reports with links back to the page each finding came from.

## What it does

- **Email and password sign-in.** Up to 5 user accounts (configurable), starting with `superadmin@gajacapital.com`. Super admins upload reports and manage access; members read everything and use the AI assistant. Accounts lock for 15 minutes after 5 failed attempts, and deactivating a user or resetting a password signs them out everywhere.
- **Report upload.** Drag in a PDF (up to 20 MB). It is checked in the browser, uploaded in 2 MB parts, stored in Neon, and read by Claude in the background (about a minute for a 30-page deck) while a progress indicator (the five Gaja pillars) fills.
- **One report.** Headline, key figures, executive summary, findings by area and by owner, what falls due, the full observation register with filters, way forward, asks of the Committee, period-on-period movement and audit scope. Every chart is clickable and every observation opens its full write-up and the highlighted passage in the original PDF.
- **Several reports.** Compare and compile: observations per meeting, findings by area and meeting, what changed between meetings, an issue-by-meeting tracker, and a consolidated board brief written by the AI (printable).
- **AI assistant.** Plain-English questions answered only from the uploaded reports, with charts when useful and citation chips that open the source page. Counts come from precomputed statistics, not the model's arithmetic.
- **Exports and audit trail.** Excel (CSV) export of the register; sign-ins, uploads and access changes are logged on the admin page.

## Stack

Next.js 16 (App Router) on Vercel, Neon Postgres (data and the PDFs themselves), the Anthropic API with Claude Sonnet 5.5, pdf.js for the in-app viewer, Recharts for charts. No other services are needed.

## Run it locally

1. Install dependencies: `npm install`
2. Fill in `.env.local` (copy `.env.example` if it does not exist):
   - `ANTHROPIC_API_KEY`: from console.anthropic.com
   - `DATABASE_URL`: the Neon connection string (Neon console, Connect)
   - `SESSION_SECRET`: any random string of 32+ characters (`openssl rand -hex 32`)
   - `SUPERADMIN_EMAIL` (default `superadmin@gajacapital.com`), `SUPERADMIN_NAME`, `SUPERADMIN_PASSWORD`: the first super admin. Leave the password empty to have one generated.
3. Create the tables and the super admin: `npm run setup` (safe to re-run; it never changes an existing password)
4. Start: `npm run dev` and open http://localhost:3000

## Deploy to Vercel

1. Push this folder to a Git repository and import it at vercel.com/new (or run `npx vercel` here). If the repository contains more than this folder, set the project's Root Directory to `gaja-dashboard`.
2. In the Vercel project, Settings, Environment Variables, add `ANTHROPIC_API_KEY`, `DATABASE_URL`, `SESSION_SECRET` and `MAX_USERS`. The `SUPERADMIN_*` values are only needed where you run `npm run setup`.
3. Deploy. To use your own domain, add it under Settings, Domains and point the DNS record Vercel shows you at it.
4. Run `npm run setup` once from your machine against the same `DATABASE_URL`, then sign in as the super admin.

For speed, keep the database and the app in the same region: create the Neon project in AWS Asia Pacific (Mumbai) and set the Vercel function region to Mumbai (`bom1`) under Settings, Functions.

Reading a report runs in the background inside the upload request's time limit, set to 300 seconds (the Vercel Hobby maximum). The 28-page Q2 FY27 report took 64 seconds in testing. On Vercel Pro you can raise `maxDuration` in `app/api/uploads/[id]/complete/route.ts` and `app/api/reports/[id]/retry/route.ts` to 800 for very long reports.

## First steps after deploying

1. Sign in as `superadmin@gajacapital.com` with the password setup printed (change it under Password).
2. Board reports: upload the latest board or audit committee report and wait for the five pillars to fill.
3. Users and access: add each person by name and email. Set their password or leave it blank to generate one; it is shown once to pass on privately, and they can change it under Password.
4. Open the report, then try the AI assistant and, once a second report is in, Compare and compile.

## How a report is read

1. **Reading the document**: the PDF is reassembled from Neon and its checksum verified.
2. **Indexing the observations**: Claude reads the whole PDF and returns the report's details (title, period, meeting, auditor) and an index of every observation with its rating, area, owner, target date and status.
3. **Reading each finding in detail**: in parallel, Claude reads each batch of observations for background, exceptions, root causes, recommendations, management response, amount involved, page and a verbatim quote, and reads the overview sections (headline, executive summary, key figures, areas, way forward, asks of the Committee, variance analysis, status updates on earlier observations). These are separate calls because a single structured-output schema for everything is larger than the API accepts.
4. **Linking with earlier reports**: Claude matches the new observations against the open issues from earlier reports (repeats, and action-taken updates), with a cautious text-similarity fallback.
5. **Ready**.

If a step fails, the report shows the reason and the super admin can retry. If detail could not be read for some observations, they still appear with their tracker-level fields and the report page offers "Read again".

Rough Anthropic cost on Sonnet 5.5: about US$1 to read a 30-page report, and a few US cents per assistant question. Use is summarised on the admin page.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Report reading, assistant and briefs |
| `DATABASE_URL` | (required) | Neon Postgres connection string |
| `SESSION_SECRET` | (required in production) | Signs login sessions |
| `MAX_USERS` | `5` | Total user accounts, super admins included |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model for all AI calls |
| `EXTRACTION_EFFORT` | `medium` | Effort for reading reports (`low` to `max`) |
| `CHAT_EFFORT` | `medium` | Effort for assistant answers and briefs |

AI requests opt into Anthropic's server-side fallback (`fallbacks: "default"`), so a request the model declines for a policy reason is retried on Anthropic's recommended fallback model instead of failing.

## Branding

The Gaja Capital mark (five red pillars, `#DF2A2F`) and navy (`#171F2D`) are drawn in code from the logo artwork, in `components/brand.tsx`, with colour tokens at the top of `app/globals.css`. To use an official logo file instead, put it in `public/brand/` and set `logoSrc` in `lib/brand.ts`.

## Security notes

- Every page and API route checks the session on the server; the session token holds only the user id and a version that is checked against the database on every request.
- Passwords are bcrypt-hashed; temporary passwords are generated server-side and shown once.
- State-changing requests from other sites are rejected (SameSite cookies plus an Origin check).
- PDFs are served only to signed-in users, with private caching; pages send `noindex` and anti-framing headers.
- AI answers are grounded in the stored report data and link to their source pages. They can still be wrong: the interface says so, and figures should be checked against the PDF before decisions.

## Project layout

- `app/` pages and API routes (`app/(app)` is the signed-in area)
- `components/` UI, charts, the observation register and PDF viewer, the assistant, the compile view
- `lib/` database access, auth, the processing pipeline, lineage across reports, and `lib/ai/` for every Claude call and prompt
- `db/schema.sql` the database schema, applied by `npm run setup`
