// ===========================================================================
// Pages anyone can see: the home page and each event's page.
// (The calendar is in calendar.tsx.)
//
// Each event's set list ("what we'll sing") is always public, with links to
// the sheet music and YouTube recordings, so anyone can see what the choir
// is singing. Rosters and members-only events are shown to members (or to
// everyone, while EVERYTHING_PUBLIC is "yes"), and so are the event's
// slides, like the rest of the PowerPoint archive.
// ===========================================================================

import { Hono } from "hono";
import { getEvent, getPowerpointsForEvent, getRoster, getSetlist, getSheetFilesForEvent, getUpcomingEvents } from "../database";
import { canSeeMemberPages, FILE_KIND_LABELS, formatEventTime, formatFileSize, getTodaysDate, isAlwaysPublicKind, songPageLink } from "../helpers";
import { renderPage } from "../pages/render";
import { EventList } from "../pages/event-list";
import type { AppEnv, EventRow, PowerpointRow, SetlistRow, SongFileRow } from "../types";

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
        {/* TODO: change this small label and the welcome text to the choir's own words. */}
        <p class="eyebrow">Catholic choir</p>
        <h1>{c.env.CHOIR_NAME}</h1>
        <p class="hero-text">
          A short welcome goes here: who the choir is, which parishes we sing
          at, and how to join.
        </p>
        <p class="hero-buttons">
          <a class="button" href="/events">See where we're singing</a>
          <a class="button button-secondary" href="/readings">Today's readings</a>
        </p>
      </section>

      <section>
        <div class="section-heading">
          <h2>Where we're singing next</h2>
          <a href="/events">Full calendar &rarr;</a>
        </div>
        <EventList events={nextFewEvents} />
      </section>

      <section>
        <h2>For singers</h2>
        {/* One card per part of the site. Music and PowerPoints only show for members. */}
        <div class="feature-grid">
          <FeatureCard link="/events" title="Calendar" text="Every Mass and rehearsal, as a list or a month view." />
          <FeatureCard link="/readings" title="Daily readings" text="The readings for today, or any day you pick." />
          {canSeeMemberPages(c) && (
            <FeatureCard link="/music" title="Music library" text="Sheet music, chord charts, MuseScore files and recordings." />
          )}
          {canSeeMemberPages(c) && (
            <FeatureCard link="/prayers" title="Prayers and services" text="The Creeds, the Prayer of St Francis, rosaries and special services." />
          )}
          {canSeeMemberPages(c) && (
            <FeatureCard link="/powerpoints" title="PowerPoints" text="The slides for each Sunday, ready to project at Mass." />
          )}
        </div>
      </section>
    </>,
  );
});

/** A card on the home page that links to one part of the site. */
function FeatureCard(props: { link: string; title: string; text: string }) {
  return (
    <a class="feature-card" href={props.link}>
      <strong>{props.title}</strong>
      <span class="muted">{props.text}</span>
      <span class="feature-arrow">&rarr;</span>
    </a>
  );
}

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
  const linkToMusicLibrary = canSeeMemberPages(c);
  // Lyrics slides aren't public (see isAlwaysPublicKind), so only members get links to them.
  const sheetFiles = (await getSheetFilesForEvent(c.env.DB, eventId)).filter(
    (file) => linkToMusicLibrary || isAlwaysPublicKind(file.kind),
  );

  // Rosters contain people's names, and slides follow the PowerPoint
  // archive, so normally only members see them.
  let roster = null;
  let slides: PowerpointRow[] | null = null;
  if (canSeeMemberPages(c)) {
    roster = await getRoster(c.env.DB, eventId);
    slides = await getPowerpointsForEvent(c.env.DB, eventId, event.starts_at.slice(0, 10));
  }

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

      {slides !== null && (
        <section>
          <h2>Slides</h2>
          {slides.length === 0 && <p>The slides for this one haven't been uploaded yet.</p>}
          <ul class="file-list">
            {slides.map((powerpoint) => (
              <li>
                <div class="file-row">
                  <div>
                    <strong>{powerpoint.title}</strong>{" "}
                    <span class="muted">({powerpoint.filename}, {formatFileSize(powerpoint.size)})</span>
                    {powerpoint.notes !== "" && <div class="muted">{powerpoint.notes}</div>}
                  </div>
                  <div class="file-actions">
                    <a href={"/powerpoints/" + powerpoint.id + "/file?download=1"} class="button button-small">
                      Download
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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
      {props.linkToMusicLibrary ? <a href={songPageLink({ id: item.song_id, section: item.section })}><strong>{item.title}</strong></a> : <strong>{item.title}</strong>}
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
