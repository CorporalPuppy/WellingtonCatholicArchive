-- Tags on songs, prayers and services, e.g. "Marian, Easter, Communion".
-- Written with a comma and a space between them (see tidyTags in
-- src/helpers.ts). Set on the song's admin page, or in the tags column of
-- song_list.csv for the bulk import.
ALTER TABLE songs ADD COLUMN tags TEXT NOT NULL DEFAULT '';
