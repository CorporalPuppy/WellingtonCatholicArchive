// A list of events as cards, used on the home page and the calendar.

import { formatEventTime } from "../helpers";
import type { EventRow } from "../types";

export function EventList(props: { events: EventRow[] }) {
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
