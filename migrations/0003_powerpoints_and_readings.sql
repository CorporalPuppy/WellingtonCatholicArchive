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

-- Readings for a day: one row per date, laid out like the USCCB
-- daily readings page. Each part has a reference ("Luke 13:10-17") and
-- its full text.
CREATE TABLE daily_readings (
  reading_date TEXT PRIMARY KEY,                -- "YYYY-MM-DD"
  day_name TEXT NOT NULL DEFAULT '',            -- e.g. "Monday of the Thirtieth Week in Ordinary Time"
  lectionary_number TEXT NOT NULL DEFAULT '',   -- e.g. "477"
  first_reading TEXT NOT NULL DEFAULT '',
  first_reading_text TEXT NOT NULL DEFAULT '',
  psalm TEXT NOT NULL DEFAULT '',
  psalm_text TEXT NOT NULL DEFAULT '',
  second_reading TEXT NOT NULL DEFAULT '',      -- Sundays and big feasts only
  second_reading_text TEXT NOT NULL DEFAULT '',
  alleluia TEXT NOT NULL DEFAULT '',
  alleluia_text TEXT NOT NULL DEFAULT '',
  gospel TEXT NOT NULL DEFAULT '',
  gospel_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''                -- an optional reflection
);
