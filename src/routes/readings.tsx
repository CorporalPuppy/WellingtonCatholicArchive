// ===========================================================================
// Readings for every day: GET /readings  or  /readings?date=2026-10-26
//
// Laid out like the USCCB daily readings page: the date, the name of the
// day, then each reading with its reference and full text.
//
// Where the readings come from:
//   - If an admin has typed in readings for this day (admin-readings.tsx),
//     those are shown.
//   - Otherwise the visitor's browser loads them from Universalis
//     (see public/readings.js). Universalis officially supports today's
//     readings and next Sunday's.
//
// Every day also links to Universalis. Everyone can see this page.
// ===========================================================================

import { Hono } from "hono";
import { getReadingsForDate } from "../database";
import { addDays, formatDate, getTodaysDate, isValidDate } from "../helpers";
import { renderPage } from "../pages/render";
import { READING_PARTS } from "../reading-parts";
import type { AppEnv, ReadingsRow } from "../types";

const routes = new Hono<AppEnv>();

/** "2026-10-26" -> "20261026", the way Universalis writes dates. */
function universalisDate(date: string): string {
  return date.replaceAll("-", "");
}

/**
 * The start of every Universalis address. UNIVERSALIS_CALENDAR (in
 * wrangler.jsonc) picks the local calendar, so feast days match ours.
 */
function universalisBase(calendar: string): string {
  if (calendar === "") {
    return "https://universalis.com/";
  }
  return "https://universalis.com/" + calendar + "/";
}

/** The Universalis web page with the readings for a date. */
function fullReadingsLink(calendar: string, date: string): string {
  return universalisBase(calendar) + universalisDate(date) + "/mass.htm";
}

/** The Universalis feed our page loads the readings from. */
function readingsFeedUrl(calendar: string, date: string): string {
  return universalisBase(calendar) + universalisDate(date) + "/jsonpmass.js";
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
        <a class="button button-small button-secondary" href={"/readings?date=" + previousDay}>&larr; Previous day</a>
        <form method="get" action="/readings" class="readings-date-picker">
          <input type="date" name="date" value={date} aria-label="Choose a date" />
          <button type="submit">Go</button>
        </form>
        <a class="button button-small button-secondary" href={"/readings?date=" + nextDay}>Next day &rarr;</a>
      </nav>
      {date !== today && (
        <p class="readings-today-link">
          <a class="button button-small button-secondary" href="/readings">Back to today</a>
        </p>
      )}

      {/* Readings an admin typed in for this day */}
      {readings !== null && (
        <>
          <header class="readings-header">
            <p class="readings-date">{formatDate(date)}</p>
            <h1>{readings.day_name !== "" ? readings.day_name : "Daily Readings"}</h1>
            {readings.lectionary_number !== "" && (
              <p class="readings-lectionary">Lectionary: {readings.lectionary_number}</p>
            )}
          </header>
          <ReadingSections readings={readings} />
          {readings.notes !== "" && (
            <section class="reading">
              <h2>Reflection</h2>
              <div class="reading-text">{readings.notes}</div>
            </section>
          )}
        </>
      )}

      {/* Otherwise, readings loaded from Universalis */}
      {readings === null && (
        <UniversalisReadings feedUrl={readingsFeedUrl(c.env.UNIVERSALIS_CALENDAR, date)} date={date} />
      )}

      <p class="readings-source">
        <a href={fullReadingsLink(c.env.UNIVERSALIS_CALENDAR, date)} target="_blank" rel="noopener">
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

/**
 * Empty spaces for the Universalis readings, plus the script that fills
 * them in. Each space's id tells public/readings.js what goes in it,
 * e.g. "Universalis_Mass_G.source" is the Gospel's reference.
 * Sections start hidden and are shown once they have text.
 */
function UniversalisReadings(props: { feedUrl: string; date: string }) {
  return (
    <div id="universalis-readings" data-feed-url={props.feedUrl}>
      <header class="readings-header">
        <p class="readings-date">{formatDate(props.date)}</p>
        <h1 id="Universalis_day">Daily Readings</h1>
      </header>

      <p id="readings-loading" class="muted">Loading the readings...</p>
      <p id="readings-failed" class="muted" hidden>
        The readings for this day couldn't be loaded here. Use the Universalis link below to read them.
      </p>

      {READING_PARTS.map((part) => (
        <section class="reading" data-universalis-section hidden>
          <h2>{part.heading}</h2>
          <p class="reading-reference" id={"Universalis_" + part.universalisName + ".source"}></p>
          <div class="reading-html" id={"Universalis_" + part.universalisName + ".text"}></div>
        </section>
      ))}

      {/* Universalis asks that their copyright notice is shown with the readings. */}
      <p class="readings-copyright muted" id="Universalis_copyright.text"></p>

      <script src="/readings.js"></script>
    </div>
  );
}

export default routes;
