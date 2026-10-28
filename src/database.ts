// Every database query the site uses lives in this file.
// Each function does one job and has a plain name, so the page code
// can say things like `await getUpcomingEvents(db, today)`.
//
// The tables are created by the files in the /migrations folder.

import { cycleAndOccasionsOn } from "./liturgy";
import type { EventRow, ParishRow, PowerpointRow, ReadingsRow, RosterRow, SetlistRow, SongFileRow, SongRow } from "./types";

// ===========================================================================
// Parishes (the churches the choir sings at)
// ===========================================================================

export async function getParishes(db: D1Database): Promise<ParishRow[]> {
  const result = await db.prepare("SELECT * FROM parishes ORDER BY name COLLATE NOCASE").all<ParishRow>();
  return result.results;
}

export async function getParish(db: D1Database, parishId: number): Promise<ParishRow | null> {
  return await db.prepare("SELECT * FROM parishes WHERE id = ?").bind(parishId).first<ParishRow>();
}

export async function createParish(db: D1Database, name: string, address: string, notes: string): Promise<void> {
  await db.prepare("INSERT INTO parishes (name, address, notes) VALUES (?, ?, ?)").bind(name, address, notes).run();
}

export async function updateParish(db: D1Database, parishId: number, name: string, address: string, notes: string): Promise<void> {
  await db
    .prepare("UPDATE parishes SET name = ?, address = ?, notes = ? WHERE id = ?")
    .bind(name, address, notes, parishId)
    .run();
}

export async function deleteParish(db: D1Database, parishId: number): Promise<void> {
  // Events at this parish are kept; they just lose their parish
  // (see "ON DELETE SET NULL" in the migrations).
  await db.prepare("DELETE FROM parishes WHERE id = ?").bind(parishId).run();
}

// ===========================================================================
// Events
// ===========================================================================

// Every event query starts like this, so each event comes with the name
// and address of its parish (LEFT JOIN = keep events that have no parish).
const SELECT_EVENTS = `
  SELECT events.*, parishes.name AS parish_name, parishes.address AS parish_address
  FROM events
  LEFT JOIN parishes ON parishes.id = events.parish_id`;

/**
 * Events from today onwards, soonest first.
 * includePrivate: also include members-only events.
 * parishId: only events at this parish (or null for every parish).
 */
export async function getUpcomingEvents(
  db: D1Database,
  today: string,
  includePrivate: boolean,
  parishId: number | null,
): Promise<EventRow[]> {
  let sql = SELECT_EVENTS + " WHERE events.starts_at >= ?";
  const values: (string | number)[] = [today];

  if (!includePrivate) {
    sql = sql + " AND events.is_public = 1";
  }
  if (parishId !== null) {
    sql = sql + " AND events.parish_id = ?";
    values.push(parishId);
  }
  sql = sql + " ORDER BY events.starts_at";

  const result = await db.prepare(sql).bind(...values).all<EventRow>();
  return result.results;
}

/**
 * Events between two dates (both "YYYY-MM-DD", the second one not
 * included), soonest first. Used by the month view of the calendar.
 */
export async function getEventsBetween(
  db: D1Database,
  fromDate: string,
  toDate: string,
  includePrivate: boolean,
  parishId: number | null,
): Promise<EventRow[]> {
  let sql = SELECT_EVENTS + " WHERE events.starts_at >= ? AND events.starts_at < ?";
  const values: (string | number)[] = [fromDate, toDate];

  if (!includePrivate) {
    sql = sql + " AND events.is_public = 1";
  }
  if (parishId !== null) {
    sql = sql + " AND events.parish_id = ?";
    values.push(parishId);
  }
  sql = sql + " ORDER BY events.starts_at";

  const result = await db.prepare(sql).bind(...values).all<EventRow>();
  return result.results;
}

/** Every event, newest first (for the admin pages). */
export async function getAllEvents(db: D1Database): Promise<EventRow[]> {
  const result = await db.prepare(SELECT_EVENTS + " ORDER BY events.starts_at DESC").all<EventRow>();
  return result.results;
}

