-- Modulo de confronto SPED Fiscal x XML (SpedFiscalImportacao/SpedDivergencia).
-- Novo par de tabelas, sem impacto no que ja existe.

BEGIN;

SET search_path = danfe, public, pg_catalog;

CREATE TABLE IF NOT EXISTS "SpedFiscalImportacao" (
  "id" SERIAL PRIMARY KEY,
  "cnpjId" INTEGER NOT NULL,
  "periodo" TEXT NOT NULL,
  "dtInicio" TIMESTAMP(3) NOT NULL,
  "dtFim" TIMESTAMP(3) NOT NULL,
  "finalidade" TEXT NOT NULL,
  "versaoLayout" TEXT NOT NULL,
  "arquivoNome" TEXT NOT NULL,
  "storageKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'IMPORTADO',
  "totalRegistros" INTEGER,
  "totalC100" INTEGER,
  "totalC170" INTEGER,
  "totalParticipantes" INTEGER,
  "totalProdutos" INTEGER,
  "resumoDivergencias" TEXT,
  "erroMensagem" TEXT,
  "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confrontadoEm" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpedFiscalImportacao_cnpjId_periodo_finalidade_key" UNIQUE ("cnpjId", "periodo", "finalidade")
);

CREATE TABLE IF NOT EXISTS "SpedDivergencia" (
  "id" SERIAL PRIMARY KEY,
  "importacaoId" INTEGER NOT NULL,
  "tipo" TEXT NOT NULL,
  "severidade" TEXT NOT NULL,
  "codigoRegra" TEXT NOT NULL,
  "chaveNfe" TEXT,
  "registroSped" TEXT,
  "linhaSped" INTEGER,
  "campo" TEXT,
  "valorSped" TEXT,
  "valorDanfe" TEXT,
  "descricao" TEXT NOT NULL,
  "participanteCod" TEXT,
  "produtoCod" TEXT,
  "fornecedorNome" TEXT,
  "fornecedorCnpj" TEXT,
  "resolvida" BOOLEAN NOT NULL DEFAULT false,
  "resolvidaEm" TIMESTAMP(3),
  "resolvidaPor" TEXT,
  "observacao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "SpedFiscalImportacao_cnpjId_periodo_idx"
  ON "SpedFiscalImportacao" ("cnpjId", "periodo");
CREATE INDEX IF NOT EXISTS "SpedFiscalImportacao_status_idx"
  ON "SpedFiscalImportacao" ("status");

CREATE INDEX IF NOT EXISTS "SpedDivergencia_importacaoId_tipo_idx"
  ON "SpedDivergencia" ("importacaoId", "tipo");
CREATE INDEX IF NOT EXISTS "SpedDivergencia_importacaoId_severidade_idx"
  ON "SpedDivergencia" ("importacaoId", "severidade");
CREATE INDEX IF NOT EXISTS "SpedDivergencia_importacaoId_resolvida_idx"
  ON "SpedDivergencia" ("importacaoId", "resolvida");
CREATE INDEX IF NOT EXISTS "SpedDivergencia_chaveNfe_idx"
  ON "SpedDivergencia" ("chaveNfe");
CREATE INDEX IF NOT EXISTS "SpedDivergencia_fornecedorCnpj_idx"
  ON "SpedDivergencia" ("fornecedorCnpj");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SpedFiscalImportacao_cnpjId_fkey') THEN
    ALTER TABLE "SpedFiscalImportacao" ADD CONSTRAINT "SpedFiscalImportacao_cnpjId_fkey"
      FOREIGN KEY ("cnpjId") REFERENCES "Cnpj"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SpedDivergencia_importacaoId_fkey') THEN
    ALTER TABLE "SpedDivergencia" ADD CONSTRAINT "SpedDivergencia_importacaoId_fkey"
      FOREIGN KEY ("importacaoId") REFERENCES "SpedFiscalImportacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
