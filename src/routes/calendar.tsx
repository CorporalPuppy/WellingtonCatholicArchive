// ===========================================================================
// The calendar, made to look and work like Google Calendar.
//
//   GET /events                          the calendar page
//   GET /events?view=week&date=2026-11-03   open on a view and a day
//                                        (view = day, week, month or schedule)
//   GET /events?parish=3                 show one parish only
//
// The page itself is a frame; public/calendar.js draws the views in the
// browser and fetches the events it needs from this small "API":
//
//   GET    /api/calendar/events?from=2026-11-01&to=2026-12-01   events (JSON)
//   POST   /api/calendar/events          admins: add an event
//   PATCH  /api/calendar/events/:id      admins: move it, or change how long it is
//   DELETE /api/calendar/events/:id      admins: delete it
//
// Old addresses (?view=list and ?view=month&month=2026-12) still work.
// ===========================================================================

import { Hono } from "hono";
import type { Context } from "hono";
import {
  createEvent,
  deleteEvent,
  getCalendarEvent,
  getEventsForCalendar,
  getParishes,
  getUpcomingEvents,
  updateEventTimes,
} from "../database";
import { canSeeMemberPages, getTodaysDate, isAdmin, isValidDate } from "../helpers";
import { requireAdmin } from "../middleware";
import { EventList } from "../pages/event-list";
import { renderPage } from "../pages/render";
import type { AppEnv, EventRow } from "../types";

const routes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
routes.get("/events", async (c) => {
  const today = getTodaysDate(c.env.TIMEZONE);
  const parishes = await getParishes(c.env.DB);
  const admin = isAdmin(c);

  // Which view to open on. "" lets calendar.js choose (the last view this
  // browser used, or Month on a computer and Schedule on a phone).
  const viewChoice = c.req.query("view") ?? "";
  let view = "";
  if (viewChoice === "day" || viewChoice === "week" || viewChoice === "month" || viewChoice === "schedule") {
    view = viewChoice;
  } else if (viewChoice === "list") {
    view = "schedule"; // the old "Upcoming" list
  }

  // Which day to open on. The old month view used ?month=2026-12.
  let date = c.req.query("date") ?? "";
  const oldMonth = c.req.query("month") ?? "";
  if (date === "" && /^\d{4}-\d{2}$/.test(oldMonth)) {
    date = oldMonth + "-01";
  }
  if (!isValidDate(date)) {
    date = today;
  }

  // The "calendars" down the side, one per parish, like Google's
  // "My calendars". Events with no parish go in "Other".
  const calendars = parishes.map((parish) => ({ key: "p" + parish.id, parishId: parish.id, name: parish.name }));
  calendars.push({ key: "other", parishId: 0, name: "Other" });

  // For visitors without JavaScript: the plain upcoming list.
  const upcoming = await getUpcomingEvents(c.env.DB, today, canSeeMemberPages(c), null);

  return renderPage(
    c,
    "Calendar",
    <>
      <link rel="stylesheet" href="/calendar.css" />
      <div
        class="gcal"
        id="gcal"
        data-today={today}
        data-timezone={c.env.TIMEZONE}
        data-admin={admin ? "yes" : "no"}
        data-view={view}
        data-date={date}
        data-parish={c.req.query("parish") ?? ""}
        data-calendars={JSON.stringify(calendars)}
      >
        <CalendarFrame admin={admin} />
      </div>
      <noscript>
        <section class="gcal-noscript">
          <h1>Calendar</h1>
          <UpcomingList events={upcoming} />
        </section>
      </noscript>
      <script src="/calendar.js" defer></script>
    </>,
  );
});

/**
 * The parts of the page that stay put: the top bar, the side panel and an
 * empty space for the view. calendar.js fills them in.
 */
