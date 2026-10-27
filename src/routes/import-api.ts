// ===========================================================================
// The bulk import of the music library (used by tools/import_music.py).
//
//   GET  /api/import/done        every file already imported: one per line,
//                                fingerprint, path, song title, kind, key
//                                and version, with a tab between each
//   POST /api/import/song-file   upload one file (or a new copy of an edited one)
//   POST /api/import/update      a file was renamed or moved, or its song,
//                                kind, key or version changed: no upload needed
//   POST /api/import/delete      a file was removed from your music folders
//
// And the same four for Sunday and service PowerPoints (used by
// tools/import_slides.py). These go in the PowerPoint archive, under the
// date they were used, so they show on that day's events:
//
//   GET  /api/import/slides/done     fingerprint, path, title, date, church
//                                    and the fingerprint of its words
//   POST /api/import/slides/file     ?title=&date=&church=&filename=&source=&hash=
//   POST /api/import/slides/update   ?source=&new_source=&title=&date=&church=&filename=
//   POST /api/import/slides/delete   ?source=
//   POST /api/import/slides/words    ?source=&hash= with the words on its
//                                    slides as the body, for searching
//
// These aren't pages for people. The import script sends the secret
// IMPORT_TOKEN in an "Authorization: Bearer ..." header instead of logging
// in. Set it with `npx wrangler secret put IMPORT_TOKEN`. With no
// IMPORT_TOKEN set, both addresses are switched off.
//
// For POST, the body of the request is the file itself, and everything we
// know about it is in the address, e.g.
//   /api/import/song-file?title=Priestly%20People&kind=sheet&key=G
//     &version=with%20intro&filename=Priestly%20People.pdf&source=C:\...
//     &hash=3f2a...&section=prayers
// If no song has that title yet, one is made. section=prayers puts the song
// under Prayers and services (prayers, rosaries, special services); without
// it, a new song goes in the music library. If this source was imported
// before with a different fingerprint (the file was edited), the copy on
// the site is replaced, and its song, kind, key and version updated.
//
// A song left with no files after an update or delete is kept (it may be
// in a set list); it shows under "Resolve now" on the admin songs page.
// ===========================================================================

import { Hono } from "hono";
import type { Context } from "hono";
import {
  addSongFile,
  createSong,
  deleteSongFileRecord,
  findSongByTitle,
  addImportedPowerpoint,
  getImportedFiles,
  getImportedPowerpoints,
  getPowerpointBySourcePath,
  getSongFileBySourcePath,
  getStorageUsed,
  deletePowerpointRecord,
  replacePowerpointContents,
  replaceSongFileContents,
  updateImportedPowerpoint,
  setPowerpointWords,
  setSongSection,
  updateImportedSongFile,
} from "../database";
import { makeStorageKey } from "../files";
import { FILE_KIND_LABELS, readSongSection, workOutContentType, wouldGoOverFreeStorage } from "../helpers";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

/** True if the request carries the right IMPORT_TOKEN. */
async function hasImportToken(c: Context<AppEnv>): Promise<boolean> {
  const expected = c.env.IMPORT_TOKEN ?? "";
  if (expected === "") {
    return false;
  }
  const given = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");

  // Compare hashes of the two, so that comparing takes the same time
  // however many letters match (otherwise the time could leak the token).
  const encoder = new TextEncoder();
  const givenHash = await crypto.subtle.digest("SHA-256", encoder.encode(given));
  const expectedHash = await crypto.subtle.digest("SHA-256", encoder.encode(expected));
  return crypto.subtle.timingSafeEqual(givenHash, expectedHash);
}

routes.use("/api/import/*", async (c, next) => {
  if (!(await hasImportToken(c))) {
    return c.text("Wrong or missing import token.", 401);
  }
  await next();
});

routes.get("/api/import/done", async (c) => {
  const files = await getImportedFiles(c.env.DB);
  const lines = files.map((file) =>
    [file.source_hash, file.source_path, file.title, file.kind, file.music_key, file.version].join("\t"),
  );
  return c.text(lines.join("\n"));
});

/**
 * The song with this title, or a new one. A file from a prayers folder
 * moves its song there, e.g. when the Creed's chord chart was imported
 * before its slides.
 */
async function findOrMakeSong(db: D1Database, title: string, section: "music" | "prayers"): Promise<number> {
  const song = await findSongByTitle(db, title);
  if (song !== null) {
    if (section === "prayers" && song.section !== "prayers") {
      await setSongSection(db, song.id, "prayers");
    }
    return song.id;
  }
  return await createSong(db, {
    title: title,
    author: "",
    songKey: "",
    ccliNumber: "",
    notes: "",
    youtubeUrl: "",
    sheetMusicUrl: "",
    section: section,
  });
}

