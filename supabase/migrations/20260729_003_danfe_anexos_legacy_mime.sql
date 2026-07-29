-- Applied to the already-created bucket so legacy files can be copied intact.
UPDATE storage.buckets
SET allowed_mime_types = NULL
WHERE id = 'danfe-anexos';
