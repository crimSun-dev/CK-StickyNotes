-- 008_hub_guests: names instead of codes, invitations, follows, and note authors.
--
-- people becomes the hub's shared names list. Anyone adds a guest name or picks one; the caller
-- names themselves with `me` (a person id) on every call. Person ids are no longer secrets, so
-- bookings and arrivals are returned whole and the page works out what is "mine". Until sign-in
-- exists a name is not proof: rules that depend on who you are (cancel your own meeting, answer
-- your own invitation, hall approval) are honor-system. Only hall_operator remains a role, set by
-- the office (scripts/add-person.js).
--
-- Bookings may not start before the current minute, and days before today are not listed.
-- The overlap rule of 007 is unchanged.
-- Idempotent: safe to run twice.

/* ------------------------------------------------------------- tables -- */

ALTER TABLE people DROP CONSTRAINT IF EXISTS people_role_check;
UPDATE people SET role = 'guest' WHERE role IN ('visitor', 'staff');
ALTER TABLE people ALTER COLUMN role SET DEFAULT 'guest';
ALTER TABLE people ADD CONSTRAINT people_role_check CHECK (role IN ('guest', 'hall_operator'));
-- One "Dewi" per company: adding a name that exists picks it.
CREATE UNIQUE INDEX IF NOT EXISTS people_name_per_company ON people (company_id, lower(display_name));

CREATE TABLE IF NOT EXISTS meeting_invites (
  booking_id UUID NOT NULL REFERENCES bookings(id),
  person_id  UUID NOT NULL REFERENCES people(id),
  status     TEXT NOT NULL DEFAULT 'invited' CONSTRAINT meeting_invites_status_check
               CHECK (status IN ('invited', 'accepted', 'declined')),
  invited_by UUID NOT NULL REFERENCES people(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, person_id)
);

CREATE TABLE IF NOT EXISTS follows (
  person_id  UUID NOT NULL REFERENCES people(id),
  follows_id UUID NOT NULL REFERENCES people(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, follows_id),
  CONSTRAINT follows_not_self CHECK (person_id <> follows_id)
);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES people(id);

ALTER TABLE meeting_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON meeting_invites, follows FROM authenticated, anonymous;

/* ------------------------------------- functions whose shape changes -- */

DROP FUNCTION IF EXISTS wall.hub_join(text);
DROP FUNCTION IF EXISTS wall.hub_me(uuid);
DROP FUNCTION IF EXISTS wall.hub_rooms(uuid);
DROP FUNCTION IF EXISTS wall.list_bookings(uuid, text, date);
DROP FUNCTION IF EXISTS wall.book_black_box(uuid, uuid, text, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS wall.request_ck_hall(uuid, uuid, text, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS wall.list_arrivals(uuid);
DROP FUNCTION IF EXISTS wall.create_note(uuid, text, text);
DROP FUNCTION IF EXISTS wall_private.hq_view(jsonb, people);
DROP FUNCTION IF EXISTS wall_private.hq_arrival_view(jsonb, people);
DROP FUNCTION IF EXISTS wall_private.hq_join(uuid, text);
DROP FUNCTION IF EXISTS wall_private.hq_list_bookings(uuid, uuid, text, date);
DROP FUNCTION IF EXISTS wall_private.hq_book_black_box(uuid, uuid, uuid, text, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS wall_private.hq_request_ck_hall(uuid, uuid, uuid, text, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS wall_private.hq_list_arrivals(uuid, uuid);
DROP FUNCTION IF EXISTS wall_private.hq_rooms(uuid, uuid);

/* ------------------------------------------------------------ helpers -- */

-- The caller's name on this company, or 401 when me names no one.
CREATE OR REPLACE FUNCTION wall_private.hq_require(cid uuid, me uuid) RETURNS people
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_person(cid, me);
BEGIN
  IF p.id IS NULL THEN PERFORM wall_private.fail(401, 'person_required', 'Pick or add your name first'); END IF;
  RETURN p;
END $$;

-- A span to book: end after start, and not starting before the current minute.
CREATE OR REPLACE FUNCTION wall_private.hq_future_span(s timestamptz, e timestamptz) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM wall_private.hq_span(s, e);
  IF s < date_trunc('minute', now()) THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'start must not be in the past');
  END IF;
END $$;

-- A day to show: today or later in Asia/Jakarta.
CREATE OR REPLACE FUNCTION wall_private.hq_day(d date) RETURNS date
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF coalesce(d, wall_private.hq_today()) < wall_private.hq_today() THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'day must be today or later');
  END IF;
  RETURN coalesce(d, wall_private.hq_today());
END $$;

-- The whole booking with its invitations. Returned to everyone.
CREATE OR REPLACE FUNCTION wall_private.hq_booking_json(b bookings) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', b.id, 'room', b.room, 'title', b.title,
    'startAt', wall_private.iso(b.start_at), 'endAt', wall_private.iso(b.end_at),
    'note', b.note, 'status', b.status,
    'byName', (SELECT display_name FROM people WHERE id = b.created_by),
    'createdBy', b.created_by,
    'invites', coalesce((SELECT jsonb_agg(jsonb_build_object('personId', i.person_id, 'name', x.display_name, 'status', i.status)
                                          ORDER BY lower(x.display_name), x.id)
                           FROM meeting_invites i JOIN people x ON x.id = i.person_id
                          WHERE i.booking_id = b.id), '[]'::jsonb),
    'createdAt', wall_private.iso(b.created_at), 'updatedAt', wall_private.iso(b.updated_at))
$$;

CREATE OR REPLACE FUNCTION wall_private.note_json(n notes) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', n.id, 'body', n.body, 'color', n.color,
    'revision', n.revision,
    'authorId', n.author_id,
    'authorName', (SELECT display_name FROM people WHERE id = n.author_id),
    'createdAt', wall_private.iso(n.created_at), 'updatedAt', wall_private.iso(n.updated_at))
