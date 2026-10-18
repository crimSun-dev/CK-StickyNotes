-- 007_hq_rooms: Black Box meetings, CK Hall rentals, and daily office arrivals.
--
-- A hub person is a name entered on this hub with a role (visitor, staff, hall_operator). It is
-- not the CCG admin user and not the anonymous wall token. The person id is the sign-in code:
-- it is handed only to that person and never appears in another person's view.
--
-- Rooms are spans. Overlap is refused by the database (GiST exclusion over active Black Box
-- meetings and confirmed CK Hall bookings), so the office server and the Neon Data API cannot
-- double-book a room between them. There is no in_use or on_air column: the corridor reads the
-- spans that cover now.
--
-- The rules live once, in wall_private.hq_* functions. The wall.* wrappers expose them to the Data
-- API (GitHub Pages); the office server (src/rooms.js) calls the same functions with its company.
-- Errors use PTnnn like 003. The office day is Asia/Jakarta.
-- Idempotent: safe to run twice.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS people (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id),
  display_name TEXT NOT NULL CONSTRAINT people_display_name_check
                 CHECK (btrim(display_name) <> '' AND char_length(display_name) <= 60),
  role         TEXT NOT NULL DEFAULT 'visitor' CONSTRAINT people_role_check
                 CHECK (role IN ('visitor', 'staff', 'hall_operator')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  room       TEXT NOT NULL CONSTRAINT bookings_room_check CHECK (room IN ('black_box', 'ck_hall')),
  title      TEXT NOT NULL CONSTRAINT bookings_title_check   -- meeting title, or the hall requester's name
               CHECK (btrim(title) <> '' AND char_length(title) <= 120),
  start_at   TIMESTAMPTZ NOT NULL,
  end_at     TIMESTAMPTZ NOT NULL,
  note       TEXT CONSTRAINT bookings_note_check CHECK (char_length(note) <= 600),
  status     TEXT NOT NULL CONSTRAINT bookings_status_check
               CHECK (status IN ('active', 'requested', 'confirmed', 'declined', 'cancelled')),
  created_by UUID NOT NULL REFERENCES people(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bookings_span_check CHECK (end_at > start_at),
  -- Black Box meetings are active or cancelled; hall bookings go requested -> confirmed/declined/cancelled.
  CONSTRAINT bookings_room_status_check CHECK (
    (room = 'black_box' AND status IN ('active', 'cancelled')) OR
    (room = 'ck_hall' AND status IN ('requested', 'confirmed', 'declined', 'cancelled'))),
  -- Half-open [start, end): a meeting may start the moment the last one ends.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    company_id WITH =,
    room WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status IN ('active', 'confirmed'))
);

CREATE INDEX IF NOT EXISTS bookings_by_room_time ON bookings (company_id, room, start_at);

CREATE TABLE IF NOT EXISTS arrivals (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  person_id  UUID NOT NULL REFERENCES people(id),
  day        DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date,
  coming     BOOLEAN NOT NULL,
  note       TEXT CONSTRAINT arrivals_note_check CHECK (char_length(note) <= 280),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT arrivals_person_day UNIQUE (person_id, day)
);

ALTER TABLE people   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrivals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON people, bookings, arrivals FROM authenticated, anonymous;

/* ------------------------------------------------------------ helpers -- */

CREATE OR REPLACE FUNCTION wall_private.hq_today() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date
$$;

-- The caller's person row on this company, or a row of NULLs when me is unknown.
CREATE OR REPLACE FUNCTION wall_private.hq_person(cid uuid, me uuid) RETURNS people
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT * FROM people WHERE id = me AND company_id = cid
$$;

