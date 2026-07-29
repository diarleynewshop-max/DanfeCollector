SET search_path = danfe, public, pg_catalog;

SELECT 'Anexo' AS tabela, count(*) AS registros FROM "Anexo"
UNION ALL SELECT 'Cnpj', count(*) FROM "Cnpj"
UNION ALL SELECT 'DaeCompartilhado', count(*) FROM "DaeCompartilhado"
UNION ALL SELECT 'NotaFiscal', count(*) FROM "NotaFiscal"
UNION ALL SELECT 'Usuario', count(*) FROM "Usuario"
UNION ALL SELECT 'UsuarioCnpj', count(*) FROM "UsuarioCnpj"
ORDER BY tabela;

SELECT
  count(*) FILTER (WHERE "xmlPath" IS NOT NULL) AS xml_path_legado,
  count(*) FILTER (WHERE "xmlStorageKey" IS NOT NULL) AS xml_storage_migrado,
  count(*) FILTER (WHERE "pdfPath" IS NOT NULL) AS pdf_path_legado,
  count(*) FILTER (WHERE "pdfStorageKey" IS NOT NULL) AS pdf_storage_migrado
FROM "NotaFiscal";

SELECT
  count(*) AS anexos,
  count(*) FILTER (WHERE "storageKey" IS NOT NULL) AS anexos_storage_migrados
FROM "Anexo";
