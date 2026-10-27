-- The bulk import of Sunday and service PowerPoints (tools/import_slides.py)
-- remembers where each one came from, like song_files does for music:
--
-- source_path: where the file is on your computer. Empty for PowerPoints
--   uploaded through the admin pages.
-- source_hash: the file's fingerprint (SHA-256), so edited files are spotted.

ALTER TABLE powerpoints ADD COLUMN source_path TEXT NOT NULL DEFAULT '';
ALTER TABLE powerpoints ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX powerpoints_source_idx ON powerpoints (source_path);
