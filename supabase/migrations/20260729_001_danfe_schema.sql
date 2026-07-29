-- DanfeCollector lives in its own schema inside the shared self-hosted
-- Supabase instance. Do not place its tables in public: that schema belongs
-- to SCAN/Catalogo.

BEGIN;

CREATE SCHEMA IF NOT EXISTS danfe;
REVOKE ALL ON SCHEMA danfe FROM PUBLIC;

SET search_path = danfe, public, pg_catalog;

CREATE TABLE IF NOT EXISTS "Cnpj" (
  "id" SERIAL PRIMARY KEY,
  "cnpj" TEXT NOT NULL UNIQUE,
  "razaoSocial" TEXT,
  "uf" TEXT NOT NULL DEFAULT 'CE',
  "ultimoNSU" TEXT NOT NULL DEFAULT '0',
  "maxNSU" TEXT NOT NULL DEFAULT '0',
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "situacao" TEXT NOT NULL DEFAULT 'Nunca sincronizado',
  "ultimaBusca" TIMESTAMP(3),
  "bloqueadoAte" TIMESTAMP(3),
  "certSerial" TEXT,
  "certThumbprint" TEXT,
  "certVencimento" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "Usuario" (
  "id" SERIAL PRIMARY KEY,
  "login" TEXT NOT NULL UNIQUE,
  "nome" TEXT NOT NULL,
  "senhaHash" TEXT NOT NULL,
  "perfil" TEXT NOT NULL DEFAULT 'operador',
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "acessoTodosCnpjs" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "UsuarioCnpj" (
  "id" SERIAL PRIMARY KEY,
  "usuarioId" INTEGER NOT NULL,
  "cnpjId" INTEGER NOT NULL,
  CONSTRAINT "UsuarioCnpj_usuarioId_cnpjId_key" UNIQUE ("usuarioId", "cnpjId")
);

CREATE TABLE IF NOT EXISTS "NotaFiscal" (
  "id" SERIAL PRIMARY KEY,
  "chave" TEXT NOT NULL UNIQUE,
  "nsu" TEXT,
  "numero" TEXT,
  "serie" TEXT,
  "emitidaEm" TIMESTAMP(3) NOT NULL,
  "tipoOperacao" TEXT,
  "naturezaOp" TEXT,
  "emitenteNome" TEXT,
  "emitenteCnpj" TEXT,
  "emitenteIe" TEXT,
  "emitenteUf" TEXT,
  "destNome" TEXT,
  "destCnpj" TEXT,
  "valorTotal" DOUBLE PRECISION,
  "valorProdutos" DOUBLE PRECISION,
  "valorFrete" DOUBLE PRECISION,
  "valorDesconto" DOUBLE PRECISION,
  "valorIcms" DOUBLE PRECISION,
  "modalidadeFrete" TEXT,
  "transportadoraNome" TEXT,
  "transportadoraCnpj" TEXT,
  "transportadoraIe" TEXT,
  "transportadoraUf" TEXT,
  "transportadoraMunicipio" TEXT,
  "qtdItens" INTEGER,
  "etiqueta" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RESUMO',
  "situacaoSefaz" TEXT NOT NULL DEFAULT 'AUTORIZADA',
  "sitramConsultadaEm" TIMESTAMP(3),
  "sitramChaveManifesto" TEXT,
  "sitramAcaoFiscal" TEXT,
  "sitramSelada" BOOLEAN,
  "sitramSituacao" TEXT,
  "sitramDaeStatus" TEXT,
  "sitramDaeResumo" TEXT,
  "sitramDaeUrl" TEXT,
  "sitramDetalhe" TEXT,
  "manifestadaEm" TIMESTAMP(3),
  "xmlPath" TEXT,
  "pdfPath" TEXT,
  "xmlStorageKey" TEXT,
  "pdfStorageKey" TEXT,
  "pagamentoManualEm" TIMESTAMP(3),
  "pagamentoManualRef" TEXT,
  "pagamentoManualValor" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "cnpjId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "DaeCompartilhado" (
  "id" SERIAL PRIMARY KEY,
  "chave" TEXT NOT NULL UNIQUE,
  "titulo" TEXT NOT NULL,
  "identificadorExterno" TEXT,
  "codigo" TEXT,
  "descricao" TEXT,
  "vencimento" TEXT,
  "valor" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "Anexo" (
  "id" SERIAL PRIMARY KEY,
  "nome" TEXT NOT NULL,
  "arquivoNome" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "tamanho" INTEGER NOT NULL,
  "caminho" TEXT NOT NULL,
  "storageKey" TEXT,
  "criadoPor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notaId" INTEGER,
  "daeCompartilhadoId" INTEGER
);

CREATE INDEX IF NOT EXISTS "UsuarioCnpj_cnpjId_idx" ON "UsuarioCnpj" ("cnpjId");
CREATE INDEX IF NOT EXISTS "NotaFiscal_cnpjId_emitidaEm_idx" ON "NotaFiscal" ("cnpjId", "emitidaEm" DESC);
CREATE INDEX IF NOT EXISTS "NotaFiscal_cnpjId_status_manifestadaEm_idx" ON "NotaFiscal" ("cnpjId", "status", "manifestadaEm");
CREATE INDEX IF NOT EXISTS "NotaFiscal_cnpjId_sitramDaeStatus_idx" ON "NotaFiscal" ("cnpjId", "sitramDaeStatus");
CREATE INDEX IF NOT EXISTS "NotaFiscal_cnpjId_situacaoSefaz_idx" ON "NotaFiscal" ("cnpjId", "situacaoSefaz");
CREATE INDEX IF NOT EXISTS "Anexo_notaId_idx" ON "Anexo" ("notaId");
CREATE INDEX IF NOT EXISTS "Anexo_daeCompartilhadoId_idx" ON "Anexo" ("daeCompartilhadoId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UsuarioCnpj_usuarioId_fkey') THEN
    ALTER TABLE "UsuarioCnpj" ADD CONSTRAINT "UsuarioCnpj_usuarioId_fkey"
      FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UsuarioCnpj_cnpjId_fkey') THEN
    ALTER TABLE "UsuarioCnpj" ADD CONSTRAINT "UsuarioCnpj_cnpjId_fkey"
      FOREIGN KEY ("cnpjId") REFERENCES "Cnpj"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotaFiscal_cnpjId_fkey') THEN
    ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_cnpjId_fkey"
      FOREIGN KEY ("cnpjId") REFERENCES "Cnpj"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Anexo_notaId_fkey') THEN
    ALTER TABLE "Anexo" ADD CONSTRAINT "Anexo_notaId_fkey"
      FOREIGN KEY ("notaId") REFERENCES "NotaFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Anexo_daeCompartilhadoId_fkey') THEN
    ALTER TABLE "Anexo" ADD CONSTRAINT "Anexo_daeCompartilhadoId_fkey"
      FOREIGN KEY ("daeCompartilhadoId") REFERENCES "DaeCompartilhado"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- No browser role receives access to the fiscal schema. Server-side code uses
-- the Supabase service role until dedicated Danfe RLS policies are introduced.
GRANT USAGE ON SCHEMA danfe TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA danfe TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA danfe TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA danfe GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA danfe GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('danfe-xml', 'danfe-xml', false, 52428800, ARRAY['application/xml', 'text/xml', 'application/octet-stream']),
  -- The application validates new uploads. Keeping this private bucket without
  -- a MIME allow-list also preserves legacy audit files with uncommon suffixes.
  ('danfe-anexos', 'danfe-anexos', false, 26214400, NULL)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
