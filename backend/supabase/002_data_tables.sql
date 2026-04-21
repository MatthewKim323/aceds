-- ============================================================================
-- ACE data tables migration 002
-- Public-read catalog + history + requirements, user-scoped schedules.
-- Run after 001_student_profiles.sql.
-- ============================================================================

-- ---- helpers ----------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---- courses ----------------------------------------------------------------
-- One row per normalized (dept, course_id). Canonical metadata.
create table if not exists public.courses (
  course_norm text primary key,                -- e.g. "CMPSC 130A"
  dept        text not null,                    -- e.g. "CMPSC"
  course_id   text not null,                    -- e.g. "130A"
  title       text,
  description text,
  units_fixed numeric,
  ge_raw      text,                             -- raw GE string from catalog
  ge_areas    text[],                           -- parsed: {A1, D, E, ...}
  level       text check (level in ('lower','upper','grad')),
  updated_at  timestamptz not null default now()
);
create index if not exists courses_dept_idx on public.courses (dept);
create index if not exists courses_level_idx on public.courses (level);
create index if not exists courses_ge_idx on public.courses using gin (ge_areas);
drop trigger if exists courses_touch on public.courses;
create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();

-- ---- professors -------------------------------------------------------------
create table if not exists public.professors (
  instructor_norm        text primary key,       -- Nexus-normalized
  display_name           text,                   -- as seen in Nexus
  rmp_legacy_id          text,
  rmp_rating             numeric,
  rmp_difficulty         numeric,
  rmp_num_ratings        integer,
  rmp_would_take_again   numeric,
  rmp_department         text,
  rmp_confidence         text check (rmp_confidence in ('exact_initial','only_candidate','top_by_ratings','none')),
  updated_at             timestamptz not null default now()
);
create index if not exists professors_rmp_conf_idx on public.professors (rmp_confidence);
drop trigger if exists professors_touch on public.professors;
create trigger professors_touch before update on public.professors
  for each row execute function public.touch_updated_at();

-- ---- grade_distributions ----------------------------------------------------
-- One row per historical section (course × instructor × quarter × year).
create table if not exists public.grade_distributions (
  id                    bigserial primary key,
  course_norm           text not null references public.courses(course_norm) on delete cascade,
  instructor_norm       text not null references public.professors(instructor_norm) on delete cascade,
  quarter               text not null check (quarter in ('Winter','Spring','Summer','Fall')),
  year                  integer not null,
  n_letter              integer not null,
  avg_gpa               numeric,
  a_count               integer, b_count integer, c_count integer, d_count integer, f_count integer,
  p_count               integer, np_count integer,
  grade_breakdown_json  jsonb,                    -- full +/- breakdown for UI
  unique (course_norm, instructor_norm, quarter, year)
);
create index if not exists grade_dist_course_idx on public.grade_distributions (course_norm);
create index if not exists grade_dist_instr_idx on public.grade_distributions (instructor_norm);
create index if not exists grade_dist_time_idx on public.grade_distributions (year desc, quarter);

-- ---- sections (current quarter catalog) -------------------------------------
create table if not exists public.sections (
  enroll_code           text not null,
  quarter_code          text not null,           -- e.g. "20262"
  course_norm           text not null references public.courses(course_norm) on delete cascade,
  instructor_norm       text,
  section_label         text,                    -- "0100" or "0100D"
  days                  text,                    -- "M T W R F"
  begin_time            time,
  end_time              time,
  building              text,
  room                  text,
  max_enroll            integer,
  enrolled              integer,
  open_seats            integer,
  class_closed          text,                    -- "Y"/"N"/""
  restriction_level     text,                    -- "Undergrad", "Grad only", etc.
  restriction_major     text,
  restriction_comments  text,
  raw_json              jsonb,                   -- keep full record for debugging
  updated_at            timestamptz not null default now(),
  primary key (enroll_code, quarter_code)
);
create index if not exists sections_quarter_idx on public.sections (quarter_code);
create index if not exists sections_course_idx on public.sections (course_norm);
drop trigger if exists sections_touch on public.sections;
create trigger sections_touch before update on public.sections
  for each row execute function public.touch_updated_at();

-- ---- major_requirements -----------------------------------------------------
create table if not exists public.major_requirements (
  major_id      text primary key,                -- e.g. "stats_ds_bs"
  name          text not null,
  degree        text,
  catalog_year  text,
  department    text,
  college       text,
  structure     jsonb not null,                  -- full extracted tree
  reviewed      boolean not null default false,
  source_pdf    text,                            -- filename
  updated_at    timestamptz not null default now()
);
drop trigger if exists major_req_touch on public.major_requirements;
create trigger major_req_touch before update on public.major_requirements
  for each row execute function public.touch_updated_at();

