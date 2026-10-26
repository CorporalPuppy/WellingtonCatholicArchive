// ===========================================================================
// Admin page for the daily readings.
//
//   GET  /admin/readings                  form (for today) + list of entries
//   GET  /admin/readings?date=2026-11-01  form filled in for that date
//   POST /admin/readings                  save the readings for a date
//   POST /admin/readings/:date/delete     delete one date's readings
// ===========================================================================

import { Hono } from "hono";
import { deleteReadings, getReadingsForDate, getReadingsFrom, saveReadings } from "../database";
import { formatDate, getFormText, getTodaysDate, isValidDate } from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/readings", requireAdmin);
routes.use("/admin/readings/*", requireAdmin);

routes.get("/admin/readings", async (c) => {
  const today = getTodaysDate(c.env.TIMEZONE);
  let date = c.req.query("date") ?? today;
  if (!isValidDate(date)) {
    date = today;
  }
  // If this date already has readings, fill them into the form.
  const existing = await getReadingsForDate(c.env.DB, date);
  const upcoming = await getReadingsFrom(c.env.DB, today);
  const justSaved = c.req.query("saved") === "1";

  return renderPage(
    c,
    "Readings",
    <>
      <p><a href="/admin">Back to admin</a></p>
      <h1>Daily readings</h1>
      {justSaved && <Notice kind="success" message="Saved." />}

      <section class="narrow">
        <h2>{existing ? "Edit" : "Add"} readings for {formatDate(date)}</h2>
        {/* Picking a different date reloads the page with that date's readings. */}
        <form method="get" action="/admin/readings" class="search">
          <input type="date" name="date" value={date} />
          <button type="submit">Choose date</button>
        </form>

        <form method="post" action="/admin/readings">
          <input type="hidden" name="date" value={date} />
          <label>
            Name of the day (optional)
            <input type="text" name="dayName" value={existing?.day_name ?? ""} placeholder="e.g. 30th Sunday in Ordinary Time" />
          </label>
          <label>
            First reading
            <input type="text" name="firstReading" value={existing?.first_reading ?? ""} placeholder="e.g. Jeremiah 31:7-9" />
          </label>
          <label>
            Psalm
            <input type="text" name="psalm" value={existing?.psalm ?? ""} placeholder="e.g. Psalm 125" />
          </label>
          <label>
            Second reading (Sundays and feasts)
            <input type="text" name="secondReading" value={existing?.second_reading ?? ""} />
          </label>
          <label>
            Gospel
            <input type="text" name="gospel" value={existing?.gospel ?? ""} placeholder="e.g. Mark 10:46-52" />
          </label>
          <label>
            Notes, a reflection, or the full text (optional)
            <textarea name="notes" rows={8}>{existing?.notes ?? ""}</textarea>
          </label>
          <button type="submit">Save readings</button>
        </form>
      </section>

      <h2>Coming up</h2>
      {upcoming.length === 0 && <p>No readings entered from today onwards.</p>}
      <table>
        <tbody>
          {upcoming.map((readings) => (
            <tr>
              <td>
                <a href={"/admin/readings?date=" + readings.reading_date}>{formatDate(readings.reading_date)}</a>
              </td>
              <td>{readings.gospel}</td>
              <td>
                <form
                  method="post"
                  action={"/admin/readings/" + readings.reading_date + "/delete"}
                  class="inline"
                  onsubmit="return confirm('Delete the readings for this day?')"
                >
                  <button type="submit" class="link-button danger-text">Delete</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>,
  );
});

routes.post("/admin/readings", async (c) => {
  const form = await c.req.parseBody();
  const date = getFormText(form, "date");
  if (!isValidDate(date)) {
    return c.redirect("/admin/readings");
  }

  await saveReadings(c.env.DB, {
    reading_date: date,
    day_name: getFormText(form, "dayName"),
    first_reading: getFormText(form, "firstReading"),
    psalm: getFormText(form, "psalm"),
    second_reading: getFormText(form, "secondReading"),
    gospel: getFormText(form, "gospel"),
    notes: getFormText(form, "notes"),
  });
  return c.redirect("/admin/readings?date=" + date + "&saved=1");
});

routes.post("/admin/readings/:date/delete", async (c) => {
  const date = c.req.param("date");
  await deleteReadings(c.env.DB, date);
  return c.redirect("/admin/readings");
});

export default routes;