export async function getEvent(db: D1Database, eventId: number): Promise<EventRow | null> {
  return await db.prepare(SELECT_EVENTS + " WHERE events.id = ?").bind(eventId).first<EventRow>();
}

export type EventDetails = {
  title: string;
  description: string;
  parishId: number | null;
  location: string;
  startsAt: string;
  endsAt: string;
  isPublic: boolean;
};

/** Saves a new event and returns its id. */
export async function createEvent(db: D1Database, event: EventDetails): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO events (title, description, parish_id, location, starts_at, ends_at, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      event.title,
      event.description,
      event.parishId,
      event.location,
      event.startsAt,
      event.endsAt || null,
      event.isPublic ? 1 : 0,
    )
    .first<{ id: number }>();
  return row!.id;
}

export async function updateEvent(db: D1Database, eventId: number, event: EventDetails): Promise<void> {
  await db
    .prepare(
      `UPDATE events
       SET title = ?, description = ?, parish_id = ?, location = ?, starts_at = ?, ends_at = ?, is_public = ?
       WHERE id = ?`,
    )
    .bind(
      event.title,
      event.description,
      event.parishId,
      event.location,
      event.startsAt,
      event.endsAt || null,
      event.isPublic ? 1 : 0,
      eventId,
    )
    .run();
}

export async function deleteEvent(db: D1Database, eventId: number): Promise<void> {
  // The event's roster and set list are removed with it
  // (see "ON DELETE CASCADE" in the migrations).
  await db.prepare("DELETE FROM events WHERE id = ?").bind(eventId).run();
}

// ===========================================================================
// Volunteer rosters (who is doing what at an event)
// ===========================================================================

export async function getRoster(db: D1Database, eventId: number): Promise<RosterRow[]> {
  const result = await db
    .prepare("SELECT * FROM roster_entries WHERE event_id = ? ORDER BY role, person_name")
    .bind(eventId)
    .all<RosterRow>();
  return result.results;
}

export async function addRosterEntry(db: D1Database, eventId: number, role: string, personName: string, notes: string): Promise<void> {
  await db
    .prepare("INSERT INTO roster_entries (event_id, role, person_name, notes) VALUES (?, ?, ?, ?)")
    .bind(eventId, role, personName, notes)
    .run();
}

export async function deleteRosterEntry(db: D1Database, entryId: number): Promise<void> {
  await db.prepare("DELETE FROM roster_entries WHERE id = ?").bind(entryId).run();
}

// ===========================================================================
// Set lists (which songs are sung at an event, in order)
// ===========================================================================

export async function getSetlist(db: D1Database, eventId: number): Promise<SetlistRow[]> {
  const result = await db
    .prepare(
      `SELECT setlist_items.*, songs.title, songs.author, songs.song_key, songs.youtube_url, songs.sheet_music_url, songs.section
       FROM setlist_items
       JOIN songs ON songs.id = setlist_items.song_id
       WHERE setlist_items.event_id = ?
       ORDER BY setlist_items.position`,
    )
    .bind(eventId)
    .all<SetlistRow>();
  return result.results;
}

/** Adds a song to the end of an event's set list. */
export async function addSongToSetlist(db: D1Database, eventId: number, songId: number, notes: string): Promise<void> {
  const last = await db
    .prepare("SELECT MAX(position) AS position FROM setlist_items WHERE event_id = ?")
    .bind(eventId)
    .first<{ position: number | null }>();
  const nextPosition = (last?.position ?? 0) + 1;

  await db
    .prepare("INSERT INTO setlist_items (event_id, song_id, position, notes) VALUES (?, ?, ?, ?)")
    .bind(eventId, songId, nextPosition, notes)
    .run();
}

export async function removeSongFromSetlist(db: D1Database, itemId: number): Promise<void> {
  await db.prepare("DELETE FROM setlist_items WHERE id = ?").bind(itemId).run();
}

// ===========================================================================
// Songs
// ===========================================================================

