-- Gaja Capital Board Intelligence: database schema for Neon Postgres.
-- Applied by `npm run setup`. Every statement is idempotent, so re-running is safe.
-- Statements are split on semicolons at line ends, so keep one statement per block.

create table if not exists users (
  id integer generated always as identity primary key,
  email text not null unique,
  name text not null,
  designation text,
  role text not null check (role in ('super_admin', 'member')),
  password_hash text not null,
  active boolean not null default true,
  -- Bumped on password reset or deactivation, which signs the user out everywhere.
  session_version integer not null default 1,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by integer references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id integer generated always as identity primary key,
  file_name text not null,
  file_size integer not null,
  file_sha256 text not null unique,
  page_count integer,
  chunk_count integer not null,
  status text not null default 'uploading'
    check (status in ('uploading', 'queued', 'processing', 'ready', 'failed')),
  stage integer not null default 0,
  stage_label text,
  error text,
  title text,
  company text,
  auditor text,
  meeting text,
  report_label text,
  period_label text,
  quarter text,
  fiscal_year text,
  period_start date,
  period_end date,
  report_date date,
  -- Executive summary, key figures, areas, way forward, decisions, variance and prior-status updates.
  overview jsonb,
  -- Ids of the earlier reports this one was last matched against (see lib/lineage-sync.ts).
  lineage_basis text,
  model text,
  usage jsonb,
  uploaded_by integer references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

-- The original PDF, split into rows small enough for Neon's HTTP query limits.
create table if not exists report_chunks (
  report_id integer not null references reports(id) on delete cascade,
  idx integer not null,
  data bytea not null,
  primary key (report_id, idx)
);

create table if not exists observations (
  id integer generated always as identity primary key,
  report_id integer not null references reports(id) on delete cascade,
  position integer not null,
  ref text not null,
  title text not null,
  area text not null,
  rating text not null check (rating in ('High', 'Medium', 'Low')),
  status text not null check (status in ('awaiting', 'open', 'in_progress', 'closed')),
  status_text text,
  owner text,
  -- The owner field split into individual roles with consistent names, for workload charts.
  owners jsonb not null default '[]'::jsonb,
  target_date date,
  target_text text,
  summary text,
  background text,
  exceptions jsonb not null default '[]'::jsonb,
  root_causes jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  management_response text,
  impact_text text,
  impact_inr numeric,
  evidence text,
  source_page integer,
  source_quote text,
  unique (report_id, ref)
);

create index if not exists observations_report_idx on observations(report_id);

-- A later observation that repeats (continues) an earlier one.
create table if not exists observation_links (
  earlier_id integer not null references observations(id) on delete cascade,
  later_id integer not null unique references observations(id) on delete cascade,
  note text,
  primary key (earlier_id, later_id)
);

-- A later report's action-taken update on an earlier observation.
create table if not exists status_updates (
  id integer generated always as identity primary key,
  report_id integer not null references reports(id) on delete cascade,
  observation_id integer not null references observations(id) on delete cascade,
  status text not null check (status in ('awaiting', 'open', 'in_progress', 'closed')),
  status_text text,
  remarks text,
  unique (report_id, observation_id)
);

create table if not exists ai_questions (
  id integer generated always as identity primary key,
  user_id integer references users(id) on delete set null,
  kind text not null,
  question text not null,
  answer text,
  model text,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists activity (
  id integer generated always as identity primary key,
  user_id integer references users(id) on delete set null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists activity_created_idx on activity(created_at desc);
