-- The parishes (churches) the choir sings at.
CREATE TABLE parishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

-- Events: Masses the choir sings at, rehearsals, and so on.
-- A Mass is an event with a set list (and maybe a roster) attached.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parish_id INTEGER REFERENCES parishes (id) ON DELETE SET NULL,  -- empty if not at a parish
  location TEXT NOT NULL DEFAULT '',  -- extra details, e.g. "Parish hall"
  starts_at TEXT NOT NULL,          -- local time, "YYYY-MM-DDTHH:MM"
  ends_at TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX events_starts_at_idx ON events (starts_at);
CREATE INDEX events_parish_idx ON events (parish_id);

CREATE TABLE songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  song_key TEXT NOT NULL DEFAULT '',
  ccli_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',        -- a reference recording on YouTube
  sheet_music_url TEXT NOT NULL DEFAULT '',    -- a link to sheet music elsewhere
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX songs_title_idx ON songs (title COLLATE NOCASE);

-- Files live in R2; this table holds what we know about them.
CREATE TABLE song_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('recording', 'sheet', 'chords', 'other')),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX song_files_song_idx ON song_files (song_id);

CREATE TABLE setlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX setlist_items_event_idx ON setlist_items (event_id, position);

-- Volunteer rosters: who is doing what at an event. person_name is free
-- text so volunteers don't need a website account.
CREATE TABLE roster_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  person_name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX roster_entries_event_idx ON roster_entries (event_id);
