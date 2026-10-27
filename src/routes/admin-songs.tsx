// ===========================================================================
// Admin pages for songs and their files.
//
//   GET  /admin/songs                       list of songs
//   GET  /admin/songs/new                   form for a new song
//   POST /admin/songs/new                   save the new song
//   GET  /admin/songs/:id                   edit a song and upload files
//   POST /admin/songs/:id                   save changes to the song
//   POST /admin/songs/:id/delete            delete the song and its files
//   POST /admin/songs/:id/files             upload a file
//   POST /admin/songs/:id/files/:fileId/delete
//
// Uploaded files go into R2. We also save a row in the song_files table
// so we know the file's name, type and size without asking R2.
// ===========================================================================

import { Hono } from "hono";
import {
  addSongFile,
  createSong,
  deleteSong,
  deleteSongFileRecord,
  getSong,
  getSongFile,
  getSongFiles,
  getSongs,
  updateSong,
  type SongDetails,
} from "../database";
import { makeStorageKey } from "../files";
import {
  cleanWebLink,
  describeFileLabels,
  FILE_KIND_LABELS,
  formatFileSize,
  getFormText,
  guessFileKind,
  workOutContentType,
} from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv, SongRow } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/songs", requireAdmin);
routes.use("/admin/songs/*", requireAdmin);

function readSongForm(form: Record<string, unknown>): SongDetails {
  return {
    title: getFormText(form, "title"),
    author: getFormText(form, "author"),
    songKey: getFormText(form, "songKey"),
    ccliNumber: getFormText(form, "ccliNumber"),
    notes: getFormText(form, "notes"),
    youtubeUrl: cleanWebLink(getFormText(form, "youtubeUrl")),
    sheetMusicUrl: cleanWebLink(getFormText(form, "sheetMusicUrl")),
  };
}

