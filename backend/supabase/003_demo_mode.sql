-- Demo mode: track which synthetic student profile is currently loaded.
-- Run after 001_student_profiles.sql.

ALTER TABLE student_profiles
    ADD COLUMN IF NOT EXISTS demo_student_id TEXT;

COMMENT ON COLUMN student_profiles.demo_student_id IS
    'ID of the synthetic student loaded into this account for demo mode. NULL when user is using their real profile.';