/**
 * Songs A to Z, or only the ones matching a search.
 * section: "music" for the music library, "prayers" for Prayers and
 * services, or "" for every song (e.g. when picking a set list).
 */
export async function getSongs(db: D1Database, search: string, section: "" | "music" | "prayers" = ""): Promise<SongRow[]> {
  let sql = "SELECT * FROM songs WHERE 1 = 1";
  const values: string[] = [];
  if (section !== "") {
    sql = sql + " AND section = ?";
    values.push(section);
  }
  if (search !== "") {
    const pattern = "%" + search + "%";
    sql = sql + " AND (title LIKE ? OR author LIKE ? OR tags LIKE ?)";
    values.push(pattern, pattern, pattern);
  }
  sql = sql + " ORDER BY title COLLATE NOCASE";
  const result = await db.prepare(sql).bind(...values).all<SongRow>();
  return result.results;
}

export type SongFileSummary = Pick<SongFileRow, "id" | "song_id" | "kind" | "filename" | "content_type" | "r2_key">;

/**
 * A short line about every song file (no sizes or labels), for the music
 * library's cards: what each song has, and which file to preview on its
 * cover. One query for all songs.
 */
export async function getAllSongFileSummaries(db: D1Database): Promise<SongFileSummary[]> {
  const result = await db
    .prepare("SELECT id, song_id, kind, filename, content_type, r2_key FROM song_files ORDER BY id")
    .all<SongFileSummary>();
  return result.results;
}

export async function getSong(db: D1Database, songId: number): Promise<SongRow | null> {
  return await db.prepare("SELECT * FROM songs WHERE id = ?").bind(songId).first<SongRow>();
}

export type SongDetails = {
  title: string;
  author: string;
  songKey: string;
  ccliNumber: string;
  notes: string;
  youtubeUrl: string;
  sheetMusicUrl: string;
  section: "music" | "prayers";
};

export async function createSong(db: D1Database, song: SongDetails): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO songs (title, author, song_key, ccli_number, notes, youtube_url, sheet_music_url, section)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(song.title, song.author, song.songKey, song.ccliNumber, song.notes, song.youtubeUrl, song.sheetMusicUrl, song.section)
    .first<{ id: number }>();
  return row!.id;
}

export async function updateSong(db: D1Database, songId: number, song: SongDetails): Promise<void> {
  await db
    .prepare(
      `UPDATE songs
       SET title = ?, author = ?, song_key = ?, ccli_number = ?, notes = ?, youtube_url = ?, sheet_music_url = ?, section = ?
       WHERE id = ?`,
    )
    .bind(song.title, song.author, song.songKey, song.ccliNumber, song.notes, song.youtubeUrl, song.sheetMusicUrl, song.section, songId)
    .run();
}

/** Sets a song's tags (already tidied with tidyTags). */
export async function setSongTags(db: D1Database, songId: number, tags: string): Promise<void> {
  await db.prepare("UPDATE songs SET tags = ? WHERE id = ?").bind(tags, songId).run();
}

/** Every song's title and tags, for the bulk import to compare with song_list.csv. */
export async function getAllSongTags(db: D1Database): Promise<{ title: string; tags: string }[]> {
  const result = await db.prepare("SELECT title, tags FROM songs ORDER BY title COLLATE NOCASE").all<{ title: string; tags: string }>();
  return result.results;
}

/** Moves a song to the music library or to Prayers and services. */
export async function setSongSection(db: D1Database, songId: number, section: "music" | "prayers"): Promise<void> {
  await db.prepare("UPDATE songs SET section = ? WHERE id = ?").bind(section, songId).run();
}

export async function deleteSong(db: D1Database, songId: number): Promise<void> {
  await db.prepare("DELETE FROM songs WHERE id = ?").bind(songId).run();
}

// ===========================================================================
// Song files (the actual files are in R2; this is the list of them)
// ===========================================================================

