// ===========================================================================
// Readings for every day: GET /readings  or  /readings?date=2026-10-26
//
// Admins type in each day's readings (see admin-readings.tsx). Every day
// also links to the full texts on Universalis, so there is always
// something to read, even on days nobody has filled in.
// Everyone can see this page.
// ===========================================================================

import { Hono } from "hono";
import { getReadingsForDate } from "../database";
import { addDays, formatDate, getTodaysDate, isValidDate } from "../helpers";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

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
    "Readings",
    <>
      <h1>Readings</h1>
      <p class="readings-nav">
        <a href={"/readings?date=" + previousDay}>Previous day</a>
        {" | "}
        <a href="/readings">Today</a>
        {" | "}
        <a href={"/readings?date=" + nextDay}>Next day</a>
      </p>
      <form method="get" action="/readings" class="search">
        <input type="date" name="date" value={date} />
        <button type="submit">Go</button>
      </form>

      <h2>{formatDate(date)}</h2>

      {readings === null && <p>The readings for this day haven't been added here yet.</p>}

      {readings !== null && (
        <>
          {readings.day_name !== "" && <p class="event-when">{readings.day_name}</p>}
          <table>
            <tbody>
              {readings.first_reading !== "" && (
                <tr>
                  <th>First reading</th>
                  <td>{readings.first_reading}</td>
                </tr>
              )}
              {readings.psalm !== "" && (
                <tr>
                  <th>Psalm</th>
                  <td>{readings.psalm}</td>
                </tr>
              )}
              {readings.second_reading !== "" && (
                <tr>
                  <th>Second reading</th>
                  <td>{readings.second_reading}</td>
                </tr>
              )}
              {readings.gospel !== "" && (
                <tr>
                  <th>Gospel</th>
                  <td>{readings.gospel}</td>
                </tr>
              )}
            </tbody>
          </table>
          {readings.notes !== "" && <div class="long-text">{readings.notes}</div>}
        </>
      )}

      <p>
        <a href={fullReadingsLink(date)} target="_blank" rel="noopener">
          Read the full texts for this day on Universalis
        </a>
      </p>
    </>,
  );
});

export default routes;
