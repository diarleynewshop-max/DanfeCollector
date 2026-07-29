-- Keep legacy paths for rollback and add deterministic Storage keys for the
-- Vercel/Supabase read path.

BEGIN;

UPDATE danfe."NotaFiscal"
SET "xmlStorageKey" = 'downloads/' || regexp_replace(replace("xmlPath", E'\\', '/'), '^.*/downloads/', '')
WHERE "xmlPath" IS NOT NULL
  AND replace("xmlPath", E'\\', '/') LIKE '%/downloads/%';

UPDATE danfe."NotaFiscal"
SET "pdfStorageKey" = 'pdf/' || regexp_replace(replace("pdfPath", E'\\', '/'), '^.*/downloads/', '')
WHERE "pdfPath" IS NOT NULL
  AND replace("pdfPath", E'\\', '/') LIKE '%/downloads/%';

UPDATE danfe."Anexo"
SET "storageKey" = 'anexos/' || replace("caminho", E'\\', '/')
WHERE "storageKey" IS NULL;

COMMIT;
