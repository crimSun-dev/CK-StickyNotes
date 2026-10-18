-- 009_seats_office_days: chairs at the Black Box table, and office days with the trip in.
--
-- Seats. Black Box has one round table with 8 chairs. Chair 1 is the host (the booker) and is not
-- stored. An invitation may name a chair, 2 to 8; no two people who have not declined share a chair,
-- and a meeting holds the host plus at most 7 people who have not declined. Declining empties the
-- chair. An invitation with no chair (made before seats, or from the names list) still counts, and
-- the page sits it at the first free chair. CK Hall invitations never name a chair.
--
-- Office days. "Coming in" can be said for any weekday from today through the 14-day reach of the
-- timetable, with an optional arrival time. On the day itself, the trip in is two steps: on the way
-- (left_at) and arrived (arrived_at). Saying "not coming" clears the trip. Repeat copies a day's plan
-- to the same weekday a week later, inside the reach. Notices are unchanged: they come from today's
-- "coming in", never from the trip.
--
-- Idempotent: safe to run twice.

/* ------------------------------------------------------------- tables -- */

ALTER TABLE meeting_invites ADD COLUMN IF NOT EXISTS seat SMALLINT;
ALTER TABLE meeting_invites DROP CONSTRAINT IF EXISTS meeting_invites_seat_check;
ALTER TABLE meeting_invites ADD CONSTRAINT meeting_invites_seat_check CHECK (seat IS NULL OR seat BETWEEN 2 AND 8);
-- A declined invitation keeps no chair, so the index can cover every row with a chair.
UPDATE meeting_invites SET seat = NULL WHERE status = 'declined' AND seat IS NOT NULL;
ALTER TABLE meeting_invites DROP CONSTRAINT IF EXISTS meeting_invites_declined_no_seat;
ALTER TABLE meeting_invites ADD CONSTRAINT meeting_invites_declined_no_seat CHECK (status <> 'declined' OR seat IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_invites_one_per_seat ON meeting_invites (booking_id, seat) WHERE seat IS NOT NULL;

ALTER TABLE arrivals ADD COLUMN IF NOT EXISTS arrive_at  TIME;
ALTER TABLE arrivals ADD COLUMN IF NOT EXISTS left_at    TIMESTAMPTZ;
ALTER TABLE arrivals ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
ALTER TABLE arrivals DROP CONSTRAINT IF EXISTS arrivals_trip_check;
ALTER TABLE arrivals ADD CONSTRAINT arrivals_trip_check CHECK (
  (coming OR (left_at IS NULL AND arrived_at IS NULL AND arrive_at IS NULL)) AND
  (arrived_at IS NULL OR left_at IS NOT NULL));

/* ------------------------------------- functions whose shape changes -- */

DROP FUNCTION IF EXISTS wall.book_black_box(uuid, uuid, text, timestamptz, timestamptz, text, uuid[]);
DROP FUNCTION IF EXISTS wall.invite(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS wall_private.hq_book(uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, uuid[]);
DROP FUNCTION IF EXISTS wall_private.hq_invite(uuid, uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS wall_private.hq_add_invites(uuid, bookings, people, uuid[]);

/* ------------------------------------------------------------ helpers -- */

-- The whole booking with its invitations, each with its chair (null: any free chair).
CREATE OR REPLACE FUNCTION wall_private.hq_booking_json(b bookings) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', b.id, 'room', b.room, 'title', b.title,
    'startAt', wall_private.iso(b.start_at), 'endAt', wall_private.iso(b.end_at),
    'note', b.note, 'status', b.status,
    'byName', (SELECT display_name FROM people WHERE id = b.created_by),
    'createdBy', b.created_by,
    'invites', coalesce((SELECT jsonb_agg(jsonb_build_object('personId', i.person_id, 'name', x.display_name,
                                                             'status', i.status, 'seat', i.seat)
                                          ORDER BY lower(x.display_name), x.id)
                           FROM meeting_invites i JOIN people x ON x.id = i.person_id
                          WHERE i.booking_id = b.id), '[]'::jsonb),
    'createdAt', wall_private.iso(b.created_at), 'updatedAt', wall_private.iso(b.updated_at))
$$;

-- Invite names into a booking, each optionally at a chair (seats lines up with ids).
-- A name already invited keeps their answer; given a chair, a name with none takes it, and a name who
-- declined is asked again at that chair. The booker is never invited.
CREATE OR REPLACE FUNCTION wall_private.hq_add_invites(cid uuid, b bookings, inviter people, ids uuid[],
  seats smallint[] DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  k integer;
  s smallint;
  taken text;
BEGIN
  IF ids IS NULL OR cardinality(ids) = 0 THEN RETURN; END IF;
  IF cardinality(ids) > 50 OR array_position(ids, NULL) IS NOT NULL OR EXISTS (
       SELECT 1 FROM unnest(ids) u(id) WHERE NOT EXISTS (SELECT 1 FROM people WHERE id = u.id AND company_id = cid)) THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'invite must name up to 50 people on the hub');
  END IF;
  IF seats IS NOT NULL THEN
    IF cardinality(seats) <> cardinality(ids) THEN
      PERFORM wall_private.fail(400, 'validation_failed', 'seats must line up with the names invited');
    END IF;
    IF b.room <> 'black_box' AND EXISTS (SELECT 1 FROM unnest(seats) u(s) WHERE u.s IS NOT NULL) THEN
      PERFORM wall_private.fail(400, 'validation_failed', 'Only Black Box has chairs');
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(seats) u(s) WHERE u.s IS NOT NULL AND u.s NOT BETWEEN 2 AND 8) THEN
      PERFORM wall_private.fail(400, 'validation_failed', 'A chair is 2 to 8; chair 1 is the host');
    END IF;
    IF (SELECT count(*) FROM unnest(seats) u(s) WHERE u.s IS NOT NULL)
       <> (SELECT count(DISTINCT u.s) FROM unnest(seats) u(s) WHERE u.s IS NOT NULL)
       OR cardinality(ids) <> (SELECT count(DISTINCT u.id) FROM unnest(ids) u(id)) THEN
      PERFORM wall_private.fail(400, 'validation_failed', 'One person per chair, and one chair per person');
    END IF;
  END IF;

  FOR k IN 1 .. cardinality(ids) LOOP
    CONTINUE WHEN ids[k] = b.created_by;
    s := CASE WHEN seats IS NULL THEN NULL ELSE seats[k] END;
    -- A chair held by someone else who has not declined is taken.
    IF s IS NOT NULL THEN
      SELECT x.display_name INTO taken FROM meeting_invites i JOIN people x ON x.id = i.person_id
       WHERE i.booking_id = b.id AND i.seat = s AND i.person_id <> ids[k];
      IF taken IS NOT NULL THEN
        PERFORM wall_private.fail(409, 'seat_taken', 'Chair ' || s || ' is taken by ' || taken);
      END IF;
    END IF;
    BEGIN
      INSERT INTO meeting_invites (booking_id, person_id, invited_by, seat)
        VALUES (b.id, ids[k], inviter.id, s)
        ON CONFLICT (booking_id, person_id) DO UPDATE
          SET seat = CASE WHEN EXCLUDED.seat IS NULL THEN meeting_invites.seat
                          WHEN meeting_invites.status = 'declined' OR meeting_invites.seat IS NULL THEN EXCLUDED.seat
                          ELSE meeting_invites.seat END,
              status = CASE WHEN EXCLUDED.seat IS NOT NULL AND meeting_invites.status = 'declined' THEN 'invited'
                            ELSE meeting_invites.status END,
              invited_by = CASE WHEN EXCLUDED.seat IS NOT NULL AND meeting_invites.status = 'declined' THEN EXCLUDED.invited_by
                                ELSE meeting_invites.invited_by END,
              updated_at = CASE WHEN EXCLUDED.seat IS NOT NULL AND (meeting_invites.status = 'declined' OR meeting_invites.seat IS NULL)
                                THEN now() ELSE meeting_invites.updated_at END;
    EXCEPTION WHEN unique_violation THEN
      PERFORM wall_private.fail(409, 'seat_taken', 'Chair ' || s || ' was just taken');
    END;
  END LOOP;

  IF b.room = 'black_box' AND
     (SELECT count(*) FROM meeting_invites WHERE booking_id = b.id AND status <> 'declined') > 7 THEN
    PERFORM wall_private.fail(409, 'table_full', 'The Black Box table seats the host and 7 more');
  END IF;
END $$;

-- A weekday a plan can be made for: today through the timetable's 14-day reach, Monday to Friday.
CREATE OR REPLACE FUNCTION wall_private.hq_office_day(d date) RETURNS date
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF d IS NULL THEN PERFORM wall_private.fail(400, 'validation_failed', 'day must be YYYY-MM-DD'); END IF;
  IF d < wall_private.hq_today() THEN PERFORM wall_private.fail(400, 'validation_failed', 'day must be today or later'); END IF;
  IF d >= wall_private.hq_today() + 14 THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'Plans reach two weeks ahead');
  END IF;
  IF extract(isodow FROM d) > 5 THEN PERFORM wall_private.fail(400, 'validation_failed', 'Office days are Monday to Friday'); END IF;
  RETURN d;
