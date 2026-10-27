// ===========================================================================
// The bulk import of the music library (used by tools/import_music.py).
//
//   GET  /api/import/done        every file already imported: one per line,
//                                its fingerprint, a tab, then its path
//   POST /api/import/song-file   upload one file (or a new copy of an edited one)
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
//     &hash=3f2a...
// If no song has that title yet, one is made. If this source was imported
// before with a different fingerprint (the file was edited), the copy on
// the site is replaced and keeps its place, kind, key and version.
// ===========================================================================

import { Hono } from "hono";
import type { Context } from "hono";
import {
  addSongFile,
  createSong,
  findSongByTitle,
  getImportedFiles,
  getSongFileBySourcePath,
  replaceSongFileContents,
} from "../database";
import { makeStorageKey } from "../files";
import { FILE_KIND_LABELS, workOutContentType } from "../helpers";
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
  return c.text(files.map((file) => file.source_hash + "\t" + file.source_path).join("\n"));
});

routes.post("/api/import/song-file", async (c) => {
  const title = (c.req.query("title") ?? "").trim();
  const kind = c.req.query("kind") ?? "";
  const musicKey = (c.req.query("key") ?? "").trim();
  const version = (c.req.query("version") ?? "").trim();
  const filename = (c.req.query("filename") ?? "").trim();
  const source = (c.req.query("source") ?? "").trim();
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

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return c.text("The file is empty.", 400);
  }
  const contentType = workOutContentType(filename, "");

  // Edited since last time: put the new copy in R2, point the song file
  // at it, then remove the old copy.
  if (existing !== null) {
    const newR2Key = makeStorageKey("songs/" + existing.song_id, filename);
    await c.env.MUSIC.put(newR2Key, body, { httpMetadata: { contentType: contentType } });
    await replaceSongFileContents(c.env.DB, existing.id, newR2Key, filename, contentType, body.byteLength, hash);
    await c.env.MUSIC.delete(existing.r2_key);
    return c.text("replaced the copy on song " + existing.song_id);
  }

  // Find the song, or make it.
  let songId: number;
  const song = await findSongByTitle(c.env.DB, title);
  if (song !== null) {
    songId = song.id;
  } else {
    songId = await createSong(c.env.DB, {
      title: title,
      author: "",
      songKey: "",
      ccliNumber: "",
      notes: "",
      youtubeUrl: "",
      sheetMusicUrl: "",
    });
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
    size: body.byteLength,
    sourcePath: source,
    sourceHash: hash,
  });

  return c.text(song !== null ? "added to song " + songId : "made new song " + songId);
});

export default routes;
