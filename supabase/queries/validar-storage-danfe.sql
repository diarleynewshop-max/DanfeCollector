SET search_path = danfe, public, pg_catalog;

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

SELECT
  bucket_id,
  count(*) AS objetos,
  COALESCE(sum((metadata ->> 'size')::bigint), 0) AS bytes
FROM storage.objects
WHERE bucket_id IN ('danfe-xml', 'danfe-anexos')
GROUP BY bucket_id
ORDER BY bucket_id;