-- ---- minor_requirements -----------------------------------------------------
create table if not exists public.minor_requirements (
  minor_id      text primary key,
  name          text not null,
  catalog_year  text,
  department    text,
  structure     jsonb not null,
  reviewed      boolean not null default false,
  source_pdf    text,
  updated_at    timestamptz not null default now()
);
drop trigger if exists minor_req_touch on public.minor_requirements;
create trigger minor_req_touch before update on public.minor_requirements
  for each row execute function public.touch_updated_at();

-- ---- schedules (user-scoped) ------------------------------------------------
create table if not exists public.schedules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  quarter_code text not null,
  sections    jsonb not null,                    -- array of enroll_codes + metadata snapshot
  score       numeric,
  explanation jsonb,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists schedules_user_idx on public.schedules (user_id, created_at desc);
drop trigger if exists schedules_touch on public.schedules;
create trigger schedules_touch before update on public.schedules
  for each row execute function public.touch_updated_at();

-- ---- preference_profiles (user-scoped) --------------------------------------
create table if not exists public.preference_profiles (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  weight_grades            numeric not null default 0.25,
  weight_professor         numeric not null default 0.25,
  weight_convenience       numeric not null default 0.25,
  weight_availability      numeric not null default 0.25,
  target_units_min         integer default 12,
  target_units_max         integer default 17,
  earliest_start           time default '09:00',
  latest_end               time default '20:00',
  preferred_days           text[] default array['M','T','W','R','F'],
  avoid_friday_afternoon   boolean default false,
  diversity_lambda         numeric default 0.15,
  updated_at               timestamptz not null default now()
);
drop trigger if exists preference_touch on public.preference_profiles;
create trigger preference_touch before update on public.preference_profiles
  for each row execute function public.touch_updated_at();

-- ---- data_refresh_log -------------------------------------------------------
create table if not exists public.data_refresh_log (
  id            bigserial primary key,
  source        text not null,                   -- "nexus", "catalog", "rmp", "majors"
  status        text not null check (status in ('started','success','failed')),
  rows_ingested integer,
  message       text,
  run_at        timestamptz not null default now()
);
create index if not exists data_refresh_log_source_idx on public.data_refresh_log (source, run_at desc);

-- ---- RLS --------------------------------------------------------------------
alter table public.courses             enable row level security;
alter table public.professors          enable row level security;
alter table public.grade_distributions enable row level security;
alter table public.sections            enable row level security;
alter table public.major_requirements  enable row level security;
alter table public.minor_requirements  enable row level security;
alter table public.schedules           enable row level security;
alter table public.preference_profiles enable row level security;
alter table public.data_refresh_log    enable row level security;

-- public-read policies (anyone with anon key can select)
drop policy if exists courses_select_all on public.courses;
create policy courses_select_all on public.courses for select using (true);

drop policy if exists professors_select_all on public.professors;
create policy professors_select_all on public.professors for select using (true);

drop policy if exists grade_dist_select_all on public.grade_distributions;
create policy grade_dist_select_all on public.grade_distributions for select using (true);

drop policy if exists sections_select_all on public.sections;
create policy sections_select_all on public.sections for select using (true);

drop policy if exists major_req_select_all on public.major_requirements;
create policy major_req_select_all on public.major_requirements for select using (true);

drop policy if exists minor_req_select_all on public.minor_requirements;
create policy minor_req_select_all on public.minor_requirements for select using (true);

drop policy if exists data_refresh_log_select_all on public.data_refresh_log;
create policy data_refresh_log_select_all on public.data_refresh_log for select using (true);

-- user-scoped schedules
drop policy if exists schedules_select_own on public.schedules;
create policy schedules_select_own on public.schedules for select using (auth.uid() = user_id);
drop policy if exists schedules_insert_own on public.schedules;
create policy schedules_insert_own on public.schedules for insert with check (auth.uid() = user_id);
drop policy if exists schedules_update_own on public.schedules;
create policy schedules_update_own on public.schedules for update using (auth.uid() = user_id);
drop policy if exists schedules_delete_own on public.schedules;
create policy schedules_delete_own on public.schedules for delete using (auth.uid() = user_id);

-- user-scoped preference_profiles
drop policy if exists preference_select_own on public.preference_profiles;
create policy preference_select_own on public.preference_profiles for select using (auth.uid() = user_id);
drop policy if exists preference_upsert_own on public.preference_profiles;
create policy preference_upsert_own on public.preference_profiles for insert with check (auth.uid() = user_id);
drop policy if exists preference_update_own on public.preference_profiles;
create policy preference_update_own on public.preference_profiles for update using (auth.uid() = user_id);
