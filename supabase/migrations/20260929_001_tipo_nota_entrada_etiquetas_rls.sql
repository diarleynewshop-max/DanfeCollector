BEGIN;

SET search_path = danfe, public, pg_catalog;

ALTER TABLE "NotaFiscal"
  ADD COLUMN IF NOT EXISTS "tipoNotaEntrada" TEXT,
  ADD COLUMN IF NOT EXISTS "tipoNotaEntradaOrigem" TEXT;

-- Esta tabela e acessada somente pelo servidor via Prisma. Remova RLS residual
-- em bancos onde a migration original foi aplicada com a tabela protegida.
ALTER TABLE "EtiquetaDefinicao" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "EtiquetaDefinicao" DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danfe_prisma') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EtiquetaDefinicao" TO danfe_prisma;
    GRANT SELECT, INSERT, UPDATE ON "NotaFiscal" TO danfe_prisma;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danfe') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EtiquetaDefinicao" TO danfe;
    GRANT SELECT, INSERT, UPDATE ON "NotaFiscal" TO danfe;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EtiquetaDefinicao" TO service_role;
    GRANT SELECT, INSERT, UPDATE ON "NotaFiscal" TO service_role;
  END IF;
END $$;

COMMIT;
