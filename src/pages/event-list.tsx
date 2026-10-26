// A list of events as cards, used on the home page and the calendar.
// Each card has a little calendar-page badge (day and month) on the left.

import { formatEventTime } from "../helpers";
import type { EventRow } from "../types";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function EventList(props: { events: EventRow[] }) {
  if (props.events.length === 0) {
    return <p>No upcoming events right now.</p>;
  }
  return (
    <ul class="event-list">
      {props.events.map((event) => (
        <li>
          <a href={"/events/" + event.id} class="event-card">
            <DateBadge localTime={event.starts_at} />
            <span class="event-card-text">
              <strong>{event.title}</strong>
              <span class="muted">
                {formatEventTime(event.starts_at)}
                {event.parish_name !== null && " - " + event.parish_name}
                {event.parish_name === null && event.location !== "" && " - " + event.location}
              </span>
              {event.is_public === 0 && <span class="tag">Members only</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The badge, e.g. "1" over "NOV", from a time like "2026-11-01T10:00". */
function DateBadge(props: { localTime: string }) {
  const month = Number(props.localTime.slice(5, 7));
  const day = Number(props.localTime.slice(8, 10));
  return (
    <span class="date-badge">
      <span class="date-badge-month">{SHORT_MONTHS[month - 1]}</span>
      <span class="date-badge-day">{day}</span>
    </span>
  );
}
