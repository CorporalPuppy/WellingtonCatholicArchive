// ===========================================================================
// Admin page for the daily readings.
//
//   GET  /admin/readings                  form (for today) + list of entries
//   GET  /admin/readings?date=2026-11-01  form filled in for that date
//   POST /admin/readings                  save the readings for a date
//   POST /admin/readings/:date/delete     delete one date's readings
//
// Most days you don't need this page: the Readings page loads each day's
// readings from Universalis by itself. Typing readings in here replaces
// the Universalis ones for that day (handy for a special occasion).
//
// Note: Bible translations are copyrighted. Only paste in full texts the
// choir is allowed to publish (for example under its lectionary licence).
// ===========================================================================

import { Hono } from "hono";
import { deleteReadings, getReadingsForDate, getReadingsFrom, saveReadings } from "../database";
import { formatDate, getFormText, getTodaysDate, isValidDate } from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import { READING_PARTS } from "../reading-parts";
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
            Name of the day
            <input type="text" name="day_name" value={existing?.day_name ?? ""} placeholder="e.g. Monday of the Thirtieth Week in Ordinary Time" />
          </label>
          <label>
            Lectionary number (optional)
            <input type="text" name="lectionary_number" value={existing?.lectionary_number ?? ""} placeholder="e.g. 477" />
          </label>

          {/* One reference box and one text box for each part of the readings. */}
          {READING_PARTS.map((part) => (
            <fieldset class="reading-fields">
              <legend>{part.heading}</legend>
              <label>
                Reference
                <input
                  type="text"
                  name={part.referenceField}
                  value={existing ? existing[part.referenceField] : ""}
                  placeholder={part.hint}
                />
              </label>
              <label>
                Full text (paste it in; line breaks are kept)
                <textarea name={part.textField} rows={6}>
                  {existing ? existing[part.textField] : ""}
                </textarea>
              </label>
            </fieldset>
          ))}

          <label>
            Reflection (optional)
            <textarea name="notes" rows={4}>{existing?.notes ?? ""}</textarea>
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

  // The form's box names match the table's column names, so each one
  // can be copied straight across.
  await saveReadings(c.env.DB, {
    reading_date: date,
    day_name: getFormText(form, "day_name"),
    lectionary_number: getFormText(form, "lectionary_number"),
    first_reading: getFormText(form, "first_reading"),
    first_reading_text: getFormText(form, "first_reading_text"),
    psalm: getFormText(form, "psalm"),
    psalm_text: getFormText(form, "psalm_text"),
    second_reading: getFormText(form, "second_reading"),
    second_reading_text: getFormText(form, "second_reading_text"),
    alleluia: getFormText(form, "alleluia"),
    alleluia_text: getFormText(form, "alleluia_text"),
    gospel: getFormText(form, "gospel"),
    gospel_text: getFormText(form, "gospel_text"),
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
