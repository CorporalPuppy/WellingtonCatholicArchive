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
import { getAllSongFileSummaries, getSong, getSongFile, getSongFiles, getSongs } from "../database";
import type { SongFileSummary } from "../database";
import { canSeeMemberPages, describeFileLabels, formatFileSize, isAlwaysPublicKind, splitTags } from "../helpers";
import { sendFileFromStorage } from "../files";
import { requireMemberAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { Context } from "hono";
import type { AppEnv, SongFileRow, SongRow } from "../types";

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
  // ?has=sheet shows only songs with sheet music (or chords, recording...).
  const has = c.req.query("has") ?? "";
  const filter = RESOURCE_FILTERS.find((item) => item.kind === has) ?? null;
  // ?tag=Marian shows only songs with that tag.
  const tag = c.req.query("tag") ?? "";
  const allSongs = await getSongs(c.env.DB, search, section);
  // Every tag used in this section, for the tag menu.
  const allTags = [...new Set(allSongs.flatMap((song) => splitTags(song.tags)))].sort((a, b) => a.localeCompare(b));
  const filesBySong = groupFilesBySong(await getAllSongFileSummaries(c.env.DB));
  const filesOf = (song: SongRow) => filesBySong.get(song.id) ?? [];
  const songs = allSongs.filter(
    (song) =>
      (filter === null || filesOf(song).some((file) => file.kind === filter.kind)) &&
      (tag === "" || splitTags(song.tags).includes(tag)),
  );
  const isPrayers = section === "prayers";
  const address = isPrayers ? "/prayers" : "/music";
  const groups = groupByFirstLetter(songs);

  /** The address of this page with a different filter, keeping the search. */
  function filterLink(kind: string): string {
    const query = new URLSearchParams();
    if (search !== "") query.set("search", search);
    if (kind !== "") query.set("has", kind);
    if (tag !== "") query.set("tag", tag);
    const text = query.toString();
    return text === "" ? address : address + "?" + text;
  }

  return renderPage(
    c,
    isPrayers ? "Prayers and services" : "Music",
    <div class="music-page">
      <header class="music-hero">
        <p class="music-eyebrow">{isPrayers ? "Prayers and services" : "Music library"}</p>
        <h1 class="music-title">{isPrayers ? "Prayers & services" : "Sheet music & resources"}</h1>
        <p class="music-intro">
          {isPrayers ? (
            <>Slides and words for prayers, rosaries and special services. Looking for a hymn? See the <a href="/music">music library</a>.</>
          ) : (
            <>
              Sheet music, chord charts, MuseScore files, recordings and slides for everything the choir sings. Looking
              for the Creed or a rosary? See <a href="/prayers">Prayers and services</a>.
            </>
          )}
        </p>
        <form method="get" action={address} class="search music-search">
          <input type="search" name="search" value={search} placeholder={isPrayers ? "Search by name or tag" : "Search by title, author or tag"} />
          {filter !== null && <input type="hidden" name="has" value={filter.kind} />}
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
      </header>

      {/* Like a shop's categories: show only songs that have this kind of file. */}
      <nav class="music-filters" aria-label="Show songs with">
        <a href={filterLink("")} class={filter === null ? "active" : ""}>All</a>
        {RESOURCE_FILTERS.map((item) => (
          <a href={filterLink(item.kind)} class={filter !== null && filter.kind === item.kind ? "active" : ""}>
            {item.label}
          </a>
        ))}
      </nav>

      <p class="music-count muted">
        {songs.length === 1 ? "1 " + (isPrayers ? "item" : "song") : songs.length + (isPrayers ? " items" : " songs")}
        {search !== "" && <> matching "{search}"</>}
        {filter !== null && <> with {filter.label.toLowerCase()}</>}
        {tag !== "" && <> tagged {tag}</>}
      </p>

      {/* A to Z: jump straight to a letter. */}
      {groups.length > 1 && (
        <nav class="letter-jump" aria-label="Jump to letter">
          {groups.map((group) => (
            <a href={"#letter-" + group.letter}>{group.letter}</a>
          ))}
        </nav>
      )}

      {songs.length === 0 && <p class="music-empty">{isPrayers ? "Nothing found." : "No songs found."}</p>}

      {groups.map((group) => (
        <section class="letter-group" id={"letter-" + group.letter}>
          <h2 class="letter-heading">{group.letter}</h2>
          <ul class="score-grid">
            {group.songs.map((song) => (
              <li>
                <SongCard song={song} href={address + "/" + song.id} files={filesOf(song)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <CoverPreviewScript />
    </div>,
  );
}

/** The filters along the top of the music library, by kind of file. */
const RESOURCE_FILTERS = [
  { kind: "sheet", label: "Sheet music", short: "Sheet music" },
  { kind: "chords", label: "Chord charts", short: "Chords" },
  { kind: "musescore", label: "MuseScore", short: "MuseScore" },
  { kind: "recording", label: "Recordings", short: "Audio" },
  { kind: "slides", label: "Slides", short: "Slides" },
];

/** Songs in groups by the first letter of their title ("#" for numbers and the rest). */
function groupByFirstLetter(songs: SongRow[]): { letter: string; songs: SongRow[] }[] {
  const groups: { letter: string; songs: SongRow[] }[] = [];
  for (const song of songs) {
    // normalize("NFD") turns "Ō" into "O" plus a macron, which we drop.
    const first = song.title.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    let group = groups.find((item) => item.letter === letter);
    if (group === undefined) {
      group = { letter: letter, songs: [] };
      groups.push(group);
    }
    group.songs.push(song);
  }
  // "#" goes last, after Z.
  return groups.sort((a, b) => (a.letter === "#" ? 1 : b.letter === "#" ? -1 : a.letter.localeCompare(b.letter)));
}

/**
 * One song in the library, drawn like a piece of sheet music in a shop:
 * a "cover" with staff lines and the title, then the title, author and
 * what's available underneath. The whole card is the link.
 */
function SongCard(props: { song: SongRow; href: string; files: SongFileSummary[] }) {
  const song = props.song;
  const available = RESOURCE_FILTERS.filter((item) => props.files.some((file) => file.kind === item.kind));
  return (
    <a href={props.href} class="score-card">
      <ScoreCover song={song} files={props.files} />
      <span class="score-card-text">
        <strong>{song.title}</strong>
        {song.author !== "" && <span class="score-card-author">{song.author}</span>}
        {song.tags !== "" && <span class="song-tags">{splitTags(song.tags).join(" · ")}</span>}
        {available.length > 0 && (
          <span class="score-card-kinds">
            {available.map((item) => (
              <span>{item.short}</span>
            ))}
          </span>
        )}
      </span>
    </a>
  );
}

/** Every song's files, by song id. */
function groupFilesBySong(files: SongFileSummary[]): Map<number, SongFileSummary[]> {
  const bySong = new Map<number, SongFileSummary[]>();
  for (const file of files) {
    bySong.set(file.song_id, [...(bySong.get(file.song_id) ?? []), file]);
  }
  return bySong;
}

/**
 * The file whose first page shows faintly behind a song's cover: sheet
 * music if there is any, then a chord chart, then slides, then anything
 * else. Only PDFs and pictures can be shown, so e.g. a PowerPoint is
 * passed over. null = nothing to show (the cover is just drawn).
 */
function pickCoverFile(files: SongFileSummary[]): SongFileSummary | null {
  const order = ["sheet", "chords", "slides"];
  const showable = files.filter((file) => {
    const type = previewType(file);
    return type === "pdf" || type === "image";
  });
  for (const kind of order) {
    const found = showable.find((file) => file.kind === kind);
    if (found !== undefined) return found;
  }
  return showable[0] ?? null;
}

/**
 * The address of a file for a cover preview. The "v" is part of the
 * file's storage name, which changes when the file is replaced, so the
 * browser can keep its copy for good (see /files/:id below) and only
 * fetches it again after a change.
 */
function coverFileUrl(file: SongFileSummary): string {
  return "/files/" + file.id + "?v=" + fileVersion(file.r2_key);
}

/** A short code that changes whenever a file is replaced: the start of its random storage name. */
function fileVersion(r2Key: string): string {
  return (r2Key.split("/").pop() ?? "").slice(0, 8);
}

/**
 * The paper "cover" of a song: staff lines, the title and its key. Behind
 * it, faintly, the first page of its sheet music (or chords, or slides),
 * if there's one we can show. Pictures are shown straight away; PDFs are
 * drawn by public/covers.js once the cover scrolls into view.
 */
function ScoreCover(props: { song: SongRow; files: SongFileSummary[]; large?: boolean }) {
  const song = props.song;
  const coverFile = pickCoverFile(props.files);
  const coverType = coverFile === null ? "" : previewType(coverFile);
  return (
    <span
      class={props.large ? "score-cover score-cover-large" : "score-cover"}
      aria-hidden="true"
      data-preview-pdf={coverFile !== null && coverType === "pdf" ? coverFileUrl(coverFile) : undefined}
    >
      {coverFile !== null && coverType === "image" && (
        <img class="score-cover-preview" src={coverFileUrl(coverFile)} alt="" loading="lazy" />
      )}
      <span class="score-cover-clef">♫</span>
      <span class="score-cover-title">{song.title}</span>
      {song.author !== "" && <span class="score-cover-author">{song.author}</span>}
      {song.song_key !== "" && <span class="score-cover-key">{song.song_key}</span>}
    </span>
  );
}

/** Loads public/covers.js, which draws the PDF previews behind the covers. */
function CoverPreviewScript() {
  return <script src="/covers.js" defer></script>;
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
  const sections = sectionsWithFiles(files);
  const firstSheet = files.find((file) => file.kind === "sheet" && previewType(file) === "pdf");
  const firstRecording = files.find((file) => file.kind === "recording" && previewType(file) === "audio");

  const facts: string[] = [];
  if (song.song_key !== "") facts.push("Key of " + song.song_key);
  if (song.ccli_number !== "") facts.push("CCLI " + song.ccli_number);

  return renderPage(
    c,
    song.title,
    <div class="music-page">
      <nav class="breadcrumbs" aria-label="You are here">
        {isPrayer ? <a href="/prayers">Prayers and services</a> : <a href="/music">Music library</a>}
        <span aria-hidden="true">/</span>
        <span>{song.title}</span>
      </nav>

      {/* Laid out like a piece in a sheet music shop: the cover on the left, the details on the right. */}
      <section class="song-hero">
        <ScoreCover song={song} files={files} large={true} />
        <div class="song-hero-text">
          {facts.length > 0 && <p class="music-eyebrow">{facts.join(" · ")}</p>}
          <h1 class="music-title">{song.title}</h1>
          {song.author !== "" && <p class="song-byline">{song.author}</p>}
          {song.notes !== "" && <p class="song-notes">{song.notes}</p>}

          {sections.length > 0 && (
            <>
              <h2 class="song-included-heading">Included</h2>
              <ul class="song-included">
                {sections.map((section) => (
                  <li>
                    <a href={"#" + section.kind}>
                      <FileKindIcon kind={section.kind} />
                      {section.heading}
                      {section.files.length > 1 && <span class="muted"> ({section.files.length})</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p class="song-actions">
            {firstSheet !== undefined && (
              <a class="button" href={"/files/" + firstSheet.id} target="_blank">
                Open sheet music
              </a>
            )}
            {song.youtube_url !== "" && (
              <a class="button button-secondary" href={song.youtube_url} target="_blank" rel="noopener">
                Listen on YouTube
              </a>
            )}
            {song.sheet_music_url !== "" && (
              <a class="button button-secondary" href={song.sheet_music_url} target="_blank" rel="noopener">
                Sheet music (external)
              </a>
            )}
          </p>

          {/* A quick listen, without scrolling down to Recordings. */}
          {firstRecording !== undefined && (
            <div class="song-listen">
              <span class="song-listen-label">Listen</span>
              <audio controls preload="none" src={"/files/" + firstRecording.id}></audio>
            </div>
          )}
        </div>
      </section>

      {files.length === 0 && <p class="music-empty">No files uploaded yet.</p>}

      {/*
        Each kind of resource gets its own dropdown (<details>), so you can
        open just the one you need. The first one starts open.
        Kinds with no files are left out.
      */}
      {sections.map((section, index) => (
        <details class="file-section" id={section.kind} open={index === 0}>
          <summary>
            <FileKindIcon kind={section.kind} />
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
      <CoverPreviewScript />
    </div>,
  );
}

/** A small line drawing for each kind of file, in a tinted square. */
function FileKindIcon(props: { kind: string }) {
  const paths: Record<string, string> = {
    // a page with lines of music
    sheet: "M7 3h7l4 4v14H7z M14 3v4h4 M9.5 11h6 M9.5 14h6 M9.5 17h6",
    // a chord grid
    chords: "M7 4h10v16H7z M7 8h10 M7 12h10 M7 16h10 M10.3 4v16 M13.7 4v16",
    // a musical note
    musescore: "M9 18a2 2 0 1 1-2-2 2 2 0 0 1 2 2z M9 18V5l10-2v12 M19 15a2 2 0 1 1-2-2 2 2 0 0 1 2 2z",
    // lines of text
    lyrics: "M5 6h14 M5 10h14 M5 14h10 M5 18h12",
    // a screen on a stand
    slides: "M3 5h18v11H3z M12 16v4 M8 20h8",
    // a play button
    recording: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M10 8.5v7l6-3.5z",
    // a plain page
    other: "M7 3h7l4 4v14H7z M14 3v4h4",
  };
  return (
    <span class={"kind-icon kind-" + props.kind} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d={paths[props.kind] ?? paths.other} />
      </svg>
    </span>
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
function previewType(file: Pick<SongFileRow, "filename" | "content_type" | "kind">): string {
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

  const response = await sendFileFromStorage(c, file.r2_key, file.filename, file.content_type);

  // Cover previews ask for "?v=...", which changes when the file is
  // replaced. So the browser can keep its copy for a year, and scrolling
  // the music library again doesn't use up the free plan's daily requests.
  if (c.req.query("v") === fileVersion(file.r2_key) && response.ok) {
    const sharing = c.env.EVERYTHING_PUBLIC === "yes" || isAlwaysPublicKind(file.kind) ? "public" : "private";
    response.headers.set("Cache-Control", sharing + ", max-age=31536000, immutable");
  }
  return response;
});

export default routes;
