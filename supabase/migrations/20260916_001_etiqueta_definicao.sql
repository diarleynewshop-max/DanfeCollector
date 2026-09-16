-- Cor de cada etiqueta (preset ou personalizada). NotaFiscal.etiqueta continua
-- sendo a lista (CSV) de nomes de etiqueta aplicados a cada nota; esta tabela
-- so guarda a cor de exibicao de cada nome, criada sob demanda quando o
-- usuario cria uma etiqueta nova na tela da nota (sugestao vem do circulo
-- cromatico, calculada no app).

BEGIN;

SET search_path = danfe, public, pg_catalog;

CREATE TABLE IF NOT EXISTS "EtiquetaDefinicao" (
  "nome" TEXT PRIMARY KEY,
  "cor" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Mesma decisao da SyncWorkerStatus: sem policy de sessao de usuario, o app
-- server-side grava/le direto.
ALTER TABLE "EtiquetaDefinicao" DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danfe_prisma') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EtiquetaDefinicao" TO danfe_prisma;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'danfe') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EtiquetaDefinicao" TO danfe;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EtiquetaDefinicao" TO service_role;
  END IF;
END $$;

COMMIT;