END $$;

CREATE OR REPLACE FUNCTION wall_private.hq_arrival_json(a arrivals) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', a.id,
    'name', (SELECT display_name FROM people WHERE id = a.person_id),
    'day', to_char(a.day, 'YYYY-MM-DD'), 'coming', a.coming, 'note', a.note,
    'arriveAt', to_char(a.arrive_at, 'HH24:MI'),
    'trip', CASE WHEN a.arrived_at IS NOT NULL THEN 'arrived' WHEN a.left_at IS NOT NULL THEN 'on_the_way' END,
    'leftAt', wall_private.iso(a.left_at), 'arrivedAt', wall_private.iso(a.arrived_at),
    'personId', a.person_id, 'updatedAt', wall_private.iso(a.updated_at))
$$;

/* --------------------------------------------------------- the rules -- */

-- Book a room, now with chairs for Black Box guests. Unchanged otherwise (008).
CREATE OR REPLACE FUNCTION wall_private.hq_book(cid uuid, me uuid, b_room text, b_id uuid, b_title text,
  b_start timestamptz, b_end timestamptz, b_note text, b_invite uuid[], b_seats smallint[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  t text;
  n text;
  rec bookings;
BEGIN
  IF b_room IS NULL OR b_room NOT IN ('black_box', 'ck_hall') THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'room must be black_box or ck_hall');
  END IF;
  t := wall_private.hq_text(b_title, CASE b_room WHEN 'black_box' THEN 'title' ELSE 'name' END, 120, true);
  n := wall_private.hq_text(b_note, 'note', 600, false);
  IF b_id IS NOT NULL THEN
    SELECT * INTO rec FROM bookings WHERE id = b_id;
    IF rec.id IS NOT NULL THEN
      IF rec.company_id <> cid OR rec.room <> b_room OR rec.created_by <> p.id THEN
        PERFORM wall_private.fail(409, 'id_conflict', 'A booking with this id cannot be created');
      END IF;
      RETURN wall_private.hq_booking_json(rec);
    END IF;
  END IF;
  PERFORM wall_private.hq_future_span(b_start, b_end);
  BEGIN
    INSERT INTO bookings (id, company_id, room, title, start_at, end_at, note, status, created_by)
      VALUES (coalesce(b_id, uuid_generate_v4()), cid, b_room, t, b_start, b_end, n,
              CASE b_room WHEN 'black_box' THEN 'active' ELSE 'requested' END, p.id)
      RETURNING * INTO rec;
  EXCEPTION WHEN exclusion_violation THEN
    PERFORM wall_private.fail(409, 'booking_conflict', 'Black Box is already booked for part of that time');
  END;
  PERFORM wall_private.hq_add_invites(cid, rec, p, b_invite, b_seats);
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- The booker, or anyone already invited, invites more names (optionally at chairs) while it is on.
CREATE OR REPLACE FUNCTION wall_private.hq_invite(cid uuid, me uuid, b_id uuid, ids uuid[],
  seats smallint[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  rec bookings := wall_private.hq_booking_for(cid, b_id);
BEGIN
  IF rec.created_by <> p.id AND NOT EXISTS (SELECT 1 FROM meeting_invites WHERE booking_id = rec.id AND person_id = p.id) THEN
    PERFORM wall_private.fail(403, 'forbidden', 'Only the booker or someone invited can invite');
  END IF;
  IF rec.status NOT IN ('active', 'requested', 'confirmed') OR rec.end_at <= now() THEN
    PERFORM wall_private.fail(409, 'invalid_state', 'This booking is over');
  END IF;
  IF ids IS NULL OR cardinality(ids) = 0 THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'invite must name at least one person');
  END IF;
  PERFORM wall_private.hq_add_invites(cid, rec, p, ids, seats);
  UPDATE bookings SET updated_at = now() WHERE id = rec.id RETURNING * INTO rec;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- Answer an invitation. Declining gives the chair back. Accepting again does not reclaim it.
CREATE OR REPLACE FUNCTION wall_private.hq_respond(cid uuid, me uuid, b_id uuid, response text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  rec bookings := wall_private.hq_booking_for(cid, b_id);
BEGIN
  IF response IS NULL OR response NOT IN ('accepted', 'declined') THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'response must be accepted or declined');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM meeting_invites WHERE booking_id = rec.id AND person_id = p.id) THEN
    PERFORM wall_private.fail(403, 'forbidden', 'You are not invited to this booking');
  END IF;
  IF rec.status NOT IN ('active', 'requested', 'confirmed') OR rec.end_at <= now() THEN
    PERFORM wall_private.fail(409, 'invalid_state', 'This booking is over');
  END IF;
  -- Accepting again after declining would push the table past 8 if every chair filled meanwhile.
  IF response = 'accepted' AND rec.room = 'black_box'
     AND (SELECT status FROM meeting_invites WHERE booking_id = rec.id AND person_id = p.id) = 'declined'
     AND (SELECT count(*) FROM meeting_invites WHERE booking_id = rec.id AND status <> 'declined') >= 7 THEN
    PERFORM wall_private.fail(409, 'table_full', 'The Black Box table is full');
  END IF;
  UPDATE meeting_invites SET status = response, updated_at = now(),
         seat = CASE WHEN response = 'declined' THEN NULL ELSE seat END
   WHERE booking_id = rec.id AND person_id = p.id;
  UPDATE bookings SET updated_at = now() WHERE id = rec.id RETURNING * INTO rec;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- Today's line (008), unchanged in shape: "not coming" now also clears the plan's time and the trip.
CREATE OR REPLACE FUNCTION wall_private.hq_mark_arrival(cid uuid, me uuid, a_coming boolean, a_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  n text;
  rec arrivals;
BEGIN
  IF a_coming IS NULL THEN PERFORM wall_private.fail(400, 'validation_failed', 'coming must be true or false'); END IF;
  n := wall_private.hq_text(a_note, 'note', 280, false);
  INSERT INTO arrivals (company_id, person_id, day, coming, note)
    VALUES (cid, p.id, wall_private.hq_today(), a_coming, n)
    ON CONFLICT (person_id, day) DO UPDATE SET coming = EXCLUDED.coming, note = EXCLUDED.note,
      arrive_at = CASE WHEN EXCLUDED.coming THEN arrivals.arrive_at END,
      left_at = CASE WHEN EXCLUDED.coming THEN arrivals.left_at END,
      arrived_at = CASE WHEN EXCLUDED.coming THEN arrivals.arrived_at END,
      updated_at = now()
    RETURNING * INTO rec;
  RETURN wall_private.hq_arrival_json(rec);
END $$;

-- Plan one weekday: coming or not, a note, and when you expect to arrive (Jakarta time).
CREATE OR REPLACE FUNCTION wall_private.hq_plan_day(cid uuid, me uuid, a_day date, a_coming boolean,
  a_note text, a_arrive time) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  d date := wall_private.hq_office_day(a_day);
  n text;
  rec arrivals;
BEGIN
  IF a_coming IS NULL THEN PERFORM wall_private.fail(400, 'validation_failed', 'coming must be true or false'); END IF;
  n := wall_private.hq_text(a_note, 'note', 280, false);
  INSERT INTO arrivals (company_id, person_id, day, coming, note, arrive_at)
    VALUES (cid, p.id, d, a_coming, n, CASE WHEN a_coming THEN a_arrive END)
    ON CONFLICT (person_id, day) DO UPDATE SET coming = EXCLUDED.coming, note = EXCLUDED.note,
      arrive_at = EXCLUDED.arrive_at,
      left_at = CASE WHEN EXCLUDED.coming THEN arrivals.left_at END,
      arrived_at = CASE WHEN EXCLUDED.coming THEN arrivals.arrived_at END,
      updated_at = now()
    RETURNING * INTO rec;
  RETURN wall_private.hq_arrival_json(rec);
END $$;

-- Today's trip in: on_the_way, arrived, or reset (back to coming in, not yet left).
-- On the way without a plan for today says "coming in" too.
CREATE OR REPLACE FUNCTION wall_private.hq_trip(cid uuid, me uuid, step text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  d date := wall_private.hq_today();
  rec arrivals;
BEGIN
  IF step IS NULL OR step NOT IN ('on_the_way', 'arrived', 'reset') THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'step must be on_the_way, arrived or reset');
  END IF;
  IF extract(isodow FROM d) > 5 THEN PERFORM wall_private.fail(400, 'validation_failed', 'Office days are Monday to Friday'); END IF;
  SELECT * INTO rec FROM arrivals WHERE person_id = p.id AND day = d FOR UPDATE;
  IF step = 'on_the_way' THEN
    INSERT INTO arrivals (company_id, person_id, day, coming, left_at)
      VALUES (cid, p.id, d, true, now())
      ON CONFLICT (person_id, day) DO UPDATE SET coming = true,
        left_at = coalesce(arrivals.left_at, now()), arrived_at = NULL, updated_at = now()
      RETURNING * INTO rec;
  ELSIF step = 'arrived' THEN
    IF rec.id IS NULL OR rec.left_at IS NULL THEN
      PERFORM wall_private.fail(409, 'invalid_state', 'Say you are on the way first');
    END IF;
    UPDATE arrivals SET arrived_at = coalesce(arrived_at, now()), updated_at = now() WHERE id = rec.id RETURNING * INTO rec;
  ELSE
    IF rec.id IS NULL THEN PERFORM wall_private.fail(409, 'invalid_state', 'Nothing to undo today'); END IF;
    UPDATE arrivals SET left_at = NULL, arrived_at = NULL, updated_at = now() WHERE id = rec.id RETURNING * INTO rec;
  END IF;
  RETURN wall_private.hq_arrival_json(rec);
END $$;

-- Repeat: the same plan on the same weekday a week later (inside the reach). Copies coming, note and time.
CREATE OR REPLACE FUNCTION wall_private.hq_repeat_day(cid uuid, me uuid, a_day date) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  d date := wall_private.hq_office_day(a_day);
  src arrivals;
BEGIN
  PERFORM wall_private.hq_office_day(d + 7);
  SELECT * INTO src FROM arrivals WHERE person_id = p.id AND day = d;
  IF src.id IS NULL THEN PERFORM wall_private.fail(409, 'invalid_state', 'Make a plan for this day first'); END IF;
  RETURN wall_private.hq_plan_day(cid, me, d + 7, src.coming, src.note, src.arrive_at);
END $$;

-- Every plan from today through the reach, in day then name order.
CREATE OR REPLACE FUNCTION wall_private.hq_list_plans(cid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(jsonb_agg(wall_private.hq_arrival_json(a) ORDER BY a.day, lower(x.display_name), a.id), '[]'::jsonb)
    FROM arrivals a JOIN people x ON x.id = a.person_id
   WHERE a.company_id = cid AND a.day >= wall_private.hq_today() AND a.day < wall_private.hq_today() + 14
$$;

-- The corridor snapshot (008) gains the plans of the reach. arrivals stays today's list.
CREATE OR REPLACE FUNCTION wall_private.hq_rooms(cid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  d date := wall_private.hq_today();
  day_from timestamptz := d::timestamp AT TIME ZONE 'Asia/Jakarta';
  reach timestamptz := (d + 14)::timestamp AT TIME ZONE 'Asia/Jakarta';
  list jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(wall_private.hq_booking_json(b) ORDER BY b.start_at, b.id), '[]'::jsonb) INTO list
    FROM bookings b
   WHERE b.company_id = cid AND b.status IN ('active', 'requested', 'confirmed') AND b.end_at > day_from
     AND (b.start_at < reach OR (b.end_at > now() AND EXISTS (SELECT 1 FROM meeting_invites i WHERE i.booking_id = b.id)));
  RETURN jsonb_build_object('now', wall_private.iso(now()), 'day', to_char(d, 'YYYY-MM-DD'), 'days', 14,
    'people', wall_private.hq_people(cid),
    'follows', wall_private.hq_follows(cid),
    'bookings', list,
    'arrivals', wall_private.hq_list_arrivals(cid),
    'plans', wall_private.hq_list_plans(cid));
END $$;

/* ------------------------------------------------- Data API wrappers -- */

CREATE OR REPLACE FUNCTION wall.book_black_box(me uuid, booking_id uuid, title text,
  start_at timestamptz, end_at timestamptz, note text DEFAULT NULL, invite uuid[] DEFAULT NULL,
  seats smallint[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_book(wall_private.company(), me, 'black_box', booking_id, title, start_at, end_at, note, invite, seats);
END $$;

CREATE OR REPLACE FUNCTION wall.request_ck_hall(me uuid, booking_id uuid, name text,
  start_at timestamptz, end_at timestamptz, note text DEFAULT NULL, invite uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_book(wall_private.company(), me, 'ck_hall', booking_id, name, start_at, end_at, note, invite);
END $$;

CREATE OR REPLACE FUNCTION wall.invite(me uuid, booking_id uuid, people uuid[], seats smallint[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_invite(wall_private.company(), me, booking_id, people, seats);
END $$;

CREATE OR REPLACE FUNCTION wall.plan_day(me uuid, day date, coming boolean, note text DEFAULT NULL,
  arrive_at time DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_plan_day(wall_private.company(), me, day, coming, note, arrive_at);
END $$;

CREATE OR REPLACE FUNCTION wall.trip(me uuid, step text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_trip(wall_private.company(), me, step);
END $$;

CREATE OR REPLACE FUNCTION wall.repeat_day(me uuid, day date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_repeat_day(wall_private.company(), me, day);
END $$;

CREATE OR REPLACE FUNCTION wall.list_plans() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_list_plans(wall_private.company());
END $$;

/* ------------------------------------------------------------- grants -- */

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wall, wall_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wall TO authenticated, anonymous;
