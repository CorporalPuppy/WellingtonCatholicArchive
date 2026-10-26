// ===========================================================================
// Readings for every day: GET /readings  or  /readings?date=2026-10-26
//
// Laid out like the USCCB daily readings page: the date, the name of the
// day, the Lectionary number, then each reading with its reference and
// full text. Admins type these in (see admin-readings.tsx).
//
// Every day also links to Universalis, so days nobody has filled in still
// have readings. Everyone can see this page.
// ===========================================================================

import { Hono } from "hono";
import { getReadingsForDate } from "../database";
import { addDays, formatDate, getTodaysDate, isValidDate } from "../helpers";
import { renderPage } from "../pages/render";
import { READING_PARTS } from "../reading-parts";
import type { AppEnv, ReadingsRow } from "../types";

const routes = new Hono<AppEnv>();

/**
 * A link to the full readings for a date on Universalis
 * (a long-running Catholic site with the Mass readings for every day).
 * Change this if you prefer another site.
 */
function fullReadingsLink(date: string): string {
  const compactDate = date.replaceAll("-", ""); // "2026-10-26" -> "20261026"
  return "https://universalis.com/" + compactDate + "/mass.htm";
}

routes.get("/readings", async (c) => {
  const today = getTodaysDate(c.env.TIMEZONE);
  let date = c.req.query("date") ?? today;
  if (!isValidDate(date)) {
    date = today;
  }

  const readings = await getReadingsForDate(c.env.DB, date);
  const previousDay = addDays(date, -1);
  const nextDay = addDays(date, 1);

  return renderPage(
    c,
    "Readings for " + formatDate(date),
    <div class="readings-page">
      {/* Previous / next day, and a date picker */}
      <nav class="readings-nav">
        <a href={"/readings?date=" + previousDay}>&larr; Previous day</a>
        <form method="get" action="/readings" class="readings-date-picker">
          <input type="date" name="date" value={date} aria-label="Choose a date" />
          <button type="submit">Go</button>
        </form>
        <a href={"/readings?date=" + nextDay}>Next day &rarr;</a>
      </nav>
      {date !== today && (
        <p class="readings-today-link">
          <a href="/readings">Back to today</a>
        </p>
      )}

      {/* The date and the name of the day */}
      <header class="readings-header">
        <p class="readings-date">{formatDate(date)}</p>
        {readings !== null && readings.day_name !== "" && <h1>{readings.day_name}</h1>}
        {(readings === null || readings.day_name === "") && <h1>Daily Readings</h1>}
        {readings !== null && readings.lectionary_number !== "" && (
          <p class="readings-lectionary">Lectionary: {readings.lectionary_number}</p>
        )}
      </header>

      {readings === null && (
        <p>The readings for this day haven't been added here yet.</p>
      )}

      {readings !== null && <ReadingSections readings={readings} />}

      {readings !== null && readings.notes !== "" && (
        <section class="reading">
          <h2>Reflection</h2>
          <div class="reading-text">{readings.notes}</div>
        </section>
      )}

      <p class="readings-source">
        <a href={fullReadingsLink(date)} target="_blank" rel="noopener">
          See this day's readings on Universalis
        </a>
      </p>
    </div>,
  );
});

/** Every part of the day's readings that has something filled in. */
function ReadingSections(props: { readings: ReadingsRow }) {
  const readings = props.readings;
  return (
    <>
      {READING_PARTS.map((part) => {
        const reference = readings[part.referenceField];
        const text = readings[part.textField];

        // Skip parts this day doesn't have (e.g. no Reading 2 on weekdays).
        if (reference === "" && text === "") {
          return null;
        }
        return (
          <section class="reading">
            <h2>{part.heading}</h2>
            {reference !== "" && <p class="reading-reference">{reference}</p>}
            {text !== "" && <div class="reading-text">{text}</div>}
          </section>
        );
      })}
    </>
  );
}

export default routes;
