-- 006_save_stroke: the public page grows a line by saving the same stroke again.
-- A second save with the same id replaces the points. A new id inserts, same cap as add_stroke.
-- Idempotent: CREATE OR REPLACE and GRANT.

CREATE OR REPLACE FUNCTION wall.save_stroke(stroke_id uuid, ink text, width real, points jsonb) RETURNS jsonb
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

  PERFORM pg_advisory_xact_lock(hashtext('whiteboard:' || cid::text));
  IF stroke_id IS NOT NULL THEN
    SELECT * INTO rec FROM whiteboard_strokes WHERE id = stroke_id;
    IF rec.id IS NOT NULL THEN
      IF rec.company_id <> cid THEN PERFORM wall_private.fail(409, 'id_conflict', 'A stroke with this id cannot be created'); END IF;
      IF rec.deleted_at IS NULL THEN
        UPDATE whiteboard_strokes SET ink = save_stroke.ink, width = save_stroke.width, points = save_stroke.points
          WHERE id = rec.id
          RETURNING * INTO rec;
      END IF;
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

GRANT EXECUTE ON FUNCTION wall.save_stroke(uuid, text, real, jsonb) TO anonymous, authenticated;