function SongForm(props: { action: string; song?: SongRow; buttonText: string }) {
  const song = props.song;
  return (
    <form method="post" action={props.action}>
      <label>
        Title
        <input type="text" name="title" required value={song?.title ?? ""} />
      </label>
      <label>
        Author / composer
        <input type="text" name="author" value={song?.author ?? ""} />
      </label>
      <label>
        Key
        <input type="text" name="songKey" value={song?.song_key ?? ""} placeholder="e.g. G" />
      </label>
      <label>
        CCLI or licence number (optional)
        <input type="text" name="ccliNumber" value={song?.ccli_number ?? ""} />
      </label>
      <label>
        YouTube link (a recording to learn from)
        <input type="url" name="youtubeUrl" value={song?.youtube_url ?? ""} placeholder="https://www.youtube.com/watch?v=..." />
      </label>
      <label>
        Sheet music link (optional, if the sheet music is on another website)
        <input type="url" name="sheetMusicUrl" value={song?.sheet_music_url ?? ""} placeholder="https://..." />
      </label>
      <label>
        Notes
        <textarea name="notes" rows={3}>{song?.notes ?? ""}</textarea>
      </label>
      <button type="submit">{props.buttonText}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// List of songs
// ---------------------------------------------------------------------------
routes.get("/admin/songs", async (c) => {
  const songs = await getSongs(c.env.DB, "");
  return renderPage(
    c,
    "Songs",
    <>
      <p><a href="/admin">Back to admin</a></p>
      <h1>Songs</h1>
      <p><a class="button" href="/admin/songs/new">Add a song</a></p>
      {songs.length === 0 && <p>No songs yet.</p>}
      <ul class="song-list">
        {songs.map((song) => (
          <li>
            <a href={"/admin/songs/" + song.id}>{song.title}</a>
            {song.author !== "" && <span class="muted"> - {song.author}</span>}
          </li>
        ))}
      </ul>
    </>,
  );
});

// ---------------------------------------------------------------------------
// New song
// ---------------------------------------------------------------------------
routes.get("/admin/songs/new", (c) => {
  return renderPage(
    c,
    "New song",
    <section class="narrow">
      <p><a href="/admin/songs">Back to songs</a></p>
      <h1>New song</h1>
      <SongForm action="/admin/songs/new" buttonText="Create song" />
    </section>,
  );
});

routes.post("/admin/songs/new", async (c) => {
  const form = await c.req.parseBody();
  const newId = await createSong(c.env.DB, readSongForm(form));
  // Go to the edit page so the admin can upload files straight away.
  return c.redirect("/admin/songs/" + newId + "?saved=1");
});

// ---------------------------------------------------------------------------
// Edit a song and its files
// ---------------------------------------------------------------------------
routes.get("/admin/songs/:id", async (c) => {
  const songId = Number(c.req.param("id"));
  const song = await getSong(c.env.DB, songId);
  if (song === null) {
    return renderPage(c, "Not found", <p>That song doesn't exist.</p>, 404);
  }
  const files = await getSongFiles(c.env.DB, songId);
  const justSaved = c.req.query("saved") === "1";
  const base = "/admin/songs/" + songId;

  return renderPage(
    c,
    "Edit " + song.title,
    <>
      <p><a href="/admin/songs">Back to songs</a> | <a href={"/music/" + songId}>View in library</a></p>
      <h1>{song.title}</h1>
      {justSaved && <Notice kind="success" message="Saved." />}

      <section class="narrow">
        <h2>Details</h2>
        <SongForm action={base} song={song} buttonText="Save changes" />
      </section>

      <section>
        <h2>Files</h2>
        {files.length === 0 && <p>No files yet.</p>}
        <ul class="file-list">
          {files.map((file) => (
            <li>
              <strong>{FILE_KIND_LABELS[file.kind]}</strong>: <a href={"/files/" + file.id}>{file.filename}</a>{" "}
              {describeFileLabels(file.music_key, file.version) !== "" && (
                <span class="file-labels">{describeFileLabels(file.music_key, file.version)}</span>
              )}{" "}
              <span class="muted">({formatFileSize(file.size)})</span>{" "}
              <form method="post" action={base + "/files/" + file.id + "/delete"} class="inline">
                <button type="submit" class="link-button">Delete</button>
              </form>
            </li>
          ))}
        </ul>

        <h3>Upload files</h3>
        <p class="muted">
          You can pick several files at once. With "Work it out from the file name", PDFs go under sheet
          music, PowerPoints under lyrics slides, Word files with "lyric" in the name under lyrics, other Word
          or text files (or any file with "chord" in its name) under chord charts, .mscz files under
          MuseScore, and MP3s under recordings. The key and version apply to every file in this upload, and
          can be left blank.
        </p>
        <p class="muted">
          Sheet music, chord charts and MuseScore files are linked from public set lists, so anyone can
          download them. Only upload music your copyright licence lets you share.
        </p>
        {/* enctype="multipart/form-data" is needed for forms that send files. */}
        <form method="post" action={base + "/files"} enctype="multipart/form-data" class="row">
          <select name="kind">
            <option value="auto">Work it out from the file name</option>
            <option value="sheet">Sheet music (PDF)</option>
            <option value="chords">Chord chart</option>
            <option value="musescore">MuseScore file</option>
            <option value="lyrics">Lyrics</option>
            <option value="slides">Lyrics slides (PowerPoint)</option>
            <option value="recording">Recording</option>
            <option value="other">Other</option>
          </select>
          {/* "multiple" lets you choose more than one file. */}
          <input type="text" name="musicKey" placeholder="Key, e.g. D" size={8} />
          <input type="text" name="version" placeholder="Version, e.g. with intro" />
          <input type="file" name="file" required multiple />
          <button type="submit">Upload</button>
        </form>
      </section>

      <section>
        <h2>Delete this song</h2>
        <form method="post" action={base + "/delete"} onsubmit="return confirm('Delete this song and all its files?')">
          <button type="submit" class="danger">Delete song</button>
        </form>
      </section>
    </>,
  );
});

routes.post("/admin/songs/:id", async (c) => {
  const songId = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  await updateSong(c.env.DB, songId, readSongForm(form));
  return c.redirect("/admin/songs/" + songId + "?saved=1");
});

routes.post("/admin/songs/:id/delete", async (c) => {
  const songId = Number(c.req.param("id"));

  // Delete the files from R2 first, then the song (which removes the
  // song_files rows too).
  const files = await getSongFiles(c.env.DB, songId);
  for (const file of files) {
    await c.env.MUSIC.delete(file.r2_key);
  }
  await deleteSong(c.env.DB, songId);
  return c.redirect("/admin/songs");
});

// ---------------------------------------------------------------------------
// Uploading a file
// ---------------------------------------------------------------------------
routes.post("/admin/songs/:id/files", async (c) => {
  const songId = Number(c.req.param("id"));

  // { all: true } gives us a list when several files were picked.
  const form = await c.req.parseBody({ all: true });
  const chosenKind = getFormText(form, "kind");
  const musicKey = getFormText(form, "musicKey");
  const version = getFormText(form, "version");

  // Make a plain list of the uploaded files (it may be one file or many).
  const picked = form["file"];
  const pickedList = Array.isArray(picked) ? picked : [picked];
  const files: File[] = [];
  for (const item of pickedList) {
    // An empty file box sends a string instead of a File.
    if (item instanceof File && item.size > 0) {
      files.push(item);
    }
  }

  for (const uploaded of files) {
    const contentType = workOutContentType(uploaded.name, uploaded.type);

    // Either the kind the admin picked, or our best guess from the name.
    let kind = chosenKind;
    if (kind === "auto" || !(kind in FILE_KIND_LABELS)) {
      kind = guessFileKind(uploaded.name, contentType);
    }

    // Where the file lives in R2, e.g. "songs/12/3f2a...-amazing-grace.pdf".
    const r2Key = makeStorageKey("songs/" + songId, uploaded.name);

    await c.env.MUSIC.put(r2Key, uploaded.stream(), {
      httpMetadata: { contentType: contentType },
    });
    await addSongFile(c.env.DB, {
      songId: songId,
      kind: kind,
      musicKey: musicKey,
      version: version,
      r2Key: r2Key,
      filename: uploaded.name,
      contentType: contentType,
      size: uploaded.size,
      sourcePath: "",
    });
  }

  return c.redirect("/admin/songs/" + songId + "?saved=1");
});

routes.post("/admin/songs/:id/files/:fileId/delete", async (c) => {
  const songId = Number(c.req.param("id"));
  const fileId = Number(c.req.param("fileId"));
  const file = await getSongFile(c.env.DB, fileId);
  if (file !== null) {
    await c.env.MUSIC.delete(file.r2_key);
    await deleteSongFileRecord(c.env.DB, fileId);
  }
  return c.redirect("/admin/songs/" + songId);
});

export default routes;
