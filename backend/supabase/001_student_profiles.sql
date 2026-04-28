-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS student_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    major               TEXT NOT NULL,
    year                TEXT NOT NULL,
    completed_courses   TEXT[] DEFAULT '{}',
    in_progress_courses TEXT[] DEFAULT '{}',
    course_grades       JSONB DEFAULT '{}',
    cumulative_gpa      FLOAT,
    transfer_units      INT DEFAULT 0,
    ap_credits          JSONB DEFAULT '[]',
    requirement_status  JSONB,
    earliest_class      TEXT DEFAULT '09:00',
    preferred_days      TEXT DEFAULT 'no_preference',
    target_units        INT DEFAULT 16,
    priority_weights    JSONB DEFAULT '{"professor": 0.35, "grades": 0.30, "convenience": 0.20, "availability": 0.15}',
    onboarding_complete BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;

-- Re-runnable: drop the existing policy (if any) before recreating.
DROP POLICY IF EXISTS "Users can view own profile" ON student_profiles;
CREATE POLICY "Users can view own profile"
    ON student_profiles FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON student_profiles;
CREATE POLICY "Users can insert own profile"
    ON student_profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own profile" ON student_profiles;
CREATE POLICY "Users can update own profile"
    ON student_profiles FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS student_profiles_updated_at ON student_profiles;
CREATE TRIGGER student_profiles_updated_at
    BEFORE UPDATE ON student_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
