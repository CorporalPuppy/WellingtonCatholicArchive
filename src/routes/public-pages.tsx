// ===========================================================================
// Pages anyone can see: the home page and the events calendar.
// Members (or everyone, if EVERYTHING_PUBLIC is "yes") also see
// members-only events, rosters and set lists.
// ===========================================================================

import { Hono } from "hono";
import { getEvent, getRoster, getSetlist, getUpcomingEvents } from "../database";
import { canSeeMemberPages, formatEventTime, getTodaysDate } from "../helpers";
import { renderPage } from "../pages/render";
import type { AppEnv, EventRow } from "../types";

const routes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Home page: GET /
// ---------------------------------------------------------------------------
routes.get("/", async (c) => {
  const today = getTodaysDate(c.env.TIMEZONE);
  const events = await getUpcomingEvents(c.env.DB, today, canSeeMemberPages(c));
  const nextFewEvents = events.slice(0, 3);

  return renderPage(
    c,
    "Welcome",
    <>
      <section class="hero">
        <h1>Welcome to {c.env.CHURCH_NAME}</h1>
        {/* TODO: replace this placeholder text with the church's own welcome. */}
        <p>
          A short welcome message goes here: who we are, when we meet, and how
          to find us.
        </p>
      </section>

      <section>
        <h2>Coming up</h2>
        <EventList events={nextFewEvents} />
        <p>
          <a href="/events">See all events</a>
        </p>
      </section>

      <section>
        <h2>Visit us</h2>
        {/* TODO: replace with the real address and service times. */}
        <p>Address, service times and contact details go here.</p>
      </section>
    </>,
  );
});

// ---------------------------------------------------------------------------
// Events calendar: GET /events
// ---------------------------------------------------------------------------
routes.get("/events", async (c) => {
  const today = getTodaysDate(c.env.TIMEZONE);
  const events = await getUpcomingEvents(c.env.DB, today, canSeeMemberPages(c));

  return renderPage(
    c,
    "Events",
    <>
      <h1>Upcoming events</h1>
      <EventList events={events} />
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

  // Rosters contain people's names, so normally only members see them.
  let roster = null;
  let setlist = null;
  if (canSeeMemberPages(c)) {
    roster = await getRoster(c.env.DB, eventId);
    setlist = await getSetlist(c.env.DB, eventId);
  }
  const linkSongs = canSeeMemberPages(c);

  return renderPage(
    c,
    event.title,
    <>
      <h1>{event.title}</h1>
      <p class="event-when">{formatEventTime(event.starts_at)}</p>
      {event.location !== "" && <p class="event-where">{event.location}</p>}
      {event.description !== "" && <p class="event-description">{event.description}</p>}

      {setlist !== null && (
        <section>
          <h2>Set list</h2>
          {setlist.length === 0 && <p>No songs added yet.</p>}
          <ol>
            {setlist.map((item) => (
              <li>
                {linkSongs ? <a href={"/music/" + item.song_id}>{item.title}</a> : item.title}
                {item.song_key !== "" && <span class="muted"> (key of {item.song_key})</span>}
                {item.notes !== "" && <span class="muted"> - {item.notes}</span>}
              </li>
            ))}
          </ol>
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

// ---------------------------------------------------------------------------
// A list of events, used on the home page and the events page.
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
            {event.location !== "" && " - " + event.location}
            {event.is_public === 0 && " - members only"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default routes;
