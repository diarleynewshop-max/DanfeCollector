-- Estado operacional do worker SEFAZ e dos alertas de sincronizacao.
-- O registro e singleton (id=1) para permitir diagnostico mesmo quando o
-- processo do worker estiver parado.

BEGIN;

SET search_path = danfe, public, pg_catalog;

CREATE TABLE IF NOT EXISTS "SyncWorkerStatus" (
  "id" INTEGER PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "status" TEXT NOT NULL DEFAULT 'AGUARDANDO',
  "iniciadoEm" TIMESTAMP(3),
  "ultimoFimEm" TIMESTAMP(3),
  "ultimoSucessoEm" TIMESTAMP(3),
  "ultimoErroEm" TIMESTAMP(3),
  "ultimaMensagem" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "SyncWorkerStatus" ("id", "status")
VALUES (1, 'AGUARDANDO')
ON CONFLICT ("id") DO NOTHING;

-- Esta tabela e acessada somente pelo servidor/worker. O role do app nao deve
-- depender de sessao de usuario ou de policy de browser para gravar heartbeat.
ALTER TABLE "SyncWorkerStatus" DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danfe_prisma') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SyncWorkerStatus" TO danfe_prisma;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danfe') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SyncWorkerStatus" TO danfe;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SyncWorkerStatus" TO service_role;
  END IF;
END $$;

COMMIT;
