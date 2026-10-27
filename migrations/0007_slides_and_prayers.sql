-- Slides for each Sunday, and a section for prayers, rosaries and services.
--
-- powerpoints.event_id: the event (e.g. a Sunday Mass) a PowerPoint was
--   made for. Empty (NULL) for PowerPoints uploaded in the archive; those
--   still show on any event on the same date. If the event is deleted the
--   PowerPoint is kept, it just loses its event.
--
-- songs.section: where a song shows on the site.
--   music    - the music library (every song so far)
--   prayers  - "Prayers and services": the Creed, the Prayer of St Francis,
--              rosaries, special services and so on
-- Either kind can go in a set list.

ALTER TABLE powerpoints ADD COLUMN event_id INTEGER REFERENCES events (id) ON DELETE SET NULL;
CREATE INDEX powerpoints_event_idx ON powerpoints (event_id);

ALTER TABLE songs ADD COLUMN section TEXT NOT NULL DEFAULT 'music' CHECK (section IN ('music', 'prayers'));
