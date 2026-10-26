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
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

/** The kinds of music file we store, and how to show each one. */
export const FILE_KIND_LABELS: Record<string, string> = {
  recording: "Recording",
  sheet: "Sheet music",
  chords: "Chord chart",
  other: "Other",
};

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
 */
export function safeRedirectPath(path: string | undefined): string {
  if (path && path.startsWith("/") && !path.startsWith("//")) {
    return path;
  }
  return "/";
}