export async function getSongFiles(db: D1Database, songId: number): Promise<SongFileRow[]> {
  const result = await db
    .prepare("SELECT * FROM song_files WHERE song_id = ? ORDER BY kind, music_key, version, filename")
    .bind(songId)
    .all<SongFileRow>();
  return result.results;
}

/**
 * The sheet music, chord charts, MuseScore files and slides for every song
 * in an event's set list, so the event page can link straight to them.
 */
export async function getSheetFilesForEvent(db: D1Database, eventId: number): Promise<SongFileRow[]> {
  const result = await db
    .prepare(
      `SELECT song_files.*
       FROM song_files
       JOIN setlist_items ON setlist_items.song_id = song_files.song_id
       WHERE setlist_items.event_id = ? AND song_files.kind IN ('sheet', 'chords', 'musescore', 'slides')
       ORDER BY song_files.kind, song_files.filename`,
    )
    .bind(eventId)
    .all<SongFileRow>();
  return result.results;
}

export async function getSongFile(db: D1Database, fileId: number): Promise<SongFileRow | null> {
  return await db.prepare("SELECT * FROM song_files WHERE id = ?").bind(fileId).first<SongFileRow>();
}

export type NewSongFile = {
  songId: number;
  kind: string;
  musicKey: string;
  version: string;
  r2Key: string;
  filename: string;
  contentType: string;
  size: number;
  sourcePath: string; // "" when uploaded on the website
  sourceHash: string; // "" when uploaded on the website
};

export async function addSongFile(db: D1Database, file: NewSongFile): Promise<void> {
  await db
    .prepare(
      `INSERT INTO song_files (song_id, kind, music_key, version, r2_key, filename, content_type, size, source_path, source_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      file.songId,
      file.kind,
      file.musicKey,
      file.version,
      file.r2Key,
      file.filename,
      file.contentType,
      file.size,
      file.sourcePath,
      file.sourceHash,
    )
    .run();
}

/**
 * Points an existing song file at a new copy in R2, e.g. after the file
 * was edited. Its kind, key and version stay the same.
 */
export async function replaceSongFileContents(
  db: D1Database,
  fileId: number,
  r2Key: string,
  filename: string,
  contentType: string,
  size: number,
  sourceHash: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE song_files
       SET r2_key = ?, filename = ?, content_type = ?, size = ?, source_hash = ?, uploaded_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(r2Key, filename, contentType, size, sourceHash, fileId)
    .run();
}

/** Finds a song by its exact title, ignoring upper and lower case. */
export async function findSongByTitle(db: D1Database, title: string): Promise<SongRow | null> {
  return await db.prepare("SELECT * FROM songs WHERE title = ? COLLATE NOCASE").bind(title).first<SongRow>();
}

export type ImportedFileRow = {
  source_path: string;
  source_hash: string;
  title: string; // the song it's under
  kind: string;
  music_key: string;
  version: string;
};

/**
 * Every file the bulk import has already uploaded, with its fingerprint
 * and where it sits on the site, so the script can spot what changed.
 */
export async function getImportedFiles(db: D1Database): Promise<ImportedFileRow[]> {
  const result = await db
    .prepare(
      `SELECT song_files.source_path, song_files.source_hash, songs.title,
              song_files.kind, song_files.music_key, song_files.version
       FROM song_files
       JOIN songs ON songs.id = song_files.song_id
       WHERE song_files.source_path != ''`,
    )
    .all<ImportedFileRow>();
  return result.results;
}

/**
 * Moves a song file to another song and/or changes its labels, e.g. after
 * the file was renamed or moved on your computer, or you changed its title,
 * key or version in the import spreadsheet. The file in R2 stays the same.
 */
export async function updateImportedSongFile(
  db: D1Database,
  fileId: number,
  songId: number,
  kind: string,
  musicKey: string,
  version: string,
  filename: string,
  sourcePath: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE song_files
       SET song_id = ?, kind = ?, music_key = ?, version = ?, filename = ?, source_path = ?
       WHERE id = ?`,
    )
    .bind(songId, kind, musicKey, version, filename, sourcePath, fileId)
    .run();
}

