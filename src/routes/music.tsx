// ===========================================================================
// The music library: songs, and their recordings, sheet music and chord
// charts. The files themselves are stored in R2 (Cloudflare's file storage).
//
// Who can see this is set by EVERYTHING_PUBLIC in wrangler.jsonc
// ("yes" = everyone, "no" = logged-in members only).
// ===========================================================================

import { Hono } from "hono";
import { getSong, getSongFile, getSongFiles, getSongs } from "../database";
import { canSeeMemberPages, FILE_KIND_LABELS, formatFileSize } from "../helpers";
import { sendFileFromStorage } from "../files";
import { requireMemberAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv, SongFileRow } from "../types";

const routes = new Hono<AppEnv>();

// Check the visitor is allowed in before any page in this file.
routes.use("/music", requireMemberAccess);
routes.use("/music/*", requireMemberAccess);
// (Files check access themselves: see /files/:id below.)

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
      {(song.youtube_url !== "" || song.sheet_music_url !== "") && (
        <p class="setlist-links">
          {song.youtube_url !== "" && (
            <a href={song.youtube_url} target="_blank" rel="noopener">Listen on YouTube</a>
          )}
          {song.sheet_music_url !== "" && (
            <a href={song.sheet_music_url} target="_blank" rel="noopener">Sheet music (external)</a>
          )}
        </p>
      )}

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
//
// Sheet music and chord charts are always public, because set lists link
// to them so anyone can see what the choir will sing. Recordings and other
// files follow EVERYTHING_PUBLIC like the rest of the music library.
// ---------------------------------------------------------------------------
routes.get("/files/:id", async (c) => {
  const fileId = Number(c.req.param("id"));
  const file = await getSongFile(c.env.DB, fileId);
  if (file === null) {
    return c.text("File not found", 404);
  }

  const isSheetMusic = file.kind === "sheet" || file.kind === "chords";
  if (!isSheetMusic && !canSeeMemberPages(c)) {
    return c.redirect("/login?next=" + encodeURIComponent(c.req.path));
  }

  return await sendFileFromStorage(c, file.r2_key, file.filename, file.content_type);
});

export default routes;