$$;

-- Invite names into a booking. Names already invited, and the booker, are left as they are.
CREATE OR REPLACE FUNCTION wall_private.hq_add_invites(cid uuid, b bookings, inviter people, ids uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ids IS NULL OR cardinality(ids) = 0 THEN RETURN; END IF;
  IF cardinality(ids) > 50 OR array_position(ids, NULL) IS NOT NULL OR EXISTS (
       SELECT 1 FROM unnest(ids) u(id) WHERE NOT EXISTS (SELECT 1 FROM people WHERE id = u.id AND company_id = cid)) THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'invite must name up to 50 people on the hub');
  END IF;
  INSERT INTO meeting_invites (booking_id, person_id, invited_by)
    SELECT b.id, u.id, inviter.id FROM (SELECT DISTINCT id FROM unnest(ids) u(id)) u
     WHERE u.id <> b.created_by
    ON CONFLICT (booking_id, person_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION wall_private.hq_booking_for(cid uuid, b_id uuid) RETURNS bookings
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  rec bookings;
BEGIN
  SELECT * INTO rec FROM bookings WHERE id = b_id AND company_id = cid;
  IF rec.id IS NULL THEN PERFORM wall_private.fail(404, 'not_found', 'Booking not found'); END IF;
  RETURN rec;
END $$;

/* --------------------------------------------------------- the rules -- */

CREATE OR REPLACE FUNCTION wall_private.hq_people(cid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(jsonb_agg(wall_private.hq_person_json(p) ORDER BY lower(p.display_name), p.id), '[]'::jsonb)
    FROM people p WHERE p.company_id = cid
$$;

-- Add a guest name, or pick the one that already has this name.
CREATE OR REPLACE FUNCTION wall_private.hq_add_person(cid uuid, p_name text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  t text := wall_private.hq_text(p_name, 'displayName', 60, true);
  rec people;
BEGIN
  INSERT INTO people (company_id, display_name) VALUES (cid, t)
    ON CONFLICT (company_id, lower(display_name)) DO NOTHING
    RETURNING * INTO rec;
  IF rec.id IS NULL THEN
    SELECT * INTO rec FROM people WHERE company_id = cid AND lower(display_name) = lower(t);
  END IF;
  RETURN wall_private.hq_person_json(rec);
END $$;

-- Bookings of one room that touch one Jakarta day (today or later), in start order.
CREATE OR REPLACE FUNCTION wall_private.hq_list_bookings(cid uuid, b_room text, b_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  d date := wall_private.hq_day(b_day);
  day_from timestamptz := d::timestamp AT TIME ZONE 'Asia/Jakarta';
  day_to timestamptz := (d + 1)::timestamp AT TIME ZONE 'Asia/Jakarta';
  out jsonb;
BEGIN
  IF b_room IS NULL OR b_room NOT IN ('black_box', 'ck_hall') THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'room must be black_box or ck_hall');
  END IF;
  SELECT coalesce(jsonb_agg(wall_private.hq_booking_json(b) ORDER BY b.start_at, b.id), '[]'::jsonb) INTO out
    FROM bookings b
   WHERE b.company_id = cid AND b.room = b_room
     AND b.start_at < day_to AND b.end_at > day_from
     AND b.status IN ('active', 'requested', 'confirmed');
  RETURN out;
END $$;

-- Book a room: a Black Box meeting is active at once; a CK Hall booking starts as a request.
CREATE OR REPLACE FUNCTION wall_private.hq_book(cid uuid, me uuid, b_room text, b_id uuid, b_title text,
  b_start timestamptz, b_end timestamptz, b_note text, b_invite uuid[]) RETURNS jsonb
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
  -- A retry with the same id hands back the stored booking instead of booking twice.
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
  PERFORM wall_private.hq_add_invites(cid, rec, p, b_invite);
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- Only the booker cancels a Black Box meeting. Cancelling twice is not an error.
CREATE OR REPLACE FUNCTION wall_private.hq_cancel_black_box(cid uuid, me uuid, b_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  rec bookings := wall_private.hq_booking_for(cid, b_id);
BEGIN
  IF rec.room <> 'black_box' THEN PERFORM wall_private.fail(404, 'not_found', 'Meeting not found'); END IF;
  IF rec.created_by <> p.id THEN PERFORM wall_private.fail(403, 'forbidden', 'Only the person who booked it can cancel it'); END IF;
  UPDATE bookings SET status = 'cancelled', updated_at = now()
   WHERE id = rec.id AND status = 'active' RETURNING * INTO rec;
  IF rec.id IS NULL THEN rec := wall_private.hq_booking_for(cid, b_id); END IF;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- confirm / decline: hall operators. cancel: a hall operator or the booker.
CREATE OR REPLACE FUNCTION wall_private.hq_decide_ck_hall(cid uuid, me uuid, b_id uuid, decision text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  target text;
  rec bookings;
BEGIN
  target := CASE decision WHEN 'confirm' THEN 'confirmed' WHEN 'decline' THEN 'declined' WHEN 'cancel' THEN 'cancelled' END;
  IF target IS NULL THEN PERFORM wall_private.fail(400, 'validation_failed', 'decision must be confirm, decline or cancel'); END IF;
  SELECT * INTO rec FROM bookings WHERE id = b_id AND company_id = cid AND room = 'ck_hall' FOR UPDATE;
  IF rec.id IS NULL THEN PERFORM wall_private.fail(404, 'not_found', 'Hall booking not found'); END IF;
  IF p.role <> 'hall_operator' AND NOT (target = 'cancelled' AND rec.created_by = p.id) THEN
    PERFORM wall_private.fail(403, 'forbidden', 'Only a hall operator can do this');
  END IF;
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

-- The booker, or anyone already invited, invites more names while the booking is still on.
CREATE OR REPLACE FUNCTION wall_private.hq_invite(cid uuid, me uuid, b_id uuid, ids uuid[]) RETURNS jsonb
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
  PERFORM wall_private.hq_add_invites(cid, rec, p, ids);
  UPDATE bookings SET updated_at = now() WHERE id = rec.id RETURNING * INTO rec;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- An invited name accepts (joins) or declines, and may change their answer until it ends.
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
  UPDATE meeting_invites SET status = response, updated_at = now() WHERE booking_id = rec.id AND person_id = p.id;
  UPDATE bookings SET updated_at = now() WHERE id = rec.id RETURNING * INTO rec;
  RETURN wall_private.hq_booking_json(rec);
END $$;

-- One row per name per Jakarta day: saying it again updates the row.
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
    ON CONFLICT (person_id, day) DO UPDATE SET coming = EXCLUDED.coming, note = EXCLUDED.note, updated_at = now()
    RETURNING * INTO rec;
  RETURN wall_private.hq_arrival_json(rec);
END $$;

CREATE OR REPLACE FUNCTION wall_private.hq_list_arrivals(cid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(jsonb_agg(wall_private.hq_arrival_json(a) ORDER BY lower(x.display_name), a.id), '[]'::jsonb)
    FROM arrivals a JOIN people x ON x.id = a.person_id
   WHERE a.company_id = cid AND a.day = wall_private.hq_today()
$$;

CREATE OR REPLACE FUNCTION wall_private.hq_follows(cid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('personId', f.person_id, 'followsId', f.follows_id)
                            ORDER BY f.person_id, f.follows_id), '[]'::jsonb)
    FROM follows f JOIN people x ON x.id = f.person_id
   WHERE x.company_id = cid
$$;

-- Follow (on) or unfollow another name. Answers with who me follows now.
CREATE OR REPLACE FUNCTION wall_private.hq_follow(cid uuid, me uuid, target uuid, f_on boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  p people := wall_private.hq_require(cid, me);
  out jsonb;
BEGIN
  IF target IS NULL OR NOT EXISTS (SELECT 1 FROM people WHERE id = target AND company_id = cid) THEN
    PERFORM wall_private.fail(404, 'not_found', 'No one on the hub has this name');
  END IF;
  IF target = p.id THEN PERFORM wall_private.fail(400, 'validation_failed', 'You cannot follow yourself'); END IF;
  IF coalesce(f_on, true) THEN
    INSERT INTO follows (person_id, follows_id) VALUES (p.id, target) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM follows WHERE person_id = p.id AND follows_id = target;
  END IF;
  SELECT coalesce(jsonb_agg(f.follows_id ORDER BY f.follows_id), '[]'::jsonb) INTO out FROM follows f WHERE f.person_id = p.id;
  RETURN jsonb_build_object('personId', p.id, 'follows', out);
END $$;

-- Everything the corridor needs: the names, follows, today's arrivals, and the bookings of both rooms
-- for the next 14 Jakarta days (the timetable's reach), plus any later booking that has invitations
-- (so they reach the invitees' notices). now is the database clock, so pages can correct their own.
-- Used by the /v1/live hello and the Pages poller.
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
    'arrivals', wall_private.hq_list_arrivals(cid));
END $$;

/* ------------------------------------------------- Data API wrappers -- */
-- me is the caller's hub name (a person id), kept by the page.

CREATE OR REPLACE FUNCTION wall.hub_people() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_people(wall_private.company());
END $$;

CREATE OR REPLACE FUNCTION wall.hub_add_person(display_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_add_person(wall_private.company(), display_name);
END $$;

CREATE OR REPLACE FUNCTION wall.hub_rooms() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_rooms(wall_private.company());
END $$;

CREATE OR REPLACE FUNCTION wall.list_bookings(room text, day date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_list_bookings(wall_private.company(), room, day);
END $$;

CREATE OR REPLACE FUNCTION wall.book_black_box(me uuid, booking_id uuid, title text,
  start_at timestamptz, end_at timestamptz, note text DEFAULT NULL, invite uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_book(wall_private.company(), me, 'black_box', booking_id, title, start_at, end_at, note, invite);
END $$;

CREATE OR REPLACE FUNCTION wall.request_ck_hall(me uuid, booking_id uuid, name text,
  start_at timestamptz, end_at timestamptz, note text DEFAULT NULL, invite uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_book(wall_private.company(), me, 'ck_hall', booking_id, name, start_at, end_at, note, invite);
END $$;

CREATE OR REPLACE FUNCTION wall.cancel_black_box(me uuid, booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_cancel_black_box(wall_private.company(), me, booking_id);
END $$;

CREATE OR REPLACE FUNCTION wall.decide_ck_hall(me uuid, booking_id uuid, decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_decide_ck_hall(wall_private.company(), me, booking_id, decision);
END $$;

CREATE OR REPLACE FUNCTION wall.invite(me uuid, booking_id uuid, people uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_invite(wall_private.company(), me, booking_id, people);
END $$;

CREATE OR REPLACE FUNCTION wall.respond(me uuid, booking_id uuid, response text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_respond(wall_private.company(), me, booking_id, response);
END $$;

CREATE OR REPLACE FUNCTION wall.mark_arrival(me uuid, coming boolean, note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_mark_arrival(wall_private.company(), me, coming, note);
END $$;

CREATE OR REPLACE FUNCTION wall.list_arrivals() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_list_arrivals(wall_private.company());
END $$;

CREATE OR REPLACE FUNCTION wall.follow(me uuid, person_id uuid, follow boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN wall_private.hq_follow(wall_private.company(), me, person_id, follow);
END $$;

-- POST /v1/notes, now with the author's hub name. Idempotent on note_id, as in 003.
CREATE OR REPLACE FUNCTION wall.create_note(note_id uuid, note_body text, note_color text DEFAULT NULL,
  author_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cid uuid := wall_private.company();
  t text := wall_private.clean_body(note_body);
  rec notes;
BEGIN
  PERFORM wall_private.check_color(note_color);
  IF author_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people WHERE id = author_id AND company_id = cid) THEN
    PERFORM wall_private.fail(400, 'validation_failed', 'authorId must be a name on the hub');
  END IF;
  INSERT INTO notes (id, company_id, body, color, author_id)
    VALUES (coalesce(note_id, uuid_generate_v4()), cid, t, note_color, author_id)
    ON CONFLICT (id) DO NOTHING RETURNING * INTO rec;
  IF rec.id IS NULL THEN
    SELECT * INTO rec FROM notes WHERE id = note_id AND company_id = cid AND deleted_at IS NULL;
    IF rec.id IS NULL THEN PERFORM wall_private.fail(409, 'id_conflict', 'A note with this id cannot be created'); END IF;
  END IF;
  RETURN wall_private.note_json(rec);
END $$;

/* ------------------------------------------------------------- grants -- */

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wall, wall_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wall TO authenticated, anonymous;
