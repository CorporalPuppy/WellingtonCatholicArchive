// ===========================================================================
// The music library: songs, and their recordings, sheet music and chord
// charts. The files themselves are stored in R2 (Cloudflare's file storage).
//
// Who can see this is set by MUSIC_ACCESS in wrangler.jsonc
// ("members" = logged-in members only, "public" = everyone).
// ===========================================================================

import { Hono } from "hono";
import { getSong, getSongFile, getSongFiles, getSongs } from "../database";
import { FILE_KIND_LABELS, formatFileSize } from "../helpers";
import { requireMusicAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv, SongFileRow } from "../types";

const routes = new Hono<AppEnv>();

// Check the visitor is allowed in before any page in this file.
routes.use("/music", requireMusicAccess);
routes.use("/music/*", requireMusicAccess);
routes.use("/files/*", requireMusicAccess);

// ---------------------------------------------------------------------------
// List of songs, with a search box: GET /music?search=amazing
// ---------------------------------------------------------------------------
routes.get("/music", async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const songs = await getSongs(c.env.DB, search);

  return renderPage(
    c,
    "Music",
    <>
      <h1>Music library</h1>
      <form method="get" action="/music" class="search">
        <input type="search" name="search" value={search} placeholder="Search by title or author" />
        <button type="submit">Search</button>
      </form>

      {songs.length === 0 && <p>No songs found.</p>}
      <ul class="song-list">
        {songs.map((song) => (
          <li>
            <a href={"/music/" + song.id}>{song.title}</a>
            {song.author !== "" && <span class="muted"> - {song.author}</span>}
          </li>
        ))}
      </ul>
    </>,
  );
});

// ---------------------------------------------------------------------------
// One song and its files: GET /music/123
// ---------------------------------------------------------------------------
routes.get("/music/:id", async (c) => {
  const songId = Number(c.req.param("id"));
  const song = await getSong(c.env.DB, songId);
  if (song === null) {
    return renderPage(c, "Not found", <p>Sorry, we couldn't find that song.</p>, 404);
  }
  const files = await getSongFiles(c.env.DB, songId);

  return renderPage(
    c,
    song.title,
    <>
      <p><a href="/music">Back to all songs</a></p>
      <h1>{song.title}</h1>
      {song.author !== "" && <p>By {song.author}</p>}
      {song.song_key !== "" && <p>Key: {song.song_key}</p>}
      {song.ccli_number !== "" && <p class="muted">CCLI song number: {song.ccli_number}</p>}
      {song.notes !== "" && <p>{song.notes}</p>}

      <h2>Files</h2>
      {files.length === 0 && <p>No files uploaded yet.</p>}
      <ul class="file-list">
        {files.map((file) => (
          <SongFileItem file={file} />
        ))}
      </ul>
    </>,
  );
});

/** One file on the song page: a player for recordings, links for the rest. */
function SongFileItem(props: { file: SongFileRow }) {
  const file = props.file;
  const viewUrl = "/files/" + file.id;
  const downloadUrl = "/files/" + file.id + "?download=1";
  const isAudio = file.content_type.startsWith("audio/");

  return (
    <li>
      <strong>{FILE_KIND_LABELS[file.kind]}</strong>: {file.filename}{" "}
      <span class="muted">({formatFileSize(file.size)})</span>
      <br />
      {isAudio && <audio controls preload="none" src={viewUrl}></audio>}
      {!isAudio && (
        <a href={viewUrl} target="_blank">
          Open
        </a>
      )}{" "}
      <a href={downloadUrl}>Download</a>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sending a file from R2 to the browser: GET /files/45
//
// Add ?download=1 to save the file instead of opening it.
// Audio players ask for small pieces of the file at a time (so you can skip
// ahead); these are called "range requests" and R2 handles them for us.
// ---------------------------------------------------------------------------
routes.get("/files/:id", async (c) => {
  const fileId = Number(c.req.param("id"));
  const file = await getSongFile(c.env.DB, fileId);
  if (file === null) {
    return c.text("File not found", 404);
  }

  // Passing the request headers lets R2 read any "Range" the browser asked for.
  const object = await c.env.MUSIC.get(file.r2_key, { range: c.req.raw.headers });
  if (object === null) {
    return c.text("File not found in storage", 404);
  }

  const headers = new Headers();
  headers.set("Content-Type", file.content_type);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");

  // "attachment" = save the file, "inline" = show it in the browser.
  const disposition = c.req.query("download") ? "attachment" : "inline";
  headers.set("Content-Disposition", disposition + "; filename*=UTF-8''" + encodeURIComponent(file.filename));

  // Members-only files must not be stored by shared caches.
  if (c.env.MUSIC_ACCESS === "public") {
    headers.set("Cache-Control", "public, max-age=3600");
  } else {
    headers.set("Cache-Control", "private, max-age=3600");
  }

  // If only part of the file was asked for, say which part we're sending.
  const askedForRange = c.req.header("Range") !== undefined;
  if (askedForRange && object.range) {
    const range = object.range as { offset?: number; length?: number; suffix?: number };
    let start = 0;
    let length = object.size;
    if (range.suffix !== undefined) {
      start = object.size - range.suffix;
      length = range.suffix;
    } else {
      start = range.offset ?? 0;
      length = range.length ?? object.size - start;
    }
    const end = start + length - 1;
    headers.set("Content-Range", "bytes " + start + "-" + end + "/" + object.size);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers: headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers: headers });
});

export default routes;
