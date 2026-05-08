-- Saved optimizer schedules per user (browse history in Schedule Builder).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS saved_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    quarter_code TEXT NOT NULL,
    label TEXT,
    score DOUBLE PRECISION,
    total_units DOUBLE PRECISION,
    rank_in_run INT,
    candidate JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saved_schedules_user_created_idx
    ON saved_schedules(user_id, created_at DESC);

ALTER TABLE saved_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own saved_schedules" ON saved_schedules;
CREATE POLICY "Users manage own saved_schedules"
    ON saved_schedules FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
