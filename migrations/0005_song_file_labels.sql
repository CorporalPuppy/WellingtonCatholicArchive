-- Gets song files ready for the bulk import of the music library.
--
-- New kinds of song file:
--   lyrics  - a Word document with the words
--   slides  - a PowerPoint of the words, for the screen at Mass
--
-- New columns:
--   music_key    - the key this copy is in, e.g. "D" or "Am" ("" = not known)
--   version      - a short label that tells copies of a song apart,
--                  e.g. "with intro", "v2", "Capo 3", "Page 2" or
--                  "Sacred Heart style" ("" = none)
--   source_path  - where the file came from on the computer it was
--                  imported from, so running the import again skips it
--                  ("" = uploaded by hand on the website)
--
-- Like 0004, SQLite can't change a CHECK rule on an existing table, so we
-- make a new table, copy every row across, and swap it in. No files in R2
-- are touched.

CREATE TABLE song_files_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('sheet', 'chords', 'musescore', 'lyrics', 'slides', 'recording', 'other')),
  music_key TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  source_path TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO song_files_new (id, song_id, kind, r2_key, filename, content_type, size, uploaded_at)
SELECT id, song_id, kind, r2_key, filename, content_type, size, uploaded_at FROM song_files;

DROP TABLE song_files;
ALTER TABLE song_files_new RENAME TO song_files;
CREATE INDEX song_files_song_idx ON song_files (song_id);
CREATE INDEX song_files_source_idx ON song_files (source_path);
