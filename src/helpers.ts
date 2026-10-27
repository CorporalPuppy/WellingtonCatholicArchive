// Small helper functions used by many pages.

import type { Context } from "hono";
import type { AppEnv } from "./types";

// ---------------------------------------------------------------------------
// Dates and times
//
// Event times are saved as plain local text like "2026-11-01T10:00"
// (that is exactly what the browser's date-and-time picker gives us).
// That keeps things simple: no time zone maths when saving or showing them.
// ---------------------------------------------------------------------------

/**
 * Returns today's date in the choir's time zone, like "2026-10-26".
 * We use it to decide which events are "upcoming".
 */
export function getTodaysDate(timeZone: string): string {
  // "en-CA" happens to format dates as YYYY-MM-DD, which is what we want.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

/**
 * Turns "2026-11-01T10:00" into something friendly like
 * "Sunday, 1 November 2026 at 10:00 am".
 */
export function formatEventTime(localTime: string): string {
  const datePart = localTime.slice(0, 10); // "2026-11-01"
  const timePart = localTime.slice(11, 16) || "00:00"; // "10:00"

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(5, 7));
  const day = Number(datePart.slice(8, 10));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(3, 5));

  // Build the date in UTC and also format it in UTC, so nothing shifts.
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const formatter = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Cloudflare R2's free plan stores up to 10 GB. We stop uploads a little
 * before that (at 9.5 GB) so the site never goes onto a paid plan.
 */
export const FREE_STORAGE_BYTES = 10_000_000_000;
export const STORAGE_STOP_AT_BYTES = 9_500_000_000;

/** True if adding this many bytes would go past the free storage. */
export function wouldGoOverFreeStorage(alreadyUsed: number, adding: number): boolean {
  return alreadyUsed + adding > STORAGE_STOP_AT_BYTES;
}

/**
 * Turns "2026-10-26" into "Monday, 26 October 2026".
 */
