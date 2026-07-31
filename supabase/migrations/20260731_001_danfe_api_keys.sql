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
