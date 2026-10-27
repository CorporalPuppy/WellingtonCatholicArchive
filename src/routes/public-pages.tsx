// ===========================================================================
// Pages anyone can see: the home page and each event's page.
// (The calendar is in calendar.tsx.)
//
// Each event's set list ("what we'll sing") is always public, with links to
// the sheet music and YouTube recordings, so anyone can see what the choir
// is singing. Rosters and members-only events are shown to members (or to
// everyone, while EVERYTHING_PUBLIC is "yes").
// ===========================================================================

import { Hono } from "hono";
import { getEvent, getRoster, getSetlist, getSheetFilesForEvent, getUpcomingEvents } from "../database";
import { canSeeMemberPages, FILE_KIND_LABELS, formatEventTime, getTodaysDate } from "../helpers";
import { renderPage } from "../pages/render";
import { EventList } from "../pages/event-list";
import type { AppEnv, EventRow, SetlistRow, SongFileRow } from "../types";

const routes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Home page: GET /
// ---------------------------------------------------------------------------
routes.get("/", async (c) => {
  const today = getTodaysDate(c.env.TIMEZONE);
  const events = await getUpcomingEvents(c.env.DB, today, canSeeMemberPages(c), null);
  const nextFewEvents = events.slice(0, 3);

  return renderPage(
    c,
    "Welcome",
    <>
      <section class="hero">
        <h1>{c.env.CHOIR_NAME}</h1>
        {/* TODO: replace this placeholder text with the choir's own welcome. */}
        <p>
          A short welcome goes here: who the choir is, which parishes we sing
          at, and how to join.
        </p>
      </section>

      <section>
        <h2>Where we're singing next</h2>
        <EventList events={nextFewEvents} />
        <p>
          <a href="/events">See the full calendar</a>
        </p>
      </section>

      <section>
        <h2>For singers</h2>
        <p>
          <a href="/readings">Today's readings</a> - <a href="/music">Music library</a>
        </p>
      </section>
    </>,
  );
});

// ---------------------------------------------------------------------------
// One event: GET /events/123
// ---------------------------------------------------------------------------
routes.get("/events/:id", async (c) => {
  const eventId = Number(c.req.param("id"));
  const event = await getEvent(c.env.DB, eventId);

  // Members-only events need a login (unless EVERYTHING_PUBLIC is "yes").
  const allowed = event !== null && (event.is_public === 1 || canSeeMemberPages(c));
  if (event === null || !allowed) {
    return renderPage(c, "Not found", <p>Sorry, we couldn't find that event.</p>, 404);
  }

  const setlist = await getSetlist(c.env.DB, eventId);
  const sheetFiles = await getSheetFilesForEvent(c.env.DB, eventId);

  // Rosters contain people's names, so normally only members see them.
  let roster = null;
  if (canSeeMemberPages(c)) {
    roster = await getRoster(c.env.DB, eventId);
  }
  const linkToMusicLibrary = canSeeMemberPages(c);

  return renderPage(
    c,
    event.title,
    <>
      <h1>{event.title}</h1>
      <p class="event-when">{formatEventTime(event.starts_at)}</p>
      <EventPlace event={event} />
      {event.description !== "" && <p class="event-description">{event.description}</p>}

      <section>
        <h2>What we'll sing</h2>
        {setlist.length === 0 && <p>The songs haven't been chosen yet.</p>}
        <ol class="setlist">
          {setlist.map((item) => (
            <SetlistItem item={item} sheetFiles={sheetFiles} linkToMusicLibrary={linkToMusicLibrary} />
          ))}
        </ol>
        {/* A button that copies this page's address, to paste into a message. */}
        <button type="button" onclick="navigator.clipboard.writeText(location.href); this.textContent = 'Link copied';">
          Copy link to share
        </button>
      </section>

      {roster !== null && (
        <section>
          <h2>Roster</h2>
          {roster.length === 0 && <p>Nobody rostered yet.</p>}
          <table>
            <tbody>
              {roster.map((entry) => (
                <tr>
                  <th>{entry.role}</th>
                  <td>{entry.person_name}</td>
                  <td class="muted">{entry.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>,
  );
});

/** The parish (with a map link) and any extra location details. */
function EventPlace(props: { event: EventRow }) {
  const event = props.event;
  const mapLink =
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(event.parish_address || event.parish_name || "");
  return (
    <>
      {event.parish_name !== null && (
        <p class="event-where">
          <strong>{event.parish_name}</strong>
          {event.parish_address !== null && event.parish_address !== "" && (
            <>
              <br />
              {event.parish_address} (<a href={mapLink} target="_blank" rel="noopener">map</a>)
            </>
          )}
        </p>
      )}
      {event.location !== "" && <p class="event-where">{event.location}</p>}
    </>
  );
}

/** "Gloria.docx" -> "DOCX", so links say what sort of file they open. */
function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) {
    return "file";
  }
  return filename.slice(dot + 1).toUpperCase();
}

/** One song in the set list, with its sheet music and YouTube links. */
function SetlistItem(props: { item: SetlistRow; sheetFiles: SongFileRow[]; linkToMusicLibrary: boolean }) {
  const item = props.item;
  const filesForThisSong = props.sheetFiles.filter((file) => file.song_id === item.song_id);

  return (
    <li>
      {item.notes !== "" && <span class="setlist-part">{item.notes}</span>}
      {props.linkToMusicLibrary ? <a href={"/music/" + item.song_id}><strong>{item.title}</strong></a> : <strong>{item.title}</strong>}
      {item.author !== "" && <span class="muted"> - {item.author}</span>}
      {item.song_key !== "" && <span class="muted"> (key of {item.song_key})</span>}

      <div class="setlist-links">
        {filesForThisSong.map((file) => (
          <a href={"/files/" + file.id} target="_blank" title={file.filename}>
            {FILE_KIND_LABELS[file.kind]} ({[fileExtension(file.filename), file.music_key, file.version].filter((part) => part !== "").join(", ")})
          </a>
        ))}
        {item.sheet_music_url !== "" && (
          <a href={item.sheet_music_url} target="_blank" rel="noopener">
            Sheet music (external)
          </a>
        )}
        {item.youtube_url !== "" && (
          <a href={item.youtube_url} target="_blank" rel="noopener">
            YouTube
          </a>
        )}
      </div>
    </li>
  );
}

export default routes;