/** Songs with no files at all, e.g. after their files were moved or deleted. */
export async function getSongsWithNoFiles(db: D1Database): Promise<SongRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM songs
       WHERE NOT EXISTS (SELECT 1 FROM song_files WHERE song_files.song_id = songs.id)
       ORDER BY title COLLATE NOCASE`,
    )
    .all<SongRow>();
  return result.results;
}

/** The song file the bulk import made from this file on your computer, if any. */
export async function getSongFileBySourcePath(db: D1Database, sourcePath: string): Promise<SongFileRow | null> {
  return await db.prepare("SELECT * FROM song_files WHERE source_path = ?").bind(sourcePath).first<SongFileRow>();
}

export async function deleteSongFileRecord(db: D1Database, fileId: number): Promise<void> {
  await db.prepare("DELETE FROM song_files WHERE id = ?").bind(fileId).run();
}

// ===========================================================================
// PowerPoint archive (the files are in R2; this is the list of them)
// ===========================================================================

// Every PowerPoint query starts like this, so each one comes with the
// title of the event it was made for (if any). The words on the slides
// (slide_text) are left out: they're only for searching, and can be long.
const POWERPOINT_COLUMNS = `
  powerpoints.id, powerpoints.title, powerpoints.service_date, powerpoints.notes, powerpoints.r2_key,
  powerpoints.filename, powerpoints.content_type, powerpoints.size, powerpoints.uploaded_at,
  powerpoints.event_id, powerpoints.source_path, powerpoints.source_hash, powerpoints.church,
  powerpoints.text_hash, powerpoints.cycle, powerpoints.occasion, events.title AS event_title`;
const SELECT_POWERPOINTS = `
  SELECT ${POWERPOINT_COLUMNS}
  FROM powerpoints
  LEFT JOIN events ON events.id = powerpoints.event_id`;

/**
 * All PowerPoints, newest service first. Or, with a search, those matching
 * it, best match first: words in the title, church, notes or on the slides
 * (in any order; the last word can be the start of a word), then any whose
 * date or event matches. Search results come with a snippet: the words
 * from the slides around the match, with the matching words between
 * \u0001 and \u0002 so the page can highlight them.
 */
export async function getPowerpoints(db: D1Database, search: string): Promise<PowerpointRow[]> {
  if (search === "") {
    const result = await db.prepare(SELECT_POWERPOINTS + " ORDER BY powerpoints.service_date DESC, powerpoints.title").all<PowerpointRow>();
    return result.results;
  }

  // Each word in quotes, so characters like - or * can't upset the search.
  const words = search.match(/[\p{L}\p{N}]+/gu) ?? [];
  let found: PowerpointRow[] = [];
  if (words.length > 0) {
    const query = words.map((word) => '"' + word + '"').join(" ") + "*";
    const result = await db
      .prepare(
        `SELECT ${POWERPOINT_COLUMNS},
           snippet(powerpoints_search, 3, char(1), char(2), '...', 16) AS snippet
         FROM powerpoints_search
         JOIN powerpoints ON powerpoints.id = powerpoints_search.rowid
         LEFT JOIN events ON events.id = powerpoints.event_id
         WHERE powerpoints_search MATCH ?
         ORDER BY bm25(powerpoints_search, 10.0, 3.0, 2.0, 1.0)
         LIMIT 200`,
      )
      .bind(query)
      .all<PowerpointRow>();
    found = result.results;
  }

  // A date ("2026-10") or an event's name.
  const pattern = "%" + search + "%";
  const byDateOrEvent = await db
    .prepare(SELECT_POWERPOINTS + " WHERE powerpoints.service_date LIKE ? OR events.title LIKE ? ORDER BY powerpoints.service_date DESC")
    .bind(pattern, pattern)
    .all<PowerpointRow>();
  const alreadyFound = new Set(found.map((powerpoint) => powerpoint.id));
  return found.concat(byDateOrEvent.results.filter((powerpoint) => !alreadyFound.has(powerpoint.id)));
}

/** Every church named on a PowerPoint, for the church filter. */
export async function getPowerpointChurches(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare("SELECT DISTINCT church FROM powerpoints WHERE church != '' ORDER BY church COLLATE NOCASE")
    .all<{ church: string }>();
  return result.results.map((row) => row.church);
}

/**
 * The PowerPoints for one event: those uploaded for it, plus those in the
 * archive for the same date that aren't tied to another event.
 */
export async function getPowerpointsForEvent(db: D1Database, eventId: number, date: string): Promise<PowerpointRow[]> {
  // Also those filed under the Sunday or feast the event falls on, in this
  // Year (A, B or C) or in no particular Year.
  const { cycle, occasions } = cycleAndOccasionsOn(date);
  const occasionMatch =
    occasions.length === 0
      ? ""
      : ` OR (powerpoints.event_id IS NULL AND powerpoints.cycle IN (?, '')
              AND powerpoints.occasion IN (${occasions.map(() => "?").join(", ")}))`;
  const result = await db
    .prepare(
      SELECT_POWERPOINTS +
        ` WHERE powerpoints.event_id = ? OR (powerpoints.event_id IS NULL AND powerpoints.service_date = ?)${occasionMatch}
          ORDER BY powerpoints.title`,
    )
    .bind(eventId, date, ...(occasions.length === 0 ? [] : [cycle, ...occasions]))
    .all<PowerpointRow>();
  return result.results;
}

export async function getPowerpoint(db: D1Database, powerpointId: number): Promise<PowerpointRow | null> {
  return await db.prepare(SELECT_POWERPOINTS + " WHERE powerpoints.id = ?").bind(powerpointId).first<PowerpointRow>();
}

export type NewPowerpoint = {
  title: string;
  serviceDate: string;
  notes: string;
  eventId: number | null;
  r2Key: string;
  filename: string;
  contentType: string;
  size: number;
};

export async function addPowerpoint(db: D1Database, powerpoint: NewPowerpoint): Promise<void> {
  await db
    .prepare(
      `INSERT INTO powerpoints (title, service_date, notes, event_id, r2_key, filename, content_type, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      powerpoint.title,
      powerpoint.serviceDate,
      powerpoint.notes,
      powerpoint.eventId,
      powerpoint.r2Key,
      powerpoint.filename,
      powerpoint.contentType,
      powerpoint.size,
    )
    .run();
}

