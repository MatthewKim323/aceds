-- Evidence bundle digest for SKP / competition audit trail.
-- Run in Supabase SQL editor after 005_optimization_runs.sql. Idempotent.

alter table public.optimization_runs
  add column if not exists student_evidence_bundle_sha256 text;

comment on column public.optimization_runs.student_evidence_bundle_sha256 is
  'SHA256 of canonical student evidence (completed courses + grade keys/values) + quarter + model id — pins optimizer inputs when user_id present.';
