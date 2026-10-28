-- PowerPoints are filed by occasion instead of by date, so a deck shows up
-- again on the right Sunday every three years.
--
-- cycle:     "A", "B" or "C" (the Year of the Sunday readings), or "" if
--            the deck isn't tied to one.
-- occasion:  e.g. "15th Sunday in Ordinary Time" or "Easter Sunday" (the
--            names in src/liturgy.ts), or "" for other services: rosaries,
--            ordinations, retreats and so on.
-- service_date is now optional ("" = no date). Decks uploaded with a date
-- and no occasion are still filed by working out the occasion of that date.
ALTER TABLE powerpoints ADD COLUMN cycle TEXT NOT NULL DEFAULT '';
ALTER TABLE powerpoints ADD COLUMN occasion TEXT NOT NULL DEFAULT '';
CREATE INDEX powerpoints_occasion_idx ON powerpoints (occasion, cycle);
