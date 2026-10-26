// Every database query the site uses lives in this file.
// Each function does one job and has a plain name, so the page code
// can say things like `await getUpcomingEvents(db, today)`.
//
// The tables are created by the files in the /migrations folder.

import type { EventRow, RosterRow, SetlistRow, SongFileRow, SongRow } from "./types";

// ===========================================================================
// Events
// ===========================================================================

/** Events from today onwards, soonest first. */
export async function getUpcomingEvents(db: D1Database, today: string, includePrivate: boolean): Promise<EventRow[]> {
  let sql = "SELECT * FROM events WHERE starts_at >= ?";
  if (!includePrivate) {
    sql = sql + " AND is_public = 1";
  }
  sql = sql + " ORDER BY starts_at";
  const result = await db.prepare(sql).bind(today).all<EventRow>();
  return result.results;
}

/** Every event, newest first (for the admin pages). */
export async function getAllEvents(db: D1Database): Promise<EventRow[]> {
  const result = await db.prepare("SELECT * FROM events ORDER BY starts_at DESC").all<EventRow>();
  return result.results;
}

export async function getEvent(db: D1Database, eventId: number): Promise<EventRow | null> {
  return await db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
}

export type EventDetails = {
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  isPublic: boolean;
};

/** Saves a new event and returns its id. */
export async function createEvent(db: D1Database, event: EventDetails): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO events (title, description, location, starts_at, ends_at, is_public) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(event.title, event.description, event.location, event.startsAt, event.endsAt || null, event.isPublic ? 1 : 0)
    .first<{ id: number }>();
  return row!.id;
}

export async function updateEvent(db: D1Database, eventId: number, event: EventDetails): Promise<void> {
  await db
    .prepare(
      "UPDATE events SET title = ?, description = ?, location = ?, starts_at = ?, ends_at = ?, is_public = ? WHERE id = ?",
    )
    .bind(event.title, event.description, event.location, event.startsAt, event.endsAt || null, event.isPublic ? 1 : 0, eventId)
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
      `SELECT setlist_items.*, songs.title, songs.song_key
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

/** All songs A to Z, or only the ones matching a search. */
export async function getSongs(db: D1Database, search: string): Promise<SongRow[]> {
  if (search === "") {
    const result = await db.prepare("SELECT * FROM songs ORDER BY title COLLATE NOCASE").all<SongRow>();
    return result.results;
  }
  const pattern = "%" + search + "%";
  const result = await db
    .prepare("SELECT * FROM songs WHERE title LIKE ? OR author LIKE ? ORDER BY title COLLATE NOCASE")
    .bind(pattern, pattern)
    .all<SongRow>();
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
};

export async function createSong(db: D1Database, song: SongDetails): Promise<number> {
  const row = await db
    .prepare("INSERT INTO songs (title, author, song_key, ccli_number, notes) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(song.title, song.author, song.songKey, song.ccliNumber, song.notes)
    .first<{ id: number }>();
  return row!.id;
}

export async function updateSong(db: D1Database, songId: number, song: SongDetails): Promise<void> {
  await db
    .prepare("UPDATE songs SET title = ?, author = ?, song_key = ?, ccli_number = ?, notes = ? WHERE id = ?")
    .bind(song.title, song.author, song.songKey, song.ccliNumber, song.notes, songId)
    .run();
}

export async function deleteSong(db: D1Database, songId: number): Promise<void> {
  await db.prepare("DELETE FROM songs WHERE id = ?").bind(songId).run();
}

// ===========================================================================
// Song files (the actual files are in R2; this is the list of them)
// ===========================================================================

export async function getSongFiles(db: D1Database, songId: number): Promise<SongFileRow[]> {
  const result = await db
    .prepare("SELECT * FROM song_files WHERE song_id = ? ORDER BY kind, filename")
    .bind(songId)
    .all<SongFileRow>();
  return result.results;
}

export async function getSongFile(db: D1Database, fileId: number): Promise<SongFileRow | null> {
  return await db.prepare("SELECT * FROM song_files WHERE id = ?").bind(fileId).first<SongFileRow>();
}

export async function addSongFile(
  db: D1Database,
  songId: number,
  kind: string,
  r2Key: string,
  filename: string,
  contentType: string,
  size: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO song_files (song_id, kind, r2_key, filename, content_type, size) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(songId, kind, r2Key, filename, contentType, size)
    .run();
}

export async function deleteSongFileRecord(db: D1Database, fileId: number): Promise<void> {
  await db.prepare("DELETE FROM song_files WHERE id = ?").bind(fileId).run();
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