/** PowerPoints added by the bulk import (tools/import_slides.py). */
export async function getImportedPowerpoints(db: D1Database): Promise<PowerpointRow[]> {
  const result = await db.prepare(SELECT_POWERPOINTS + " WHERE powerpoints.source_path != ''").all<PowerpointRow>();
  return result.results;
}

export async function getPowerpointBySourcePath(db: D1Database, sourcePath: string): Promise<PowerpointRow | null> {
  return await db.prepare(SELECT_POWERPOINTS + " WHERE powerpoints.source_path = ?").bind(sourcePath).first<PowerpointRow>();
}

/** Adds a PowerPoint from the bulk import. */
/** Where an imported PowerPoint is filed: its church, Year ("A", "B", "C" or "") and occasion ("" = other services). */
export type PowerpointFiling = { church: string; cycle: string; occasion: string };

export async function addImportedPowerpoint(
  db: D1Database,
  powerpoint: NewPowerpoint,
  filing: PowerpointFiling,
  sourcePath: string,
  sourceHash: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO powerpoints (title, service_date, notes, r2_key, filename, content_type, size, church, cycle, occasion,
         source_path, source_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      powerpoint.title,
      powerpoint.serviceDate,
      powerpoint.notes,
      powerpoint.r2Key,
      powerpoint.filename,
      powerpoint.contentType,
      powerpoint.size,
      filing.church,
      filing.cycle,
      filing.occasion,
      sourcePath,
      sourceHash,
    )
    .run();
}