function CalendarFrame(props: { admin: boolean }) {
  return (
    <>
      <header class="gcal-top">
        <button type="button" class="gcal-icon-button" id="gcal-menu" aria-label="Show or hide the side panel" title="Main menu">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
        <h1 class="gcal-title">Calendar</h1>
        <button type="button" class="gcal-today" id="gcal-today" title="Today (T)">Today</button>
        <span class="gcal-arrows">
          <button type="button" class="gcal-icon-button" id="gcal-prev" aria-label="Previous" title="Previous (K)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button type="button" class="gcal-icon-button" id="gcal-next" aria-label="Next" title="Next (J)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </span>
        <h2 class="gcal-range" id="gcal-range" aria-live="polite"></h2>
        <span class="gcal-spacer"></span>
        <div class="gcal-view-menu">
          <button type="button" class="gcal-view-button" id="gcal-view-button" aria-haspopup="menu" aria-expanded="false">
            <span id="gcal-view-name">Month</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
          </button>
          <ul class="gcal-menu" id="gcal-view-list" role="menu" hidden>
            <li><button type="button" role="menuitem" data-view="day">Day <kbd>D</kbd></button></li>
            <li><button type="button" role="menuitem" data-view="week">Week <kbd>W</kbd></button></li>
            <li><button type="button" role="menuitem" data-view="month">Month <kbd>M</kbd></button></li>
            <li><button type="button" role="menuitem" data-view="schedule">Schedule <kbd>A</kbd></button></li>
          </ul>
        </div>
      </header>

      <div class="gcal-body">
        <aside class="gcal-side" id="gcal-side">
          {props.admin && (
            <button type="button" class="gcal-create" id="gcal-create" title="Create (C)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Create
            </button>
          )}
          <div class="gcal-mini" id="gcal-mini"></div>
          <section class="gcal-calendars">
            <h3>Calendars</h3>
            <ul id="gcal-calendar-list"></ul>
          </section>
        </aside>
        <div class="gcal-scrim" id="gcal-scrim" hidden></div>
        <div class="gcal-main" id="gcal-main"></div>
      </div>

      {/* On phones: the round "+" button in the corner, like the Google Calendar app. */}
      {props.admin && (
        <button type="button" class="gcal-fab" id="gcal-fab" aria-label="Create an event">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}
      <div class="gcal-popover" id="gcal-popover" role="dialog" hidden></div>
      <div class="gcal-toast" id="gcal-toast" role="status" hidden></div>
    </>
  );
}

// ---------------------------------------------------------------------------
// "Upcoming": the next events in order, with a heading for each month
// (only shown if JavaScript is switched off)
// ---------------------------------------------------------------------------
function UpcomingList(props: { events: EventRow[] }) {
  if (props.events.length === 0) {
    return <p>No upcoming events.</p>;
  }
  return (
    <>
      {groupByMonth(props.events).map((group) => (
        <section>
          <h2 class="month-heading">{group.name}</h2>
          <EventList events={group.events} />
        </section>
      ))}
    </>
  );
}

/**
 * Splits a list of events (already in date order) into months:
 * [{ name: "November 2026", events: [...] }, ...]
 */
function groupByMonth(events: EventRow[]): { name: string; events: EventRow[] }[] {
  const groups: { name: string; events: EventRow[] }[] = [];
  for (const event of events) {
    const name = monthName(event.starts_at.slice(0, 7));
    const lastGroup = groups[groups.length - 1];
    if (lastGroup !== undefined && lastGroup.name === name) {
      lastGroup.events.push(event);
    } else {
      groups.push({ name: name, events: [event] });
    }
  }
  return groups;
}

/** "2026-11" -> "November 2026" */
function monthName(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const formatter = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", month: "long", year: "numeric" });
  return formatter.format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

// ---------------------------------------------------------------------------
// The API that calendar.js talks to
// ---------------------------------------------------------------------------

// The longest stretch one request may ask for. The views need at most six
// weeks (Month) or a few months (Schedule); this stops anyone asking for
// years at once and using up the free database reads.
const MOST_DAYS_PER_REQUEST = 200;

routes.get("/api/calendar/events", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isValidDate(from) || !isValidDate(to) || to <= from) {
    return c.json({ error: "Please give from and to dates, like ?from=2026-11-01&to=2026-12-01" }, 400);
  }
  const days = (Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000);
  if (days > MOST_DAYS_PER_REQUEST) {
    return c.json({ error: "Please ask for " + MOST_DAYS_PER_REQUEST + " days or fewer at a time." }, 400);
  }
  const events = await getEventsForCalendar(c.env.DB, from, to, canSeeMemberPages(c));
  return c.json({ events: events });
});

routes.use("/api/calendar/events/*", requireAdmin);
routes.post("/api/calendar/events", requireAdmin);

// A time as the date-and-time picker gives it: "2026-11-01T10:00".
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Checks a change came from our own calendar page. (The usual protection
 * against other websites, "csrf" in index.tsx, only looks at forms.)
 */
function fromOurOwnSite(c: Context<AppEnv>): boolean {
  const origin = c.req.header("Origin");
  return origin === undefined || origin === new URL(c.req.url).origin;
}

/** Reads the start and end times sent by calendar.js, or null if they don't make sense. */
function readTimes(body: Record<string, unknown>): { startsAt: string; endsAt: string } | null {
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";
  if (!LOCAL_TIME.test(startsAt) || !isValidDate(startsAt.slice(0, 10))) return null;
  if (endsAt !== "" && (!LOCAL_TIME.test(endsAt) || endsAt < startsAt)) return null;
  return { startsAt: startsAt, endsAt: endsAt };
}

// Add an event (the quick "Add title" box).
routes.post("/api/calendar/events", async (c) => {
  if (!fromOurOwnSite(c)) return c.json({ error: "Not allowed." }, 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const times = readTimes(body);
  if (times === null) return c.json({ error: "Please check the start and end times." }, 400);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const parishId = typeof body.parishId === "number" && body.parishId > 0 ? body.parishId : null;
  const newId = await createEvent(c.env.DB, {
    title: title === "" ? "(No title)" : title,
    description: "",
    parishId: parishId,
    location: "",
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    isPublic: body.isPublic !== false,
  });
  return c.json({ event: await getCalendarEvent(c.env.DB, newId) });
});

// Move an event, or change how long it is (dragging it on the calendar).
routes.patch("/api/calendar/events/:id", async (c) => {
  if (!fromOurOwnSite(c)) return c.json({ error: "Not allowed." }, 403);
  const eventId = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const times = readTimes(body);
  if (times === null) return c.json({ error: "Please check the start and end times." }, 400);
  if ((await getCalendarEvent(c.env.DB, eventId)) === null) return c.json({ error: "That event doesn't exist." }, 404);

  await updateEventTimes(c.env.DB, eventId, times.startsAt, times.endsAt === "" ? null : times.endsAt);
  return c.json({ event: await getCalendarEvent(c.env.DB, eventId) });
});

// Delete an event (the bin button on its pop-up).
routes.delete("/api/calendar/events/:id", async (c) => {
  if (!fromOurOwnSite(c)) return c.json({ error: "Not allowed." }, 403);
  await deleteEvent(c.env.DB, Number(c.req.param("id")));
  return c.json({ deleted: true });
});

export default routes;
