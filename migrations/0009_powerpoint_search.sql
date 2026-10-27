-- Better searching of PowerPoints.
--
-- church:      the church it was made for, e.g. "St Teresa's Church", for
--              the church filter. Filled in by the bulk import.
-- slide_text:  the words on its slides (song titles, lyrics, readings), sent
--              by the bulk import so a search finds them.
-- text_hash:   a fingerprint of slide_text, so unchanged words aren't sent again.
ALTER TABLE powerpoints ADD COLUMN church TEXT NOT NULL DEFAULT '';
ALTER TABLE powerpoints ADD COLUMN slide_text TEXT NOT NULL DEFAULT '';
ALTER TABLE powerpoints ADD COLUMN text_hash TEXT NOT NULL DEFAULT '';

-- A full-text search index over the title, church, notes and slide words
-- (SQLite's FTS5, which D1 has built in). Words can be in any order and the
-- best matches come first. "porter" matches word endings ("teresas" finds
-- "Teresa's", "singing" finds "sing"); remove_diacritics matches letters
-- with or without macrons ("maori" finds "Māori").
-- The index holds no copy of the text: it reads it from powerpoints.
CREATE VIRTUAL TABLE powerpoints_search USING fts5 (
  title, church, notes, slide_text,
  content = 'powerpoints', content_rowid = 'id',
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- Keep the index up to date whenever a PowerPoint is added, changed or deleted.
CREATE TRIGGER powerpoints_search_insert AFTER INSERT ON powerpoints BEGIN
  INSERT INTO powerpoints_search (rowid, title, church, notes, slide_text)
  VALUES (new.id, new.title, new.church, new.notes, new.slide_text);
END;
CREATE TRIGGER powerpoints_search_delete AFTER DELETE ON powerpoints BEGIN
  INSERT INTO powerpoints_search (powerpoints_search, rowid, title, church, notes, slide_text)
  VALUES ('delete', old.id, old.title, old.church, old.notes, old.slide_text);
END;
CREATE TRIGGER powerpoints_search_update AFTER UPDATE ON powerpoints BEGIN
  INSERT INTO powerpoints_search (powerpoints_search, rowid, title, church, notes, slide_text)
  VALUES ('delete', old.id, old.title, old.church, old.notes, old.slide_text);
  INSERT INTO powerpoints_search (rowid, title, church, notes, slide_text)
  VALUES (new.id, new.title, new.church, new.notes, new.slide_text);
END;

-- Add the PowerPoints already on the site to the index.
INSERT INTO powerpoints_search (powerpoints_search) VALUES ('rebuild');
