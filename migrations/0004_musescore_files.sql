-- Adds "musescore" as a kind of song file.
--
-- SQLite can't change a CHECK rule on an existing table, so we make a new
-- song_files table with the new list of kinds, copy every row across, and
-- swap it in. No files in R2 are touched.

CREATE TABLE song_files_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('sheet', 'chords', 'musescore', 'recording', 'other')),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO song_files_new (id, song_id, kind, r2_key, filename, content_type, size, uploaded_at)
SELECT id, song_id, kind, r2_key, filename, content_type, size, uploaded_at FROM song_files;

DROP TABLE song_files;
ALTER TABLE song_files_new RENAME TO song_files;
CREATE INDEX song_files_song_idx ON song_files (song_id);
