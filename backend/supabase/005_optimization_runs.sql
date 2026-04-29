-- Append-only log of schedule optimization API calls (PII-minimized).
-- Run after 001_student_profiles.sql (uses auth.users FK).
-- Service role inserts from FastAPI; authenticated users SELECT own rows via RLS.

create table if not exists public.optimization_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_hash text not null,
  quarter_code text not null,
  model_version text not null,
  conformal_method text not null default 'unknown',
  summary jsonb not null default '{}'::jsonb,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists optimization_runs_user_created_idx
  on public.optimization_runs (user_id, created_at desc);

alter table public.optimization_runs enable row level security;

-- Users read only their runs (no updates / deletes).
create policy "optimization_runs_select_own"
  on public.optimization_runs for select
  using (auth.uid() = user_id);

-- Inserts from PostgREST as the logged-in user (optional path).
create policy "optimization_runs_insert_own"
  on public.optimization_runs for insert
  with check (auth.uid() = user_id);

comment on table public.optimization_runs is
  'Append-only optimization API audit trail. Backend may also insert via service role (bypasses RLS).';
