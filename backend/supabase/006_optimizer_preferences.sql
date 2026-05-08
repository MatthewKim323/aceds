-- Full Schedule Builder / POST /optimize preference payload (JSON).
-- Run after 001_student_profiles.sql.

ALTER TABLE student_profiles
ADD COLUMN IF NOT EXISTS optimizer_preferences JSONB DEFAULT NULL;

COMMENT ON COLUMN student_profiles.optimizer_preferences IS
  'Full OptimizePreferences JSON for Schedule Builder; legacy columns remain for onboarding/back-compat.';
