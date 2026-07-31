BEGIN;

SET search_path = danfe, public, pg_catalog;

CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id" SERIAL PRIMARY KEY,
  "nome" TEXT NOT NULL,
  "prefixo" TEXT NOT NULL UNIQUE,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "ultimoUsoEm" TIMESTAMP(3),
  "criadaPorId" INTEGER,
  "criadaPorLogin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "ApiKey_ativo_idx" ON "ApiKey"("ativo");

-- Esta tabela e usada somente pelo servidor Next/Prisma. Nao deve ficar
-- acessivel pela API REST do Supabase.
ALTER TABLE "ApiKey" DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "ApiKey" FROM PUBLIC;
REVOKE ALL ON TABLE "ApiKey" FROM anon;
REVOKE ALL ON TABLE "ApiKey" FROM authenticated;
REVOKE ALL ON TABLE "ApiKey" FROM danfe_api;
REVOKE ALL ON SEQUENCE "ApiKey_id_seq" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "ApiKey_id_seq" FROM anon;
REVOKE ALL ON SEQUENCE "ApiKey_id_seq" FROM authenticated;
REVOKE ALL ON SEQUENCE "ApiKey_id_seq" FROM danfe_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ApiKey" TO danfe_prisma;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "ApiKey_id_seq" TO danfe_prisma;
GRANT ALL PRIVILEGES ON TABLE "ApiKey" TO service_role;
GRANT ALL PRIVILEGES ON SEQUENCE "ApiKey_id_seq" TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ApiKey_criadaPorId_fkey'
      AND conrelid = '"ApiKey"'::regclass
  ) THEN
    ALTER TABLE "ApiKey"
      ADD CONSTRAINT "ApiKey_criadaPorId_fkey"
      FOREIGN KEY ("criadaPorId") REFERENCES "Usuario"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
