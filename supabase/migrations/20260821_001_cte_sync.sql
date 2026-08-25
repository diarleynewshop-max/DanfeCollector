ALTER TABLE "Cnpj"
  ADD COLUMN IF NOT EXISTS "ultimoNsuCte" TEXT NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "maxNsuCte" TEXT NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "situacaoCte" TEXT NOT NULL DEFAULT 'Nunca sincronizado',
  ADD COLUMN IF NOT EXISTS "ultimaBuscaCte" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bloqueadoAteCte" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ConhecimentoTransporte" (
  "id" SERIAL PRIMARY KEY,
  "chave" TEXT NOT NULL UNIQUE,
  "nsu" TEXT,
  "numero" TEXT,
  "serie" TEXT,
  "emitidaEm" TIMESTAMP(3) NOT NULL,
  "naturezaOp" TEXT,
  "cfop" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RESUMO',
  "situacaoSefaz" TEXT NOT NULL DEFAULT 'AUTORIZADO',
  "emitenteNome" TEXT,
  "emitenteCnpj" TEXT,
  "emitenteIe" TEXT,
  "emitenteUf" TEXT,
  "tomadorNome" TEXT,
  "tomadorCnpj" TEXT,
  "remetenteNome" TEXT,
  "remetenteCnpj" TEXT,
  "destinatarioNome" TEXT,
  "destinatarioCnpj" TEXT,
  "valorTotal" DOUBLE PRECISION,
  "valorPrestacao" DOUBLE PRECISION,
  "valorCarga" DOUBLE PRECISION,
  "nfeChavePrincipal" TEXT,
  "xmlPath" TEXT,
  "xmlStorageKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cnpjId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "ConhecimentoTransporteNfe" (
  "id" SERIAL PRIMARY KEY,
  "cteId" INTEGER NOT NULL,
  "chaveNfe" TEXT NOT NULL,
  CONSTRAINT "ConhecimentoTransporteNfe_cteId_chaveNfe_key" UNIQUE ("cteId", "chaveNfe")
);

CREATE INDEX IF NOT EXISTS "ConhecimentoTransporte_cnpjId_emitidaEm_idx"
  ON "ConhecimentoTransporte" ("cnpjId", "emitidaEm" DESC);
CREATE INDEX IF NOT EXISTS "ConhecimentoTransporte_cnpjId_nfeChavePrincipal_idx"
  ON "ConhecimentoTransporte" ("cnpjId", "nfeChavePrincipal");
CREATE INDEX IF NOT EXISTS "ConhecimentoTransporteNfe_chaveNfe_idx"
  ON "ConhecimentoTransporteNfe" ("chaveNfe");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConhecimentoTransporte_cnpjId_fkey') THEN
    ALTER TABLE "ConhecimentoTransporte" ADD CONSTRAINT "ConhecimentoTransporte_cnpjId_fkey"
      FOREIGN KEY ("cnpjId") REFERENCES "Cnpj"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConhecimentoTransporteNfe_cteId_fkey') THEN
    ALTER TABLE "ConhecimentoTransporteNfe" ADD CONSTRAINT "ConhecimentoTransporteNfe_cteId_fkey"
      FOREIGN KEY ("cteId") REFERENCES "ConhecimentoTransporte"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ConhecimentoTransporte" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "ConhecimentoTransporteNfe" DISABLE ROW LEVEL SECURITY;
