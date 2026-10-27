// ===========================================================================
// The bulk import of the music library (used by tools/import_music.py).
//
//   GET  /api/import/done        every file already imported (one path per line)
//   POST /api/import/song-file   upload one file
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
// If no song has that title yet, one is made.
// ===========================================================================

import { Hono } from "hono";
import type { Context } from "hono";
import { addSongFile, createSong, findSongByTitle, getImportedSourcePaths, getStorageUsed, isSourcePathImported } from "../database";
import { makeStorageKey } from "../files";
import { FILE_KIND_LABELS, workOutContentType, wouldGoOverFreeStorage } from "../helpers";
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
  const paths = await getImportedSourcePaths(c.env.DB);
  return c.text(paths.join("\n"));
});

routes.post("/api/import/song-file", async (c) => {
  const title = (c.req.query("title") ?? "").trim();
  const kind = c.req.query("kind") ?? "";
  const musicKey = (c.req.query("key") ?? "").trim();
  const version = (c.req.query("version") ?? "").trim();
  const filename = (c.req.query("filename") ?? "").trim();
  const source = (c.req.query("source") ?? "").trim();

  if (title === "" || filename === "" || source === "") {
    return c.text("title, filename and source are all needed.", 400);
  }
  if (!(kind in FILE_KIND_LABELS)) {
    return c.text("Unknown kind: " + kind, 400);
  }

  // Already uploaded on an earlier run? Then there's nothing to do.
  if (await isSourcePathImported(c.env.DB, source)) {
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

  // Stop before going over Cloudflare's free 10 GB of storage.
  if (wouldGoOverFreeStorage(await getStorageUsed(c.env.DB), size)) {
    return c.text("Storage full: this file would go over Cloudflare's free 10 GB.", 507);
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

  const contentType = workOutContentType(filename, "");
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
  });

  return c.text(song !== null ? "added to song " + songId : "made new song " + songId);
});

export default routes;
