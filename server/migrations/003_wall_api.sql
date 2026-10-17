-- 003_wall_api: the /v1 notes and whiteboard API as Postgres functions, for the Neon Data API.
-- The GitHub Pages copy of the wall calls these over HTTPS with a Neon Auth JWT; the Express
-- server keeps using the tables directly. Same rules, same responses, same advisory lock.
--
-- Only schema "wall" is exposed by the Data API, and it holds functions only. Tables stay in
-- "public" with no grants to the API roles, plus RLS with no policies as a second lock. Every
-- function runs as the table owner and first resolves the caller's company from wall_members:
-- a signed-in account that is not listed there gets 403, so open sign-up on Neon Auth grants nothing.
-- Errors use PostgREST's PTnnn codes (HTTP status nnn) with the API's error code as the message.
-- Idempotent: safe to run twice.

DO $$
BEGIN
  -- The Data API creates these roles; branches without it (tests) need them for the grants below.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anonymous') THEN CREATE ROLE anonymous NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS wall_members (
  user_id    TEXT PRIMARY KEY,          -- Neon Auth user id (the JWT sub claim)
  company_id UUID NOT NULL REFERENCES companies(id),
  label      TEXT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE companies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_strokes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wall_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated, anonymous;

CREATE SCHEMA IF NOT EXISTS wall;
CREATE SCHEMA IF NOT EXISTS wall_private;
REVOKE ALL ON SCHEMA wall, wall_private FROM PUBLIC;

/* ------------------------------------------------------------ helpers -- */

CREATE OR REPLACE FUNCTION wall_private.fail(status integer, code text, detail text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'PT' || status, MESSAGE = code, DETAIL = detail;
END $$;

-- auth.user_id() reads the request JWT (pg_session_jwt, installed by the Data API).
CREATE OR REPLACE FUNCTION wall_private.company() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  uid text := auth.user_id();
  cid uuid;
BEGIN
  IF uid IS NOT NULL THEN
    SELECT company_id INTO cid FROM wall_members WHERE user_id = uid;
  END IF;
  IF cid IS NULL THEN
    PERFORM wall_private.fail(403, 'not_a_member', 'This account is not allowed on the wall');
  END IF;
  RETURN cid;
END $$;

-- Same format as JavaScript's Date#toISOString, which the server sends.
CREATE OR REPLACE FUNCTION wall_private.iso(t timestamptz) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE OR REPLACE FUNCTION wall_private.note_json(n notes) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', n.id, 'body', n.body, 'color', n.color,
    'createdAt', wall_private.iso(n.created_at), 'updatedAt', wall_private.iso(n.updated_at))
$$;

CREATE OR REPLACE FUNCTION wall_private.stroke_json(s whiteboard_strokes) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', s.id, 'ink', s.ink, 'width', s.width, 'points', s.points,
    'createdAt', wall_private.iso(s.created_at))
$$;

-- Mirrors notes.js checkBody: trimmed, not empty, at most 600 code points.
CREATE OR REPLACE FUNCTION wall_private.clean_body(body text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t text := regexp_replace(body, '^\s+|\s+$', '', 'g');
BEGIN
  IF body IS NULL THEN PERFORM wall_private.fail(400, 'validation_failed', 'body must be a string'); END IF;
  IF t = '' THEN PERFORM wall_private.fail(400, 'validation_failed', 'body must not be empty'); END IF;
  IF char_length(t) > 600 THEN PERFORM wall_private.fail(400, 'validation_failed', 'body must be at most 600 characters'); END IF;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION wall_private.check_color(color text) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF color IS NOT NULL AND color NOT IN ('blue', 'pink', 'green', 'yellow') THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'color must be null or one of blue, pink, green, yellow');
  END IF;
END $$;

/* -------------------------------------------------------------- notes -- */