CREATE OR REPLACE FUNCTION wall_private.hq_need(p people, VARIADIC roles text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p.id IS NULL THEN PERFORM wall_private.fail(401, 'person_required', 'Say who you are on the hub first'); END IF;
  IF NOT (p.role = ANY (roles)) THEN PERFORM wall_private.fail(403, 'forbidden', 'Your hub role cannot do this'); END IF;
END $$;

-- Trimmed text, at most cap characters. Optional text that is blank becomes NULL.
CREATE OR REPLACE FUNCTION wall_private.hq_text(val text, field text, cap integer, required boolean) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t text := regexp_replace(coalesce(val, ''), '^\s+|\s+$', '', 'g');
BEGIN
  IF required AND t = '' THEN PERFORM wall_private.fail(400, 'validation_failed', field || ' must not be empty'); END IF;
  IF char_length(t) > cap THEN
    PERFORM wall_private.fail(400, 'validation_failed', field || ' must be at most ' || cap || ' characters');
  END IF;
  RETURN nullif(t, '');
END $$;

CREATE OR REPLACE FUNCTION wall_private.hq_span(s timestamptz, e timestamptz) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF s IS NULL OR e IS NULL THEN PERFORM wall_private.fail(400, 'validation_failed', 'start and end are required'); END IF;
  IF e <= s THEN PERFORM wall_private.fail(400, 'validation_failed', 'end must be after start'); END IF;
END $$;

CREATE OR REPLACE FUNCTION wall_private.hq_person_json(p people) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p.id IS NULL THEN NULL
    ELSE jsonb_build_object('id', p.id, 'displayName', p.display_name, 'role', p.role) END
$$;

-- The whole booking, createdBy included. Never returned as is: hq_view decides what a viewer sees.
CREATE OR REPLACE FUNCTION wall_private.hq_booking_json(b bookings) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', b.id, 'room', b.room, 'title', b.title,
    'startAt', wall_private.iso(b.start_at), 'endAt', wall_private.iso(b.end_at),
    'note', b.note, 'status', b.status,
    'byName', (SELECT display_name FROM people WHERE id = b.created_by),
    'createdBy', b.created_by,
    'createdAt', wall_private.iso(b.created_at), 'updatedAt', wall_private.iso(b.updated_at))
$$;

-- Staff and the booker see the booking; everyone else sees only when the room is taken.
-- Mirrored by viewBooking in src/rooms.js for /v1/live fan-out.
CREATE OR REPLACE FUNCTION wall_private.hq_view(b jsonb, viewer people) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN b IS NULL THEN NULL
    WHEN viewer.role IN ('staff', 'hall_operator') OR (b->>'createdBy')::uuid = viewer.id
      THEN (b - 'createdBy') || jsonb_build_object('mine', coalesce((b->>'createdBy')::uuid = viewer.id, false))
    ELSE jsonb_build_object('id', b->'id', 'room', b->'room', 'startAt', b->'startAt', 'endAt', b->'endAt',
      'status', b->'status', 'mine', false)
  END
$$;

CREATE OR REPLACE FUNCTION wall_private.hq_arrival_json(a arrivals) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', a.id,
    'name', (SELECT display_name FROM people WHERE id = a.person_id),
    'day', to_char(a.day, 'YYYY-MM-DD'), 'coming', a.coming, 'note', a.note,
    'personId', a.person_id, 'updatedAt', wall_private.iso(a.updated_at))
$$;

CREATE OR REPLACE FUNCTION wall_private.hq_arrival_view(a jsonb, viewer people) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT (a - 'personId') || jsonb_build_object('mine', coalesce((a->>'personId')::uuid = viewer.id, false))
$$;

/* --------------------------------------------------------- the rules -- */