// A file was renamed or moved on your computer (source -> new_source), or
// its title, kind, key or version changed in the spreadsheet. The file in
// R2 stays as it is; only what we know about it changes.
routes.post("/api/import/update", async (c) => {
  const source = (c.req.query("source") ?? "").trim();
  const newSource = (c.req.query("new_source") ?? source).trim();
  const title = (c.req.query("title") ?? "").trim();
  const kind = c.req.query("kind") ?? "";
  const filename = (c.req.query("filename") ?? "").trim();
  if (source === "" || newSource === "" || title === "" || filename === "" || !(kind in FILE_KIND_LABELS)) {
    return c.text("source, title, kind and filename are all needed.", 400);
  }

  const file = await getSongFileBySourcePath(c.env.DB, source);
  if (file === null) {
    return c.text("Not found: " + source, 404);
  }
  if (newSource !== source && (await getSongFileBySourcePath(c.env.DB, newSource)) !== null) {
    return c.text("Already on the site: " + newSource, 409);
  }

  const songId = await findOrMakeSong(c.env.DB, title, readSongSection(c.req.query("section") ?? ""));
  await updateImportedSongFile(
    c.env.DB,
    file.id,
    songId,
    kind,
    (c.req.query("key") ?? "").trim(),
    (c.req.query("version") ?? "").trim(),
    filename,
    newSource,
  );
  return c.text("updated (song " + songId + ")");
});

// A file was removed from your music folders (or marked "skip"): remove it
// from R2 and from the song.
routes.post("/api/import/delete", async (c) => {
  const source = (c.req.query("source") ?? "").trim();
  const file = await getSongFileBySourcePath(c.env.DB, source);
  if (file === null) {
    return c.text("already gone");
  }
  await c.env.MUSIC.delete(file.r2_key);
  await deleteSongFileRecord(c.env.DB, file.id);
  return c.text("deleted from song " + file.song_id);
});

routes.post("/api/import/song-file", async (c) => {
  const title = (c.req.query("title") ?? "").trim();
  const kind = c.req.query("kind") ?? "";
  const musicKey = (c.req.query("key") ?? "").trim();
  const version = (c.req.query("version") ?? "").trim();
  const filename = (c.req.query("filename") ?? "").trim();
  const source = (c.req.query("source") ?? "").trim();
  const section = readSongSection(c.req.query("section") ?? "");
  // The file's fingerprint (its SHA-256), worked out by the script on your
  // computer. We don't work it out again here: on Cloudflare's free plan
  // each request only gets a few milliseconds of computer time.
  let hash = (c.req.query("hash") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    hash = "";
  }

  if (title === "" || filename === "" || source === "") {
    return c.text("title, filename and source are all needed.", 400);
  }
  if (!(kind in FILE_KIND_LABELS)) {
    return c.text("Unknown kind: " + kind, 400);
  }

  // Uploaded on an earlier run, and not edited since? Nothing to do.
  const existing = await getSongFileBySourcePath(c.env.DB, source);
  if (existing !== null && hash !== "" && existing.source_hash === hash) {
    return c.text("already imported");
  }

  // The file's size, from the request. We pass the file straight on to R2
  // instead of holding it all in memory, because the free plan only gives
  // each request 128 MB of memory.
  const size = Number(c.req.header("Content-Length") ?? "0");
  const body = c.req.raw.body;
  if (size === 0 || body === null) {
    return c.text("The file is empty.", 400);
  }
  const contentType = workOutContentType(filename, "");

  // Stop before going over Cloudflare's free 10 GB of storage. A replaced
  // file frees up the space of its old copy.
  const freedUp = existing !== null ? existing.size : 0;
  if (wouldGoOverFreeStorage((await getStorageUsed(c.env.DB)) - freedUp, size)) {
    return c.text("Storage full: this file would go over Cloudflare's free 10 GB.", 507);
  }

  const songId = await findOrMakeSong(c.env.DB, title, section);

  // Edited since last time: put the new copy in R2, point the song file
  // at it (and at the right song, kind, key and version), then remove the
  // old copy.
  if (existing !== null) {
    const newR2Key = makeStorageKey("songs/" + songId, filename);
    await c.env.MUSIC.put(newR2Key, body, { httpMetadata: { contentType: contentType } });
    await replaceSongFileContents(c.env.DB, existing.id, newR2Key, filename, contentType, size, hash);
    await updateImportedSongFile(c.env.DB, existing.id, songId, kind, musicKey, version, filename, source);
    await c.env.MUSIC.delete(existing.r2_key);
    return c.text("replaced the copy on song " + songId);
  }

  const r2Key = makeStorageKey("songs/" + songId, filename);
  await c.env.MUSIC.put(r2Key, body, { httpMetadata: { contentType: contentType } });
  await addSongFile(c.env.DB, {
    songId: songId,
    kind: kind,
    musicKey: musicKey,
    version: version,
    r2Key: r2Key,
    filename: filename,
    contentType: contentType,
    size: size,
    sourcePath: source,
    sourceHash: hash,
  });

  return c.text("added to song " + songId);
});

// ---------------------------------------------------------------------------
// Sunday and service PowerPoints
// ---------------------------------------------------------------------------

