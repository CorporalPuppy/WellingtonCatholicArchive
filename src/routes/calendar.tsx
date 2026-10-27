// ===========================================================================
// The calendar, with two ways to look at it:
//
//   GET /events                    "Upcoming": every event from today on,
//                                  in order, however far apart they are
//   GET /events?view=month         "Month": a grid like Google Calendar
//   GET /events?view=month&month=2026-12   a particular month
//
// Both can show one parish only: add &parish=3
// ===========================================================================

import { Hono } from "hono";
import { getEventsBetween, getParishes, getUpcomingEvents } from "../database";
import { canSeeMemberPages, getTodaysDate } from "../helpers";
import { EventList } from "../pages/event-list";
import { renderPage } from "../pages/render";
import type { AppEnv, EventRow, ParishRow } from "../types";

const routes = new Hono<AppEnv>();

routes.get("/events", async (c) => {
  const today = getTodaysDate(c.env.TIMEZONE);
  const parishes = await getParishes(c.env.DB);
  const includePrivate = canSeeMemberPages(c);

  // Which parish was picked in the menu ("" means every parish).
  const parishChoice = c.req.query("parish") ?? "";
  const parishId = parishChoice === "" ? null : Number(parishChoice);

  // Which view: "list" (the default) or "month".
  const view = c.req.query("view") === "month" ? "month" : "list";

  // For the month view: which month ("2026-11"). Defaults to this month.
  let month = c.req.query("month") ?? today.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    month = today.slice(0, 7);
  }

  let content;
  if (view === "list") {
    const events = await getUpcomingEvents(c.env.DB, today, includePrivate, parishId);
    content = <UpcomingList events={events} />;
  } else {
    const firstDay = month + "-01";
    const firstDayOfNextMonth = addMonths(month, 1) + "-01";
    const events = await getEventsBetween(c.env.DB, firstDay, firstDayOfNextMonth, includePrivate, parishId);
    content = <MonthGrid month={month} today={today} events={events} parishChoice={parishChoice} />;
  }

  return renderPage(
    c,
    "Calendar",
    <>
      <h1>Calendar</h1>
      <CalendarControls view={view} month={month} parishes={parishes} parishChoice={parishChoice} />
      {content}
    </>,
  );
});

// ---------------------------------------------------------------------------
// The "Upcoming" / "Month" switch and the parish menu
// ---------------------------------------------------------------------------
function CalendarControls(props: { view: string; month: string; parishes: ParishRow[]; parishChoice: string }) {
  // Keep the chosen parish when switching views.
  const parishPart = props.parishChoice === "" ? "" : "&parish=" + props.parishChoice;

  return (
    <div class="calendar-controls">
      <nav class="view-switch" aria-label="Calendar view">
        <a href={"/events?view=list" + parishPart} class={props.view === "list" ? "active" : ""}>
          Upcoming
        </a>
        <a href={"/events?view=month&month=" + props.month + parishPart} class={props.view === "month" ? "active" : ""}>
          Month
        </a>
      </nav>

      {props.parishes.length > 0 && (
        <form method="get" action="/events" class="search">
          {/* Remember the view and month when the parish changes. */}
          <input type="hidden" name="view" value={props.view} />
          <input type="hidden" name="month" value={props.month} />
          <select name="parish" aria-label="Parish">
            <option value="">All parishes</option>
            {props.parishes.map((parish) => (
              <option value={String(parish.id)} selected={String(parish.id) === props.parishChoice}>
                {parish.name}
              </option>
            ))}
          </select>
          <button type="submit">Show</button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Upcoming": the next events in order, with a heading for each month
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

// ---------------------------------------------------------------------------
// "Month": a grid of days, Monday to Sunday, like Google Calendar
// ---------------------------------------------------------------------------
function MonthGrid(props: { month: string; today: string; events: EventRow[]; parishChoice: string }) {
  const parishPart = props.parishChoice === "" ? "" : "&parish=" + props.parishChoice;
  const days = daysToShow(props.month);

  return (
    <section class="month-view">
      <div class="month-nav">
        <a class="button button-small button-secondary" href={"/events?view=month&month=" + addMonths(props.month, -1) + parishPart}>&larr; Previous</a>
        <h2>{monthName(props.month)}</h2>
        <a class="button button-small button-secondary" href={"/events?view=month&month=" + addMonths(props.month, 1) + parishPart}>Next &rarr;</a>
      </div>
      {props.month !== props.today.slice(0, 7) && (
        <p class="month-today-link">
          <a class="button button-small button-secondary" href={"/events?view=month&month=" + props.today.slice(0, 7) + parishPart}>Back to this month</a>
        </p>
      )}

      <div class="month-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((dayName) => (
          <div class="month-weekday">{dayName}</div>
        ))}

        {days.map((day) => {
          // The events on this day.
          const eventsToday = props.events.filter((event) => event.starts_at.slice(0, 10) === day);
          // Days from the month before/after are shown faded.
          let cellClass = "month-day";
          if (day.slice(0, 7) !== props.month) cellClass += " other-month";
          if (day === props.today) cellClass += " today";

          return (
            <div class={cellClass}>
              <span class="day-number">{Number(day.slice(8, 10))}</span>
              {eventsToday.map((event) => (
                <a href={"/events/" + event.id} class="month-event" title={event.title}>
                  <span class="month-event-time">{event.starts_at.slice(11, 16)}</span> {event.title}
                </a>
              ))}
            </div>
          );
        })}
      </div>

      {/* On phones the grid is too small for titles, so list the month's events underneath. */}
      <div class="phone-only">
        <h2 class="month-heading">This month</h2>
        <EventList events={props.events} />
      </div>
    </section>
  );
}

/**
 * Every date the month grid shows, as "YYYY-MM-DD": whole weeks from the
 * Monday on or before the 1st, to the Sunday on or after the last day.
 */
function daysToShow(month: string): string[] {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7)); // 1 to 12

  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)); // day 0 of next month = last day of this one

  // getUTCDay(): Sunday = 0, Monday = 1 ... We want weeks to start on Monday.
  const daysBackToMonday = (firstDay.getUTCDay() + 6) % 7;
  const daysOnToSunday = (7 - lastDay.getUTCDay()) % 7;

  const start = new Date(Date.UTC(year, monthNumber - 1, 1 - daysBackToMonday));
  const end = new Date(Date.UTC(year, monthNumber - 1, lastDay.getUTCDate() + daysOnToSunday));

  const days: string[] = [];
  for (let day = start; day <= end; day = new Date(day.getTime() + 24 * 60 * 60 * 1000)) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

/** addMonths("2026-12", 1) gives "2027-01". */
function addMonths(month: string, howMany: number): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const moved = new Date(Date.UTC(year, monthNumber - 1 + howMany, 1));
  return moved.toISOString().slice(0, 7);
}

/** "2026-11" -> "November 2026" */
function monthName(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const formatter = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", month: "long", year: "numeric" });
  return formatter.format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export default routes;
