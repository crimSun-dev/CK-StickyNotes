-- 004_note_revision: every note update must name the revision it read.
-- A matching revision increments. A stale one changes nothing and returns the current note.
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION wall_private.note_json(n notes) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', n.id, 'body', n.body, 'color', n.color,
    'revision', n.revision,
    'createdAt', wall_private.iso(n.created_at), 'updatedAt', wall_private.iso(n.updated_at))
$$;

CREATE OR REPLACE FUNCTION wall.update_note(note_id uuid, patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  has_body boolean := coalesce(jsonb_typeof(patch) = 'object' AND patch ? 'body', false);
  has_color boolean := coalesce(jsonb_typeof(patch) = 'object' AND patch ? 'color', false);
  new_body text;
  new_color text;
  rev_text text;
  base_rev integer;
  rec notes;
  current notes;
BEGIN
  IF patch ? 'revision' THEN
    rev_text := patch->>'revision';
  ELSIF patch ? 'baseRevision' THEN
    rev_text := patch->>'baseRevision';
  END IF;
  IF rev_text IS NULL OR rev_text !~ '^[0-9]+$' OR length(rev_text) > 10 THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'revision must be an integer');
  END IF;
  IF rev_text::bigint > 2147483647 THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'revision must be an integer');
  END IF;
  base_rev := rev_text::integer;

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
      revision = revision + 1,
      updated_at = now()
    WHERE id = note_id AND company_id = cid AND deleted_at IS NULL AND revision = base_rev
    RETURNING * INTO rec;
  IF rec.id IS NOT NULL THEN
    RETURN wall_private.note_json(rec);
  END IF;

  SELECT * INTO current FROM notes
    WHERE id = note_id AND company_id = cid AND deleted_at IS NULL;
  IF current.id IS NULL THEN
    PERFORM wall_private.fail(404, 'not_found', 'Note not found');
  END IF;
  PERFORM wall_private.fail(409, 'revision_conflict', wall_private.note_json(current)::text);
END $$;
