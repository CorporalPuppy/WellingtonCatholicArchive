// ===========================================================================
// The music library: songs, and each song's resources: sheet music PDFs,
// chord charts, MuseScore files and recordings. The files themselves are
// stored in R2 (Cloudflare's file storage).
//
// Who can see this is set by EVERYTHING_PUBLIC in wrangler.jsonc
// ("yes" = everyone, "no" = logged-in members only).
// ===========================================================================

import { Hono } from "hono";
import { getSong, getSongFile, getSongFiles, getSongs } from "../database";
import { canSeeMemberPages, formatFileSize, isAlwaysPublicKind } from "../helpers";
import { sendFileFromStorage } from "../files";
import { requireMemberAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { Context } from "hono";
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
      <p><a class="back-link" href="/music">Back to all songs</a></p>
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

      {files.length === 0 && <p>No files uploaded yet.</p>}

      {/*
        Each kind of resource gets its own dropdown (<details>), so you can
        open just the one you need. The first one starts open.
        Kinds with no files are left out.
      */}
      {sectionsWithFiles(files).map((section, index) => (
        <details class="file-section" open={index === 0}>
          <summary>
            <span class="file-section-heading">{section.heading}</span>
            <span class="count-pill">{section.files.length}</span>
          </summary>
          {section.help !== "" && <p class="muted">{section.help}</p>}
          <ul class="file-list">
            {section.files.map((file) => (
              <SongFileItem file={file} siteAddress={siteAddress(c)} />
            ))}
          </ul>
        </details>
      ))}
    </>,
  );
});

/** The sections on a song page, in the order they appear. */
const FILE_SECTIONS = [
  { kind: "sheet", heading: "Sheet music", help: "" },
  { kind: "chords", heading: "Chord charts", help: "" },
  {
    kind: "musescore",
    heading: "MuseScore files",
    help: "Open these in the free MuseScore app (musescore.org) to play, transpose or print.",
  },
  { kind: "recording", heading: "Recordings", help: "" },
  { kind: "other", heading: "Other files", help: "" },
];

/** The sections that have at least one file, each with its list of files. */
function sectionsWithFiles(files: SongFileRow[]) {
  const result = [];
  for (const section of FILE_SECTIONS) {
    const filesInSection = files.filter((file) => file.kind === section.kind);
    if (filesInSection.length > 0) {
      result.push({ ...section, files: filesInSection });
    }
  }
  return result;
}

/** This site's address, e.g. "https://ourchoir.nz". */
function siteAddress(c: Context<AppEnv>): string {
  return new URL(c.req.url).origin;
}

/**
 * How (or whether) a file can be previewed on the page:
 *   "audio"  - a player
 *   "pdf"    - shown in a frame (the browser's own PDF viewer)
 *   "image"  - shown as a picture
 *   "text"   - shown in a frame
 *   "office" - a Word or PowerPoint file, shown with Microsoft's free online
 *              viewer (only works once the site is online, not on your
 *              own computer, and only for files anyone can open)
 *   "none"   - no preview, just download (e.g. MuseScore files)
 */
function previewType(file: SongFileRow): string {
  const name = file.filename.toLowerCase();
  const type = file.content_type;

  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type === "text/plain" || name.endsWith(".txt") || name.endsWith(".cho") || name.endsWith(".chordpro")) return "text";

  const isOfficeFile = name.endsWith(".doc") || name.endsWith(".docx") || name.endsWith(".ppt") || name.endsWith(".pptx");
  if (isOfficeFile && isAlwaysPublicKind(file.kind)) return "office";

  return "none";
}

/** One file: its name, a preview (if possible) and a download button. */
function SongFileItem(props: { file: SongFileRow; siteAddress: string }) {
  const file = props.file;
  const viewUrl = "/files/" + file.id;
  const downloadUrl = "/files/" + file.id + "?download=1";
  const preview = previewType(file);

  // Microsoft's viewer needs the full address of the file.
  const officeViewerUrl =
    "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(props.siteAddress + viewUrl);

  return (
    <li>
      <div class="file-row">
        <div>
          <strong>{file.filename}</strong> <span class="muted">({formatFileSize(file.size)})</span>
        </div>
        <div class="file-actions">
          {preview !== "none" && preview !== "audio" && (
            <a href={viewUrl} target="_blank" class="button button-small button-secondary">
              Open
            </a>
          )}
          <a href={downloadUrl} class="button button-small">
            Download
          </a>
        </div>
      </div>

      {preview === "audio" && <audio controls preload="none" src={viewUrl}></audio>}

      {/* <details> is a built-in show/hide box: click "Preview" to open it. */}
      {(preview === "pdf" || preview === "text") && (
        <details class="preview">
          <summary>Preview</summary>
          <iframe src={viewUrl} title={"Preview of " + file.filename} loading="lazy"></iframe>
        </details>
      )}
      {preview === "image" && (
        <details class="preview">
          <summary>Preview</summary>
          <img src={viewUrl} alt={"Preview of " + file.filename} loading="lazy" />
        </details>
      )}
      {preview === "office" && (
        <details class="preview">
          <summary>Preview</summary>
          <iframe src={officeViewerUrl} title={"Preview of " + file.filename} loading="lazy"></iframe>
        </details>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sending a file from R2 to the browser: GET /files/45
//
// Add ?download=1 to save the file instead of opening it.
//
// Sheet music, chord charts and MuseScore files are always public, because
// set lists link to them so anyone can see what the choir will sing.
// Recordings and other files follow EVERYTHING_PUBLIC like the rest of the
// music library.
// ---------------------------------------------------------------------------
routes.get("/files/:id", async (c) => {
  const fileId = Number(c.req.param("id"));
  const file = await getSongFile(c.env.DB, fileId);
  if (file === null) {
    return c.text("File not found", 404);
  }

  if (!isAlwaysPublicKind(file.kind) && !canSeeMemberPages(c)) {
    return c.redirect("/login?next=" + encodeURIComponent(c.req.path));
  }

  return await sendFileFromStorage(c, file.r2_key, file.filename, file.content_type);
});

export default routes;
