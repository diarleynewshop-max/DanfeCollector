-- Dedicated PostgREST role for Danfe. It deliberately has no privileges over
-- public, where SCAN and Catalogo live.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danfe_api') THEN
    CREATE ROLE danfe_api NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT danfe_api TO authenticator;

REVOKE ALL ON SCHEMA danfe FROM PUBLIC;
GRANT USAGE ON SCHEMA danfe TO danfe_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA danfe TO danfe_api;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA danfe TO danfe_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA danfe TO danfe_api;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA danfe
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO danfe_api;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA danfe
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO danfe_api;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA danfe
  GRANT EXECUTE ON FUNCTIONS TO danfe_api;

GRANT USAGE ON SCHEMA storage TO danfe_api;
GRANT SELECT ON storage.buckets TO danfe_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO danfe_api;

DROP POLICY IF EXISTS danfe_api_storage_objects ON storage.objects;
CREATE POLICY danfe_api_storage_objects
ON storage.objects
FOR ALL
TO danfe_api
USING (bucket_id IN ('danfe-xml', 'danfe-anexos'))
WITH CHECK (bucket_id IN ('danfe-xml', 'danfe-anexos'));

COMMIT;
