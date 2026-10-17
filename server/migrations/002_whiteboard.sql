-- 002_whiteboard: one row per whiteboard stroke, shared by the company.
-- Points are a JSONB array of [x, y] pairs, written once with the stroke and never queried alone.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS whiteboard_strokes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  ink        TEXT NOT NULL CONSTRAINT whiteboard_strokes_ink_check
               CHECK (ink IN ('black', 'blue')),
  width      REAL NOT NULL CONSTRAINT whiteboard_strokes_width_check
               CHECK (width > 0 AND width <= 0.05::real),  -- compare as real: 0.05 stored in REAL is 0.0500000007
  points     JSONB NOT NULL CONSTRAINT whiteboard_strokes_points_check
               CHECK (CASE WHEN jsonb_typeof(points) = 'array'
                           THEN jsonb_array_length(points) BETWEEN 1 AND 1000
                           ELSE false END),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS whiteboard_strokes_live
  ON whiteboard_strokes (company_id, created_at) WHERE deleted_at IS NULL;
