BEGIN;

SET search_path = danfe, public, pg_catalog;

ALTER TABLE "NotaFiscal"
  ADD COLUMN IF NOT EXISTS "conferenciaTipo" TEXT,
  ADD COLUMN IF NOT EXISTS "conferenciaStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "conferenciaObservacao" TEXT,
  ADD COLUMN IF NOT EXISTS "conferenciaFonte" TEXT,
  ADD COLUMN IF NOT EXISTS "conferenciaAtualizadaEm" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "conferenciaDivergencia" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "NotaFiscal_cnpjId_conferenciaTipo_idx"
  ON "NotaFiscal"("cnpjId", "conferenciaTipo");

CREATE INDEX IF NOT EXISTS "NotaFiscal_cnpjId_conferenciaStatus_idx"
  ON "NotaFiscal"("cnpjId", "conferenciaStatus");

CREATE INDEX IF NOT EXISTS "NotaFiscal_cnpjId_conferenciaDivergencia_idx"
  ON "NotaFiscal"("cnpjId", "conferenciaDivergencia");

CREATE TABLE IF NOT EXISTS "ConferenciaNewshopPendente" (
  "id" SERIAL PRIMARY KEY,
  "chave" TEXT NOT NULL UNIQUE,
  "numero" TEXT,
  "emitidaEm" TIMESTAMP(3),
  "emitenteCnpj" TEXT,
  "emitenteNome" TEXT,
  "serie" TEXT,
  "uf" TEXT,
  "valorTotal" DOUBLE PRECISION,
  "valorIcms" DOUBLE PRECISION,
  "situacaoNfe" TEXT,
  "tipo" TEXT,
  "status" TEXT,
  "observacao" TEXT,
  "fonte" TEXT,
  "motivo" TEXT,
  "importadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ConferenciaNewshopPendente_importadaEm_idx"
  ON "ConferenciaNewshopPendente"("importadaEm");

CREATE INDEX IF NOT EXISTS "ConferenciaNewshopPendente_status_idx"
  ON "ConferenciaNewshopPendente"("status");

CREATE INDEX IF NOT EXISTS "ConferenciaNewshopPendente_tipo_idx"
  ON "ConferenciaNewshopPendente"("tipo");

COMMIT;
