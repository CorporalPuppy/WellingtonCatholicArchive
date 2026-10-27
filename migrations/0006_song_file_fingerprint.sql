-- Lets the bulk import notice when a file has been edited on your computer.
--
-- source_hash is a "fingerprint" of the file's contents (its SHA-256).
-- If you edit a file, its fingerprint changes, and the import replaces the
-- copy on the site instead of skipping it. "" = not known (files uploaded
-- on the website, or imported before this column existed).

ALTER TABLE song_files ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';
