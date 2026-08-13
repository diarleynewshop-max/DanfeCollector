BEGIN;

SET search_path = danfe, public, pg_catalog;

ALTER TABLE "NotaFiscal"
  ADD COLUMN IF NOT EXISTS "recebimentoStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "recebimentoKanbanStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "recebimentoStatusOperacional" TEXT,
  ADD COLUMN IF NOT EXISTS "recebimentoStatusOperacionalCodigo" TEXT,
  ADD COLUMN IF NOT EXISTS "recebimentoAtualizadoEm" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recebimentoAtualizadoPor" TEXT,
  ADD COLUMN IF NOT EXISTS "recebimentoConsultadoEm" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recebimentoErro" TEXT;

CREATE INDEX IF NOT EXISTS "NotaFiscal_cnpjId_recebimentoStatus_idx"
  ON "NotaFiscal" ("cnpjId", "recebimentoStatus");

COMMIT;
