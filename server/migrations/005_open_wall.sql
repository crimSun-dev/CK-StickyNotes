-- 005_open_wall: the public page uses Neon's anonymous token. No office password.
-- A signed-in account that is not in wall_members still gets nothing.
-- Idempotent: CREATE OR REPLACE and GRANT.

CREATE OR REPLACE FUNCTION wall_private.company() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  uid text := auth.user_id();
  cid uuid;
BEGIN
  IF uid IS NOT NULL AND uid <> 'anonymous' THEN
    SELECT company_id INTO cid FROM wall_members WHERE user_id = uid;
    IF cid IS NULL THEN
      PERFORM wall_private.fail(403, 'not_a_member', 'This account is not allowed on the wall');
    END IF;
    RETURN cid;
  END IF;
  SELECT id INTO cid FROM companies WHERE slug = 'kmk';
  IF cid IS NULL THEN
    PERFORM wall_private.fail(403, 'not_a_member', 'This account is not allowed on the wall');
  END IF;
  RETURN cid;
END $$;

GRANT USAGE ON SCHEMA wall TO anonymous;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wall TO anonymous;