-- GET /v1/notes: the newest notes, shown oldest-first, and whether older ones exist.
CREATE OR REPLACE FUNCTION wall.list_notes(lim integer DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  n integer;
  items jsonb;
  more boolean;
BEGIN
  IF lim IS NULL OR lim < 1 THEN PERFORM wall_private.fail(400, 'validation_failed', 'limit must be a positive integer'); END IF;
  n := least(lim, 500);
  SELECT count(*) > n INTO more FROM (
    SELECT 1 FROM notes WHERE company_id = cid AND deleted_at IS NULL LIMIT n + 1) probe;
  SELECT coalesce(jsonb_agg(wall_private.note_json(x) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO items
    FROM notes x
   WHERE x.id IN (SELECT id FROM notes WHERE company_id = cid AND deleted_at IS NULL
                   ORDER BY created_at DESC, id DESC LIMIT n);
  RETURN jsonb_build_object('notes', items, 'hasMore', more);
END $$;

-- POST /v1/notes: idempotent on note_id, so a retried create never lands twice.
CREATE OR REPLACE FUNCTION wall.create_note(note_id uuid, note_body text, note_color text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  t text := wall_private.clean_body(note_body);
  rec notes;
BEGIN
  PERFORM wall_private.check_color(note_color);
  INSERT INTO notes (id, company_id, body, color)
    VALUES (coalesce(note_id, uuid_generate_v4()), cid, t, note_color)
    ON CONFLICT (id) DO NOTHING RETURNING * INTO rec;
  IF rec.id IS NULL THEN
    SELECT * INTO rec FROM notes WHERE id = note_id AND company_id = cid AND deleted_at IS NULL;
    IF rec.id IS NULL THEN PERFORM wall_private.fail(409, 'id_conflict', 'A note with this id cannot be created'); END IF;
  END IF;
  RETURN wall_private.note_json(rec);
END $$;

-- PATCH /v1/notes/:id. patch is {body?, color?}; color may be set to null.
CREATE OR REPLACE FUNCTION wall.update_note(note_id uuid, patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  has_body boolean := coalesce(jsonb_typeof(patch) = 'object' AND patch ? 'body', false);
  has_color boolean := coalesce(jsonb_typeof(patch) = 'object' AND patch ? 'color', false);
  new_body text;
  new_color text;
  rec notes;
BEGIN
  IF has_body THEN
    IF jsonb_typeof(patch->'body') <> 'string' THEN PERFORM wall_private.fail(400, 'validation_failed', 'body must be a string'); END IF;
    new_body := wall_private.clean_body(patch->>'body');
  END IF;
  IF has_color THEN
    IF jsonb_typeof(patch->'color') NOT IN ('string', 'null') THEN
      PERFORM wall_private.fail(400, 'validation_failed', 'color must be null or one of blue, pink, green, yellow');
    END IF;
    new_color := patch->>'color';
    PERFORM wall_private.check_color(new_color);
  END IF;
  IF NOT has_body AND NOT has_color THEN PERFORM wall_private.fail(400, 'validation_failed', 'Send body and/or color to update'); END IF;
  UPDATE notes SET
      body = CASE WHEN has_body THEN new_body ELSE body END,
      color = CASE WHEN has_color THEN new_color ELSE color END,
      updated_at = now()
    WHERE id = note_id AND company_id = cid AND deleted_at IS NULL
    RETURNING * INTO rec;
  IF rec.id IS NULL THEN PERFORM wall_private.fail(404, 'not_found', 'Note not found'); END IF;
  RETURN wall_private.note_json(rec);
END $$;

-- DELETE /v1/notes/:id: soft delete, so undo can restore it.
CREATE OR REPLACE FUNCTION wall.remove_note(note_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
BEGIN
  UPDATE notes SET deleted_at = coalesce(deleted_at, now()) WHERE id = note_id AND company_id = cid;
  IF NOT FOUND THEN PERFORM wall_private.fail(404, 'not_found', 'Note not found'); END IF;
END $$;

-- POST /v1/notes/:id/restore
CREATE OR REPLACE FUNCTION wall.restore_note(note_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  rec notes;
BEGIN
  UPDATE notes SET deleted_at = NULL WHERE id = note_id AND company_id = cid RETURNING * INTO rec;
  IF rec.id IS NULL THEN PERFORM wall_private.fail(404, 'not_found', 'Note not found'); END IF;
  RETURN wall_private.note_json(rec);
END $$;

/* --------------------------------------------------------- whiteboard -- */

-- GET /v1/whiteboard/strokes: the newest strokes, in drawing order.
CREATE OR REPLACE FUNCTION wall.list_strokes(lim integer DEFAULT 1500) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  n integer;
  items jsonb;
  more boolean;
BEGIN
  IF lim IS NULL OR lim < 1 THEN PERFORM wall_private.fail(400, 'validation_failed', 'limit must be a positive integer'); END IF;
  n := least(lim, 1500);
  SELECT count(*) > n INTO more FROM (
    SELECT 1 FROM whiteboard_strokes WHERE company_id = cid AND deleted_at IS NULL LIMIT n + 1) probe;
  SELECT coalesce(jsonb_agg(wall_private.stroke_json(x) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO items
    FROM whiteboard_strokes x
   WHERE x.id IN (SELECT id FROM whiteboard_strokes WHERE company_id = cid AND deleted_at IS NULL
                   ORDER BY created_at DESC, id DESC LIMIT n);
  RETURN jsonb_build_object('strokes', items, 'hasMore', more);
END $$;

-- POST /v1/whiteboard/strokes: idempotent on stroke_id, capped at 1500 live strokes.
CREATE OR REPLACE FUNCTION wall.add_stroke(stroke_id uuid, ink text, width real, points jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  rec whiteboard_strokes;
  live integer;
BEGIN
  IF ink IS NULL OR ink NOT IN ('black', 'blue') THEN PERFORM wall_private.fail(400, 'validation_failed', 'ink must be black or blue'); END IF;
  IF width IS NULL OR NOT (width > 0 AND width <= 0.05::real) THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'width must be a number greater than 0 and at most 0.05');
  END IF;
  IF points IS NULL OR jsonb_typeof(points) <> 'array' OR jsonb_array_length(points) NOT BETWEEN 1 AND 1000 THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'points must be an array of 1 to 1000 points');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(points) p
              WHERE jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) <> 2
                 OR jsonb_typeof(p->0) <> 'number' OR jsonb_typeof(p->1) <> 'number') THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'each point must be [x, y] with finite numbers');
  END IF;

  -- Same key as whiteboard.js, so server and Data API creates serialize together.
  PERFORM pg_advisory_xact_lock(hashtext('whiteboard:' || cid::text));
  IF stroke_id IS NOT NULL THEN
    SELECT * INTO rec FROM whiteboard_strokes WHERE id = stroke_id;
    IF rec.id IS NOT NULL THEN
      IF rec.company_id <> cid THEN PERFORM wall_private.fail(409, 'id_conflict', 'A stroke with this id cannot be created'); END IF;
      RETURN wall_private.stroke_json(rec);
    END IF;
  END IF;
  SELECT count(*) INTO live FROM whiteboard_strokes WHERE company_id = cid AND deleted_at IS NULL;
  IF live >= 1500 THEN PERFORM wall_private.fail(409, 'whiteboard_full', 'The whiteboard is full'); END IF;
  INSERT INTO whiteboard_strokes (id, company_id, ink, width, points)
    VALUES (coalesce(stroke_id, uuid_generate_v4()), cid, ink, width, points)
    RETURNING * INTO rec;
  RETURN wall_private.stroke_json(rec);
END $$;

-- POST /v1/whiteboard/strokes/erase: {erased} in request order, only strokes that were live.
CREATE OR REPLACE FUNCTION wall.erase_strokes(ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  out jsonb;
BEGIN
  IF ids IS NULL OR cardinality(ids) NOT BETWEEN 1 AND 500 OR array_position(ids, NULL) IS NOT NULL THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'ids must be an array of 1 to 500 stroke ids');
  END IF;
  WITH wanted AS (
    SELECT u.id, min(u.ord) AS ord FROM unnest(ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id
  ), hit AS (
    UPDATE whiteboard_strokes s SET deleted_at = now() FROM wanted w
     WHERE s.company_id = cid AND s.id = w.id AND s.deleted_at IS NULL
    RETURNING s.id, w.ord
  )
  SELECT coalesce(jsonb_agg(hit.id ORDER BY hit.ord), '[]'::jsonb) INTO out FROM hit;
  RETURN jsonb_build_object('erased', out);
END $$;

-- POST /v1/whiteboard/strokes/restore: undoing a clear restores a whole board.
CREATE OR REPLACE FUNCTION wall.restore_strokes(ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  back uuid[];
  out jsonb;
BEGIN
  IF ids IS NULL OR cardinality(ids) NOT BETWEEN 1 AND 1500 OR array_position(ids, NULL) IS NOT NULL THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'ids must be an array of 1 to 1500 stroke ids');
  END IF;
  WITH restored AS (
    UPDATE whiteboard_strokes SET deleted_at = NULL
     WHERE company_id = cid AND id = ANY (ids)
    RETURNING id
  )
  SELECT array_agg(id) INTO back FROM restored;
  SELECT coalesce(jsonb_agg(wall_private.stroke_json(s) ORDER BY s.created_at, s.id), '[]'::jsonb) INTO out
    FROM whiteboard_strokes s WHERE s.id = ANY (back);
  RETURN jsonb_build_object('strokes', out);
END $$;

-- POST /v1/whiteboard/clear: {cleared} oldest first, so undo can restore them.
CREATE OR REPLACE FUNCTION wall.clear_strokes() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  out jsonb;
BEGIN
  WITH gone AS (
    UPDATE whiteboard_strokes SET deleted_at = now()
     WHERE company_id = cid AND deleted_at IS NULL
    RETURNING id, created_at
  )
  SELECT coalesce(jsonb_agg(gone.id ORDER BY gone.created_at, gone.id), '[]'::jsonb) INTO out FROM gone;
  RETURN jsonb_build_object('cleared', out);
END $$;

/* ------------------------------------------------------------- grants -- */

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wall, wall_private FROM PUBLIC;
GRANT USAGE ON SCHEMA wall TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wall TO authenticated;