/** A "YYYY-MM-DD" date from the address, or "" if it isn't one. */
function readDate(text: string | undefined): string {
  const date = (text ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

routes.get("/api/import/slides/done", async (c) => {
  const powerpoints = await getImportedPowerpoints(c.env.DB);
  const lines = powerpoints.map((powerpoint) =>
    [
      powerpoint.source_hash,
      powerpoint.source_path,
      powerpoint.title,
      powerpoint.service_date,
      powerpoint.church,
      powerpoint.text_hash,
    ].join("\t"),
  );
  return c.text(lines.join("\n"));
});

// Renamed or moved on your computer, or a new title or date in the
// spreadsheet. The file in R2 stays as it is.
routes.post("/api/import/slides/update", async (c) => {
  const source = (c.req.query("source") ?? "").trim();
  const newSource = (c.req.query("new_source") ?? source).trim();
  const title = (c.req.query("title") ?? "").trim();
  const date = readDate(c.req.query("date"));
  const filename = (c.req.query("filename") ?? "").trim();
  if (source === "" || newSource === "" || title === "" || date === "" || filename === "") {
    return c.text("source, title, date (YYYY-MM-DD) and filename are all needed.", 400);
  }

  const powerpoint = await getPowerpointBySourcePath(c.env.DB, source);
  if (powerpoint === null) {
    return c.text("Not found: " + source, 404);
  }
  if (newSource !== source && (await getPowerpointBySourcePath(c.env.DB, newSource)) !== null) {
    return c.text("Already on the site: " + newSource, 409);
  }
  const church = (c.req.query("church") ?? "").trim();
  await updateImportedPowerpoint(c.env.DB, powerpoint.id, title, date, church, filename, newSource);
  return c.text("updated");
});

// Removed from your folders (or marked "skip").
routes.post("/api/import/slides/delete", async (c) => {
  const source = (c.req.query("source") ?? "").trim();
  const powerpoint = source === "" ? null : await getPowerpointBySourcePath(c.env.DB, source);
  if (powerpoint === null) {
    return c.text("already gone");
  }
  await c.env.MUSIC.delete(powerpoint.r2_key);
  await deletePowerpointRecord(c.env.DB, powerpoint.id);
  return c.text("deleted");
});

routes.post("/api/import/slides/file", async (c) => {
  const title = (c.req.query("title") ?? "").trim();
  const date = readDate(c.req.query("date"));
  const filename = (c.req.query("filename") ?? "").trim();
  const source = (c.req.query("source") ?? "").trim();
  const church = (c.req.query("church") ?? "").trim();
  // Worked out by the script, as for song files above.
  let hash = (c.req.query("hash") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    hash = "";
  }
  if (title === "" || date === "" || filename === "" || source === "") {
    return c.text("title, date (YYYY-MM-DD), filename and source are all needed.", 400);
  }

  const existing = await getPowerpointBySourcePath(c.env.DB, source);
  if (existing !== null && hash !== "" && existing.source_hash === hash) {
    return c.text("already imported");
  }

  // Passed straight on to R2, as for song files above.
  const size = Number(c.req.header("Content-Length") ?? "0");
  const body = c.req.raw.body;
  if (size === 0 || body === null) {
    return c.text("The file is empty.", 400);
  }
  const contentType = workOutContentType(filename, "");

  const freedUp = existing !== null ? existing.size : 0;
  if (wouldGoOverFreeStorage((await getStorageUsed(c.env.DB)) - freedUp, size)) {
    return c.text("Storage full: this file would go over Cloudflare's free 10 GB.", 507);
  }

  const r2Key = makeStorageKey("powerpoints", filename);
  await c.env.MUSIC.put(r2Key, body, { httpMetadata: { contentType: contentType } });

  // Edited since last time: point it at the new copy, then remove the old one.
  if (existing !== null) {
    await replacePowerpointContents(c.env.DB, existing.id, r2Key, contentType, size, hash);
    await updateImportedPowerpoint(c.env.DB, existing.id, title, date, church, filename, source);
    await c.env.MUSIC.delete(existing.r2_key);
    return c.text("replaced the copy on the site");
  }

  await addImportedPowerpoint(
    c.env.DB,
    {
      title: title,
      serviceDate: date,
      notes: "",
      eventId: null,
      r2Key: r2Key,
      filename: filename,
      contentType: contentType,
      size: size,
    },
    church,
    source,
    hash,
  );
  return c.text("added");
});

// The words on a PowerPoint's slides, pulled out by the script on your
// computer (reading a PowerPoint here would take more time than the free
// plan gives each request). They're kept so the site's search finds them.
routes.post("/api/import/slides/words", async (c) => {
  const source = (c.req.query("source") ?? "").trim();
  const hash = (c.req.query("hash") ?? "").trim().toLowerCase();
  const powerpoint = source === "" ? null : await getPowerpointBySourcePath(c.env.DB, source);
  if (powerpoint === null) {
    return c.text("Not found: " + source, 404);
  }
  // At most about 100,000 letters (the script sends no more than that).
  const size = Number(c.req.header("Content-Length") ?? "0");
  if (size > 400_000) {
    return c.text("Too many words.", 413);
  }
  const words = (await c.req.text()).slice(0, 100_000);
  await setPowerpointWords(c.env.DB, powerpoint.id, words, /^[0-9a-f]{64}$/.test(hash) ? hash : "");
  return c.text("words saved");
});

export default routes;
