-- PowerPoint archive: slides shown at services, kept for later.
-- The file itself is in R2; this table holds what we know about it.
CREATE TABLE powerpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  service_date TEXT NOT NULL,       -- "YYYY-MM-DD"
  notes TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX powerpoints_date_idx ON powerpoints (service_date);

-- Readings for a day: one row per date.
CREATE TABLE daily_readings (
  reading_date TEXT PRIMARY KEY,    -- "YYYY-MM-DD"
  day_name TEXT NOT NULL DEFAULT '',        -- e.g. "30th Sunday in Ordinary Time"
  first_reading TEXT NOT NULL DEFAULT '',   -- e.g. "Jeremiah 31:7-9"
  psalm TEXT NOT NULL DEFAULT '',
  second_reading TEXT NOT NULL DEFAULT '',
  gospel TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''            -- a reflection, or the full text
);