/** Points an imported PowerPoint at a new copy of its file (it was edited). */
export async function replacePowerpointContents(
  db: D1Database,
  powerpointId: number,
  r2Key: string,
  contentType: string,
  size: number,
  sourceHash: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE powerpoints
       SET r2_key = ?, content_type = ?, size = ?, source_hash = ?, uploaded_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(r2Key, contentType, size, sourceHash, powerpointId)
    .run();
}

/** A new title, date, filing, file name or place on your computer for an imported PowerPoint. */
export async function updateImportedPowerpoint(
  db: D1Database,
  powerpointId: number,
  title: string,
  serviceDate: string,
  filing: PowerpointFiling,
  filename: string,
  sourcePath: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE powerpoints SET title = ?, service_date = ?, church = ?, cycle = ?, occasion = ?, filename = ?, source_path = ?
       WHERE id = ?`,
    )
    .bind(title, serviceDate, filing.church, filing.cycle, filing.occasion, filename, sourcePath, powerpointId)
    .run();
}

/** The words on a PowerPoint's slides, for searching. */
export async function setPowerpointWords(db: D1Database, powerpointId: number, words: string, textHash: string): Promise<void> {
  await db.prepare("UPDATE powerpoints SET slide_text = ?, text_hash = ? WHERE id = ?").bind(words, textHash, powerpointId).run();
}

export async function deletePowerpointRecord(db: D1Database, powerpointId: number): Promise<void> {
  await db.prepare("DELETE FROM powerpoints WHERE id = ?").bind(powerpointId).run();
}

// ===========================================================================
// Daily readings (one row per date)
// ===========================================================================

export async function getReadingsForDate(db: D1Database, date: string): Promise<ReadingsRow | null> {
  return await db.prepare("SELECT * FROM daily_readings WHERE reading_date = ?").bind(date).first<ReadingsRow>();
}

/** The readings already entered, from a date onwards (for the admin list). */
export async function getReadingsFrom(db: D1Database, fromDate: string): Promise<ReadingsRow[]> {
  const result = await db
    .prepare("SELECT * FROM daily_readings WHERE reading_date >= ? ORDER BY reading_date")
    .bind(fromDate)
    .all<ReadingsRow>();
  return result.results;
}

/** Saves the readings for a date, replacing any already saved for that date. */
export async function saveReadings(db: D1Database, readings: ReadingsRow): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO daily_readings
         (reading_date, day_name, lectionary_number,
          first_reading, first_reading_text,
          psalm, psalm_text,
          second_reading, second_reading_text,
          alleluia, alleluia_text,
          gospel, gospel_text,
          notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      readings.reading_date,
      readings.day_name,
      readings.lectionary_number,
      readings.first_reading,
      readings.first_reading_text,
      readings.psalm,
      readings.psalm_text,
      readings.second_reading,
      readings.second_reading_text,
      readings.alleluia,
      readings.alleluia_text,
      readings.gospel,
      readings.gospel_text,
      readings.notes,
    )
    .run();
}

export async function deleteReadings(db: D1Database, date: string): Promise<void> {
  await db.prepare("DELETE FROM daily_readings WHERE reading_date = ?").bind(date).run();
}

// ===========================================================================
// Users (the tables themselves are managed by Better Auth)
// ===========================================================================

export type UserListRow = {
  id: string;
  name: string;
  email: string;
  role: string | null;
};

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS total FROM "user"').first<{ total: number }>();
  return row?.total ?? 0;
}

export async function getAllUsers(db: D1Database): Promise<UserListRow[]> {
  const result = await db
    .prepare('SELECT id, name, email, role FROM "user" ORDER BY name COLLATE NOCASE')
    .all<UserListRow>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Storage used
// ---------------------------------------------------------------------------

/** How many bytes all uploaded files (songs and PowerPoints) take up in R2. */
export async function getStorageUsed(db: D1Database): Promise<number> {
  const songFiles = await db.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM song_files").first<{ total: number }>();
  const powerpoints = await db.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM powerpoints").first<{ total: number }>();
  return (songFiles?.total ?? 0) + (powerpoints?.total ?? 0);
}
