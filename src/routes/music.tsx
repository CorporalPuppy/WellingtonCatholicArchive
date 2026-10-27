// ===========================================================================
// The music library: songs, and each song's resources: sheet music PDFs,
// chord charts, MuseScore files and recordings. The files themselves are
// stored in R2 (Cloudflare's file storage).
//
// Prayers and services (the Creeds, the Prayer of St Francis, rosaries,
// special services...) are kept the same way, but listed on their own
// page: /prayers. They are songs with section = "prayers".
//
// Who can see this is set by EVERYTHING_PUBLIC in wrangler.jsonc
// ("yes" = everyone, "no" = logged-in members only).
// ===========================================================================

import { Hono } from "hono";
import { getSong, getSongFile, getSongFiles, getSongs } from "../database";
import { canSeeMemberPages, describeFileLabels, formatFileSize, isAlwaysPublicKind, splitTags } from "../helpers";
import { sendFileFromStorage } from "../files";
import { requireMemberAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { Context } from "hono";
import type { AppEnv, SongFileRow } from "../types";

const routes = new Hono<AppEnv>();

// Check the visitor is allowed in before any page in this file.
routes.use("/music", requireMemberAccess);
routes.use("/music/*", requireMemberAccess);
routes.use("/prayers", requireMemberAccess);
routes.use("/prayers/*", requireMemberAccess);
// (Files check access themselves: see /files/:id below.)

// ---------------------------------------------------------------------------
// List of songs, with a search box: GET /music?search=amazing
//   and a tag filter:                GET /music?tag=Marian
// List of prayers and services:      GET /prayers?search=creed
// ---------------------------------------------------------------------------
routes.get("/music", async (c) => {
  return await showSongList(c, "music");
});

routes.get("/prayers", async (c) => {
  return await showSongList(c, "prayers");
});

async function showSongList(c: Context<AppEnv>, section: "music" | "prayers") {
  const search = (c.req.query("search") ?? "").trim();
  const tag = c.req.query("tag") ?? "";
  const allSongs = await getSongs(c.env.DB, search, section);
  // Every tag used in this section, for the tag menu.
  const allTags = [...new Set(allSongs.flatMap((song) => splitTags(song.tags)))].sort((a, b) => a.localeCompare(b));
  const songs = tag === "" ? allSongs : allSongs.filter((song) => splitTags(song.tags).includes(tag));
  const isPrayers = section === "prayers";
  const address = isPrayers ? "/prayers" : "/music";

  return renderPage(
    c,
    isPrayers ? "Prayers and services" : "Music",
    <>
      <h1>{isPrayers ? "Prayers and services" : "Music library"}</h1>
      <p class="muted">
        {isPrayers ? (
          <>Slides and words for prayers, rosaries and special services. Looking for a hymn? See the <a href="/music">music library</a>.</>
        ) : (
          <>Looking for the Creed, a rosary or another prayer? See <a href="/prayers">Prayers and services</a>.</>
        )}
      </p>
      <form method="get" action={address} class="search">
        <input type="search" name="search" value={search} placeholder={isPrayers ? "Search by name or tag" : "Search by title, author or tag"} />
        {allTags.length > 0 && (
          <select name="tag" aria-label="Tag" onchange="this.form.submit()" class="tag-filter">
            <option value="">Any tag</option>
            {allTags.map((each) => (
              <option value={each} selected={tag === each}>{each}</option>
            ))}
          </select>
        )}
        <button type="submit">Search</button>
      </form>

      {songs.length === 0 && <p>{isPrayers ? "Nothing found." : "No songs found."}</p>}
      <ul class="song-list">
        {songs.map((song) => (
          <li>
            {/* The whole card is the link: the title, with the author underneath */}
            <a href={address + "/" + song.id} class="song-card">
              <strong>{song.title}</strong>
              {song.author !== "" && <span class="muted">{song.author}</span>}
              {song.tags !== "" && <span class="song-tags">{splitTags(song.tags).join(" · ")}</span>}
              <span class="song-card-key">{song.song_key !== "" && "Key " + song.song_key}</span>
            </a>
          </li>
        ))}
      </ul>
    </>,
  );
}

// ---------------------------------------------------------------------------
// One song and its files: GET /music/123 (or /prayers/123)
// ---------------------------------------------------------------------------
routes.get("/music/:id", async (c) => {
  return await showSong(c, Number(c.req.param("id")));
});

routes.get("/prayers/:id", async (c) => {
  return await showSong(c, Number(c.req.param("id")));
});

async function showSong(c: Context<AppEnv>, songId: number) {
  const song = await getSong(c.env.DB, songId);
  if (song === null) {
    return renderPage(c, "Not found", <p>Sorry, we couldn't find that song.</p>, 404);
  }
  const files = await getSongFiles(c.env.DB, songId);
  const isPrayer = song.section === "prayers";

  return renderPage(
    c,
    song.title,
    <>
      <p>
        {isPrayer ? (
          <a class="back-link" href="/prayers">Back to prayers and services</a>
        ) : (
          <a class="back-link" href="/music">Back to all songs</a>
        )}
      </p>
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
}

/** The sections on a song page, in the order they appear. */
const FILE_SECTIONS = [
  { kind: "sheet", heading: "Sheet music", help: "" },
  { kind: "chords", heading: "Chord charts", help: "" },
  {
    kind: "musescore",
    heading: "MuseScore files",
    help: "Open these in the free MuseScore app (musescore.org) to play, transpose or print.",
  },
  { kind: "lyrics", heading: "Lyrics", help: "" },
  { kind: "slides", heading: "Slides", help: "PowerPoints of the words, for the screen at Mass." },
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
  const labels = describeFileLabels(file.music_key, file.version);

  // Microsoft's viewer needs the full address of the file.
  const officeViewerUrl =
    "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(props.siteAddress + viewUrl);

  return (
    <li>
      <div class="file-row">
        <div>
          <strong>{file.filename}</strong> <span class="muted">({formatFileSize(file.size)})</span>
          {labels !== "" && <div class="file-labels">{labels}</div>}
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
