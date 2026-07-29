-- Runtime database role for the Danfe Next.js server on Vercel.
-- The LOGIN password is installed separately by configurar-danfe-prisma-role-vps.sh.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danfe_prisma') THEN
    CREATE ROLE danfe_prisma
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END;
$$;

REVOKE ALL PRIVILEGES ON DATABASE postgres FROM danfe_prisma;
GRANT CONNECT ON DATABASE postgres TO danfe_prisma;

REVOKE ALL ON SCHEMA danfe FROM PUBLIC;
GRANT USAGE ON SCHEMA danfe TO danfe_prisma;
ALTER ROLE danfe_prisma SET search_path = danfe, public;

REVOKE ALL ON ALL TABLES IN SCHEMA danfe FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA danfe FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA danfe TO danfe_prisma;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA danfe TO danfe_prisma;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA danfe
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO danfe_prisma;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA danfe
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO danfe_prisma;
