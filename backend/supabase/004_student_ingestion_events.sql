-- Append-only audit log for profile / transcript ingestion (showcase + provenance).
-- Run in Supabase SQL Editor after 001_student_profiles.sql (or via migrations).

CREATE TABLE IF NOT EXISTS student_ingestion_events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source                TEXT NOT NULL CHECK (source IN ('transcript', 'academic_history', 'manual')),
    parse_schema_version  TEXT NOT NULL DEFAULT 'v1',
    summary               JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_ingestion_events_user_id_created_at_idx
    ON student_ingestion_events (user_id, created_at DESC);

ALTER TABLE student_ingestion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own ingestion events" ON student_ingestion_events;
CREATE POLICY "Users can select own ingestion events"
    ON student_ingestion_events FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own ingestion events" ON student_ingestion_events;
CREATE POLICY "Users can insert own ingestion events"
    ON student_ingestion_events FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- No UPDATE/DELETE: append-only log.