-- A visitor joins the hub by name. Staff and hall operators are added by the office (scripts/add-person.js).
CREATE OR REPLACE FUNCTION wall_private.hq_join(cid uuid, p_name text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  rec people;
BEGIN
  INSERT INTO people (company_id, display_name, role)
    VALUES (cid, wall_private.hq_text(p_name, 'displayName', 60, true), 'visitor')
    RETURNING * INTO rec;
  RETURN wall_private.hq_person_json(rec);
END $$;

-- Bookings of one room that touch one Jakarta day, in start order. Black Box is for staff;
-- a visitor sees confirmed hall spans and their own requests.
CREATE OR REPLACE FUNCTION wall_private.hq_list_bookings(cid uuid, me uuid, b_room text, b_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
  d date := coalesce(b_day, wall_private.hq_today());
  day_from timestamptz := d::timestamp AT TIME ZONE 'Asia/Jakarta';
  day_to timestamptz := (d + 1)::timestamp AT TIME ZONE 'Asia/Jakarta';
  out jsonb;
BEGIN
  IF b_room = 'black_box' THEN
    PERFORM wall_private.hq_need(p, 'staff', 'hall_operator');
  ELSIF b_room = 'ck_hall' THEN
    PERFORM wall_private.hq_need(p, 'visitor', 'staff', 'hall_operator');
  ELSE
    PERFORM wall_private.fail(400, 'validation_failed', 'room must be black_box or ck_hall');
  END IF;
  SELECT coalesce(jsonb_agg(wall_private.hq_view(wall_private.hq_booking_json(b), p) ORDER BY b.start_at, b.id), '[]'::jsonb)
    INTO out
    FROM bookings b
   WHERE b.company_id = cid AND b.room = b_room
     AND b.start_at < day_to AND b.end_at > day_from
     AND b.status IN ('active', 'requested', 'confirmed')
     AND (p.role IN ('staff', 'hall_operator') OR b.created_by = p.id OR b.status = 'confirmed');
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION wall_private.hq_book_black_box(cid uuid, me uuid, b_id uuid, b_title text,
  b_start timestamptz, b_end timestamptz, b_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
  t text;
  n text;
  rec bookings;
BEGIN
  PERFORM wall_private.hq_need(p, 'staff', 'hall_operator');
  t := wall_private.hq_text(b_title, 'title', 120, true);
  n := wall_private.hq_text(b_note, 'note', 600, false);
  PERFORM wall_private.hq_span(b_start, b_end);
  -- A retry with the same id hands back the stored meeting instead of booking twice.
  IF b_id IS NOT NULL THEN
    SELECT * INTO rec FROM bookings WHERE id = b_id;
    IF rec.id IS NOT NULL THEN
      IF rec.company_id <> cid OR rec.room <> 'black_box' OR rec.created_by <> p.id THEN
        PERFORM wall_private.fail(409, 'id_conflict', 'A booking with this id cannot be created');
      END IF;
      RETURN wall_private.hq_booking_json(rec);
    END IF;
  END IF;
  BEGIN
    INSERT INTO bookings (id, company_id, room, title, start_at, end_at, note, status, created_by)
      VALUES (coalesce(b_id, uuid_generate_v4()), cid, 'black_box', t, b_start, b_end, n, 'active', p.id)
      RETURNING * INTO rec;
  EXCEPTION WHEN exclusion_violation THEN
    PERFORM wall_private.fail(409, 'booking_conflict', 'Black Box is already booked for part of that time');
  END;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- Cancelling frees the span at once. Cancelling twice is not an error.
CREATE OR REPLACE FUNCTION wall_private.hq_cancel_black_box(cid uuid, me uuid, b_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
  rec bookings;
BEGIN
  PERFORM wall_private.hq_need(p, 'staff', 'hall_operator');
  UPDATE bookings SET status = 'cancelled', updated_at = now()
   WHERE id = b_id AND company_id = cid AND room = 'black_box' AND status = 'active'
  RETURNING * INTO rec;
  IF rec.id IS NULL THEN
    SELECT * INTO rec FROM bookings WHERE id = b_id AND company_id = cid AND room = 'black_box';
    IF rec.id IS NULL THEN PERFORM wall_private.fail(404, 'not_found', 'Meeting not found'); END IF;
  END IF;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- Anyone on the hub may ask for the hall. A request may overlap others until it is confirmed.
CREATE OR REPLACE FUNCTION wall_private.hq_request_ck_hall(cid uuid, me uuid, b_id uuid, b_name text,
  b_start timestamptz, b_end timestamptz, b_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
  t text;
  n text;
  rec bookings;
BEGIN
  PERFORM wall_private.hq_need(p, 'visitor', 'staff', 'hall_operator');
  t := wall_private.hq_text(b_name, 'name', 120, true);
  n := wall_private.hq_text(b_note, 'note', 600, false);
  PERFORM wall_private.hq_span(b_start, b_end);
  IF b_id IS NOT NULL THEN
    SELECT * INTO rec FROM bookings WHERE id = b_id;
    IF rec.id IS NOT NULL THEN
      IF rec.company_id <> cid OR rec.room <> 'ck_hall' OR rec.created_by <> p.id THEN
        PERFORM wall_private.fail(409, 'id_conflict', 'A booking with this id cannot be created');
      END IF;
      RETURN wall_private.hq_booking_json(rec);
    END IF;
  END IF;
  INSERT INTO bookings (id, company_id, room, title, start_at, end_at, note, status, created_by)
    VALUES (coalesce(b_id, uuid_generate_v4()), cid, 'ck_hall', t, b_start, b_end, n, 'requested', p.id)
    RETURNING * INTO rec;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- decision: confirm (requested -> confirmed), decline or cancel (requested/confirmed -> declined/cancelled).
-- Repeating the decision already made is not an error.
CREATE OR REPLACE FUNCTION wall_private.hq_decide_ck_hall(cid uuid, me uuid, b_id uuid, decision text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
  target text;
  rec bookings;
BEGIN
  PERFORM wall_private.hq_need(p, 'hall_operator');
  target := CASE decision WHEN 'confirm' THEN 'confirmed' WHEN 'decline' THEN 'declined' WHEN 'cancel' THEN 'cancelled' END;
  IF target IS NULL THEN PERFORM wall_private.fail(400, 'validation_failed', 'decision must be confirm, decline or cancel'); END IF;
  SELECT * INTO rec FROM bookings WHERE id = b_id AND company_id = cid AND room = 'ck_hall' FOR UPDATE;
  IF rec.id IS NULL THEN PERFORM wall_private.fail(404, 'not_found', 'Hall booking not found'); END IF;
  IF rec.status = target THEN RETURN wall_private.hq_booking_json(rec); END IF;
  IF (target = 'confirmed' AND rec.status <> 'requested') OR rec.status NOT IN ('requested', 'confirmed') THEN
    PERFORM wall_private.fail(409, 'invalid_state', 'This hall booking is already ' || rec.status);
  END IF;
  BEGIN
    UPDATE bookings SET status = target, updated_at = now() WHERE id = rec.id RETURNING * INTO rec;
  EXCEPTION WHEN exclusion_violation THEN
    PERFORM wall_private.fail(409, 'booking_conflict', 'CK Hall is already confirmed for part of that time');
  END;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- One row per person per Jakarta day: saying it again updates the row.
CREATE OR REPLACE FUNCTION wall_private.hq_mark_arrival(cid uuid, me uuid, a_coming boolean, a_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
  n text;
  rec arrivals;
BEGIN
  PERFORM wall_private.hq_need(p, 'staff', 'hall_operator');
  IF a_coming IS NULL THEN PERFORM wall_private.fail(400, 'validation_failed', 'coming must be true or false'); END IF;
  n := wall_private.hq_text(a_note, 'note', 280, false);
  INSERT INTO arrivals (company_id, person_id, day, coming, note)
    VALUES (cid, p.id, wall_private.hq_today(), a_coming, n)
    ON CONFLICT (person_id, day) DO UPDATE SET coming = EXCLUDED.coming, note = EXCLUDED.note, updated_at = now()
    RETURNING * INTO rec;
  RETURN wall_private.hq_arrival_json(rec);
END $$;

CREATE OR REPLACE FUNCTION wall_private.hq_list_arrivals(cid uuid, me uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
  out jsonb;
BEGIN
  PERFORM wall_private.hq_need(p, 'staff', 'hall_operator');
  SELECT coalesce(jsonb_agg(wall_private.hq_arrival_view(wall_private.hq_arrival_json(a), p)
           ORDER BY x.display_name, a.id), '[]'::jsonb)
    INTO out
    FROM arrivals a JOIN people x ON x.id = a.person_id
   WHERE a.company_id = cid AND a.day = wall_private.hq_today();
  RETURN out;
END $$;

-- Everything the corridor needs for today, as this viewer may see it. Never refuses: a viewer
-- with no person still sees when the rooms are taken. now is the database clock, so pages can
-- correct their own. Used by the /v1/live hello and the Pages poller.
CREATE OR REPLACE FUNCTION wall_private.hq_rooms(cid uuid, me uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
  staff boolean := coalesce(p.role IN ('staff', 'hall_operator'), false);
  d date := wall_private.hq_today();
  day_from timestamptz := d::timestamp AT TIME ZONE 'Asia/Jakarta';
  day_to timestamptz := (d + 1)::timestamp AT TIME ZONE 'Asia/Jakarta';
  black jsonb;
  hall jsonb;
  arr jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(wall_private.hq_view(wall_private.hq_booking_json(b), p) ORDER BY b.start_at, b.id), '[]'::jsonb)
    INTO black
    FROM bookings b
   WHERE b.company_id = cid AND b.room = 'black_box' AND b.status = 'active'
     AND b.start_at < day_to AND b.end_at > day_from;
  SELECT coalesce(jsonb_agg(wall_private.hq_view(wall_private.hq_booking_json(b), p) ORDER BY b.start_at, b.id), '[]'::jsonb)
    INTO hall
    FROM bookings b
   WHERE b.company_id = cid AND b.room = 'ck_hall' AND b.status IN ('requested', 'confirmed')
     AND b.start_at < day_to AND b.end_at > day_from
     AND (staff OR b.created_by = p.id OR b.status = 'confirmed');
  IF staff THEN arr := wall_private.hq_list_arrivals(cid, me); END IF;
  RETURN jsonb_build_object('now', wall_private.iso(now()), 'day', to_char(d, 'YYYY-MM-DD'),
    'person', wall_private.hq_person_json(p), 'blackBox', black, 'ckHall', hall, 'arrivals', arr);
END $$;

/* ------------------------------------------------- Data API wrappers -- */
-- me is the caller's hub person id. Each wrapper returns what that person may see.

CREATE OR REPLACE FUNCTION wall.hub_join(display_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_join(wall_private.company(), display_name);
END $$;

CREATE OR REPLACE FUNCTION wall.hub_me(me uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  out jsonb := wall_private.hq_person_json(wall_private.hq_person(wall_private.company(), me));
BEGIN
  IF out IS NULL THEN PERFORM wall_private.fail(404, 'not_found', 'No one on the hub has this code'); END IF;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION wall.hub_rooms(me uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_rooms(wall_private.company(), me);
END $$;

CREATE OR REPLACE FUNCTION wall.list_bookings(me uuid, room text, day date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_list_bookings(wall_private.company(), me, room, day);
END $$;

CREATE OR REPLACE FUNCTION wall.book_black_box(me uuid, booking_id uuid, title text,
  start_at timestamptz, end_at timestamptz, note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
BEGIN
  RETURN wall_private.hq_view(
    wall_private.hq_book_black_box(cid, me, booking_id, title, start_at, end_at, note), wall_private.hq_person(cid, me));
END $$;

CREATE OR REPLACE FUNCTION wall.cancel_black_box(me uuid, booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
BEGIN
  RETURN wall_private.hq_view(wall_private.hq_cancel_black_box(cid, me, booking_id), wall_private.hq_person(cid, me));
END $$;

CREATE OR REPLACE FUNCTION wall.request_ck_hall(me uuid, booking_id uuid, name text,
  start_at timestamptz, end_at timestamptz, note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
BEGIN
  RETURN wall_private.hq_view(
    wall_private.hq_request_ck_hall(cid, me, booking_id, name, start_at, end_at, note), wall_private.hq_person(cid, me));
END $$;

CREATE OR REPLACE FUNCTION wall.decide_ck_hall(me uuid, booking_id uuid, decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
BEGIN
  RETURN wall_private.hq_view(wall_private.hq_decide_ck_hall(cid, me, booking_id, decision), wall_private.hq_person(cid, me));
END $$;

CREATE OR REPLACE FUNCTION wall.mark_arrival(me uuid, coming boolean, note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
BEGIN
  RETURN wall_private.hq_arrival_view(wall_private.hq_mark_arrival(cid, me, coming, note), wall_private.hq_person(cid, me));
END $$;

CREATE OR REPLACE FUNCTION wall.list_arrivals(me uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_list_arrivals(wall_private.company(), me);
END $$;

/* ------------------------------------------------------------- grants -- */

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wall, wall_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wall TO authenticated, anonymous;
