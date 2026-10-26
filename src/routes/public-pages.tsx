// ===========================================================================
// Pages anyone can see: the home page, the calendar, and each event.
//
// Each event's set list ("what we'll sing") is always public, with links to
// the sheet music and YouTube recordings, so anyone can see what the choir
// is singing. Rosters and members-only events are shown to members (or to
// everyone, while EVERYTHING_PUBLIC is "yes").
// ===========================================================================

import { Hono } from "hono";
import { getEvent, getParishes, getRoster, getSetlist, getSheetFilesForEvent, getUpcomingEvents } from "../database";
import { canSeeMemberPages, FILE_KIND_LABELS, formatEventTime, getTodaysDate } from "../helpers";
import { renderPage } from "../pages/render";
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
// The calendar: GET /events  or  /events?parish=3
// Upcoming events grouped by month, with a menu to show one parish only.
// ---------------------------------------------------------------------------
routes.get("/events", async (c) => {
  const today = getTodaysDate(c.env.TIMEZONE);
  const parishes = await getParishes(c.env.DB);

  // Which parish was picked in the menu ("" means every parish).
  const parishChoice = c.req.query("parish") ?? "";
  const parishId = parishChoice === "" ? null : Number(parishChoice);

  const events = await getUpcomingEvents(c.env.DB, today, canSeeMemberPages(c), parishId);

  return renderPage(
    c,
    "Calendar",
    <>
      <h1>Calendar</h1>

      {parishes.length > 0 && (
        <form method="get" action="/events" class="search">
          <select name="parish" aria-label="Parish">
            <option value="">All parishes</option>
            {parishes.map((parish) => (
              <option value={String(parish.id)} selected={parish.id === parishId}>
                {parish.name}
              </option>
            ))}
          </select>
          <button type="submit">Show</button>
        </form>
      )}

      {events.length === 0 && <p>No upcoming events.</p>}

      {groupByMonth(events).map((month) => (
        <section>
          <h2 class="month-heading">{month.name}</h2>
          <EventList events={month.events} />
        </section>
      ))}
    </>,
  );
});

/**
 * Splits a list of events (already in date order) into months:
 * [{ name: "November 2026", events: [...] }, ...]
 */
function groupByMonth(events: EventRow[]): { name: string; events: EventRow[] }[] {
  const months: { name: string; events: EventRow[] }[] = [];
  for (const event of events) {
    const name = monthName(event.starts_at);
    const lastMonth = months[months.length - 1];
    if (lastMonth !== undefined && lastMonth.name === name) {
      lastMonth.events.push(event);
    } else {
      months.push({ name: name, events: [event] });
    }
  }
  return months;
}

/** "2026-11-01T10:00" -> "November 2026" */
function monthName(localTime: string): string {
  const year = Number(localTime.slice(0, 4));
  const month = Number(localTime.slice(5, 7));
  const formatter = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", month: "long", year: "numeric" });
  return formatter.format(new Date(Date.UTC(year, month - 1, 1)));
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
          <a href={"/files/" + file.id} target="_blank">
            {FILE_KIND_LABELS[file.kind]}
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

// ---------------------------------------------------------------------------
// A list of events, used on the home page and the calendar.
// ---------------------------------------------------------------------------
function EventList(props: { events: EventRow[] }) {
  if (props.events.length === 0) {
    return <p>No upcoming events right now.</p>;
  }
  return (
    <ul class="event-list">
      {props.events.map((event) => (
        <li>
          <a href={"/events/" + event.id}>
            <strong>{event.title}</strong>
          </a>
          <br />
          <span class="muted">
            {formatEventTime(event.starts_at)}
            {event.parish_name !== null && " - " + event.parish_name}
            {event.parish_name === null && event.location !== "" && " - " + event.location}
            {event.is_public === 0 && " - members only"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default routes;