export function formatDate(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const formatter = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return formatter.format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Moves a date forwards or backwards by some days.
 * addDays("2026-10-31", 1) gives "2026-11-01".
 */
export function addDays(date: string, days: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

/** The first Sunday of Advent in this calendar year: four Sundays before Christmas. */
function firstSundayOfAdvent(year: number): string {
  const christmasWeekday = new Date(Date.UTC(year, 11, 25)).getUTCDay(); // 0 is Sunday
  return addDays(year + "-12-25", -(christmasWeekday === 0 ? 7 : christmasWeekday) - 21);
}

/** Easter Sunday, "YYYY-MM-DD" (the usual calculation for the Western church). */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

/**
 * The Church's year a date falls in. It starts on the first Sunday of
 * Advent, so 7 December 2025 is in the year 2025-2026. Sunday readings
 * follow a three-year cycle: Year A (2025-2026), Year B (2026-2027),
 * Year C (2027-2028), then Year A again.
 */
export function liturgicalYear(date: string): { cycle: "A" | "B" | "C"; endYear: number } {
  const year = Number(date.slice(0, 4));
  const endYear = date >= firstSundayOfAdvent(year) ? year + 1 : year;
  const cycles = ["C", "A", "B"] as const;
  return { cycle: cycles[endYear % 3], endYear: endYear };
}

export const SEASONS = ["Advent", "Christmas", "Lent", "Easter", "Ordinary Time"] as const;
export type Season = (typeof SEASONS)[number];

/**
 * The season a date falls in, as kept in New Zealand. Christmas runs to
 * the Baptism of the Lord (the Sunday after the Epiphany, which is the
 * Sunday between 2 and 8 January; or the Monday if that's the 7th or 8th).
 * Lent runs from Ash Wednesday to Holy Saturday, Easter to Pentecost.
 */
export function liturgicalSeason(date: string): Season {
  const year = Number(date.slice(0, 4));
  if (date >= firstSundayOfAdvent(year)) {
    return date >= year + "-12-25" ? "Christmas" : "Advent";
  }
  const epiphanyWeekday = new Date(Date.UTC(year, 0, 2)).getUTCDay();
  const epiphany = addDays(year + "-01-02", (7 - epiphanyWeekday) % 7);
  const baptism = Number(epiphany.slice(8, 10)) >= 7 ? addDays(epiphany, 1) : addDays(epiphany, 7);
  if (date <= baptism) {
    return "Christmas";
  }
  const easter = easterSunday(year);
  if (date >= addDays(easter, -46) && date < easter) {
    return "Lent";
  }
  if (date >= easter && date <= addDays(easter, 49)) {
    return "Easter";
  }
  return "Ordinary Time";
}

/**
 * Tags as typed ("marian;Easter , easter") made tidy: each starting with a
 * capital, one comma and space between them, no repeats, nothing empty.
 * "Marian, Easter". Keep in step with tidy_tags in tools/import_music.py.
 */
export function tidyTags(text: string): string {
  const tags: string[] = [];
  for (const tag of text.split(/[,;]/)) {
    let tidy = tag.trim().replace(/\s+/g, " ");
    tidy = tidy.charAt(0).toUpperCase() + tidy.slice(1); // "marian" becomes "Marian"
    if (tidy !== "" && !tags.some((each) => each.toLowerCase() === tidy.toLowerCase())) {
      tags.push(tidy);
    }
  }
  return tags.join(", ");
}

/** The tags of a song as a list: "Marian, Easter" gives ["Marian", "Easter"]. */
export function splitTags(tags: string): string[] {
  return tags === "" ? [] : tags.split(", ");
}

/** True if the text looks like a date, "YYYY-MM-DD". */
export function isValidDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Turns a number of bytes into "512 KB" or "3.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return Math.round(bytes / 1024) + " KB";
  }
  if (bytes < 1024 * 1024 * 1024) {
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

/** The kinds of music file we store, and how to show each one. */
export const FILE_KIND_LABELS: Record<string, string> = {
  sheet: "Sheet music",
  chords: "Chord chart",
  musescore: "MuseScore file",
  lyrics: "Lyrics",
  slides: "Slides",
  recording: "Recording",
  other: "Other",
};

/** The two parts of the site a song can be in (songs.section). */
export const SONG_SECTION_LABELS: Record<string, string> = {
  music: "Music library",
  prayers: "Prayers and services",
};

/** The public page for a song, prayer or service. */
export function songPageLink(song: { id: number; section: string }): string {
  return (song.section === "prayers" ? "/prayers/" : "/music/") + song.id;
}

/** Reads a section from a form or address: "prayers", or "music" for anything else. */
export function readSongSection(text: string): "music" | "prayers" {
  return text === "prayers" ? "prayers" : "music";
}

/**
 * The type of a file (its "content type", e.g. "application/pdf") from its
 * name. browserType is what the browser said, if anything; browsers don't
 * know some music file types, so we fill those in ourselves.
 */
export function workOutContentType(filename: string, browserType: string): string {
  const name = filename.toLowerCase();
  const knownTypes: Record<string, string> = {
    ".cho": "text/plain; charset=utf-8",
    ".chordpro": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".mscz": "application/x-musescore",
    ".mscx": "application/x-musescore+xml",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
  };
  for (const ending in knownTypes) {
    if (name.endsWith(ending)) {
      return knownTypes[ending];
    }
  }
  return browserType || "application/octet-stream";
}

/**
 * The key and version of a song file in one short line, e.g.
 * "Key of D · with intro". Empty if the file has neither.
 */
export function describeFileLabels(musicKey: string, version: string): string {
  const parts: string[] = [];
  if (musicKey !== "") {
    parts.push("Key of " + musicKey);
  }
  if (version !== "") {
    parts.push(version);
  }
  return parts.join(" · ");
}

/**
 * Sheet music, chord charts and MuseScore files are always public, because
 * set lists link to them so anyone can see what the choir will sing.
 * Recordings and other files follow EVERYTHING_PUBLIC.
 */
export function isAlwaysPublicKind(kind: string): boolean {
  return kind === "sheet" || kind === "chords" || kind === "musescore";
}

/**
 * Guesses what kind of music file this is from its name and type, e.g.
 * "gloria.mscz" is a MuseScore file, "gloria.pptx" lyrics slides and
 * "gloria-chords.docx" a chord chart.
 * Admins can still pick the kind themselves when uploading.
 */
export function guessFileKind(filename: string, contentType: string): string {
  const name = filename.toLowerCase();

  if (name.endsWith(".mscz") || name.endsWith(".mscx")) {
    return "musescore";
  }
  if (contentType.startsWith("audio/") || name.endsWith(".mp3") || name.endsWith(".m4a") || name.endsWith(".wav")) {
    return "recording";
  }
  if (name.endsWith(".ppt") || name.endsWith(".pptx") || name.endsWith(".odp")) {
    return "slides";
  }
  // Word documents with "lyric" in the name hold just the words.
  if (name.includes("lyric") && (name.endsWith(".doc") || name.endsWith(".docx") || name.endsWith(".odt"))) {
    return "lyrics";
  }
  // Word documents, text files and files with "chord" in the name.
  if (
    name.includes("chord") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx") ||
    name.endsWith(".txt") ||
    name.endsWith(".odt") ||
    name.endsWith(".cho") ||
    name.endsWith(".chordpro")
  ) {
    return "chords";
  }
  if (name.endsWith(".pdf") || contentType.startsWith("image/")) {
    return "sheet";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Who is looking at the page?
// ---------------------------------------------------------------------------

/** True if someone is logged in. */
export function isLoggedIn(c: Context<AppEnv>): boolean {
  return c.get("user") !== null;
}

/** True if the logged-in person is an admin. */
export function isAdmin(c: Context<AppEnv>): boolean {
  const user = c.get("user");
  return user !== null && user.role === "admin";
}

/**
 * True if this visitor may see the members' pages: music, PowerPoints,
 * rosters, set lists and members-only events.
 *
 * Controlled by EVERYTHING_PUBLIC in wrangler.jsonc:
 *   "yes" -> everyone can see them, no login needed
 *   "no"  -> only logged-in members can see them
 *
 * (Admin pages always need an admin login, whatever this is set to.)
 */
export function canSeeMemberPages(c: Context<AppEnv>): boolean {
  if (c.env.EVERYTHING_PUBLIC === "yes") {
    return true;
  }
  return isLoggedIn(c);
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * Reads one text box from a submitted form and trims extra spaces.
 * Returns "" if the box was empty or missing.
 */
export function getFormText(form: Record<string, unknown>, name: string): string {
  const value = form[name];
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

/**
 * Only keeps web links that start with http:// or https://.
 * (This stops someone saving a harmful "javascript:" link.)
 * Returns "" for anything else.
 */
export function cleanWebLink(link: string): string {
  if (link.startsWith("https://") || link.startsWith("http://")) {
    return link;
  }
  return "";
}

/**
 * After logging in we send people back to the page they wanted.
 * This makes sure that page is on our own site (not some other website).
 * Browsers read "/\evil.com" like "//evil.com", and skip tabs and line
 * breaks in addresses, so paths with backslashes or those are refused too.
 */
export function safeRedirectPath(path: string | undefined): string {
  if (path && path.startsWith("/") && !path.startsWith("//") && !/[\\\x00-\x1f]/.test(path)) {
    return path;
  }
  return "/";
}
