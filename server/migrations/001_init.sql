-- 001_init: companies + notes for the Creative Episode wall.
-- Idempotent: safe to run twice. companies is created before notes for the FK.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS companies (
  id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

INSERT INTO companies (slug, name) VALUES ('kmk', 'KMK Group')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS notes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  body       TEXT NOT NULL CONSTRAINT notes_body_check
               CHECK (btrim(body) <> '' AND char_length(body) <= 600),
  color      TEXT CONSTRAINT notes_color_check
               CHECK (color IN ('blue', 'pink', 'green', 'yellow')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notes_live_by_company
  ON notes (company_id, created_at) WHERE deleted_at IS NULL;
