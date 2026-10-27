// ===========================================================================
// Admin pages for the PowerPoint archive.
//
//   GET  /admin/powerpoints               list + upload form
//   POST /admin/powerpoints               upload a PowerPoint
//   POST /admin/powerpoints/:id/delete    delete one
//
// The slides section of each event's admin page uses the same two forms,
// with an eventId (the upload is tied to that event and takes its date)
// and a returnTo (the page to go back to afterwards).
//
// Files are stored in R2 (in the same bucket as the music, in a
// "powerpoints" folder). A row in the powerpoints table remembers each one.
// ===========================================================================

import { Hono } from "hono";
import { addPowerpoint, deletePowerpointRecord, getEvent, getPowerpoint, getPowerpoints, getStorageUsed } from "../database";
import { makeStorageKey } from "../files";
import {
  formatDate,
  formatFileSize,
  getFormText,
  getTodaysDate,
  isValidDate,
  safeRedirectPath,
  wouldGoOverFreeStorage,
} from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/powerpoints", requireAdmin);
routes.use("/admin/powerpoints/*", requireAdmin);

routes.get("/admin/powerpoints", async (c) => {
  const powerpoints = await getPowerpoints(c.env.DB, "");
  const today = getTodaysDate(c.env.TIMEZONE);
  const message = c.req.query("message");

  return renderPage(
    c,
    "PowerPoints",
    <>
      <p><a class="back-link" href="/admin">Back to admin</a></p>
      <h1>PowerPoint archive</h1>
      <p class="muted">
        Slides for a particular Mass or service can also be uploaded from that event's page under{" "}
        <a href="/admin/events">Events</a>. Anything uploaded here shows on every event on the same date.
      </p>
      {message === "saved" && <Notice kind="success" message="Uploaded." />}
      {message === "missing" && <Notice kind="error" message="Please pick a file and give it a title and date." />}
      {message === "storage-full" && (
        <Notice kind="error" message="Not uploaded: this would go over the 10 GB of storage Cloudflare gives for free. Delete some old files first." />
      )}

      <section class="narrow">
        <h2>Upload a PowerPoint</h2>
        {/* enctype="multipart/form-data" is needed for forms that send files. */}
        <form method="post" action="/admin/powerpoints" enctype="multipart/form-data">
          <label>
            Title
            <input type="text" name="title" required placeholder="e.g. Sunday Mass slides" />
          </label>
          <label>
            Service date
            <input type="date" name="serviceDate" required value={today} />
          </label>
          <label>
            Notes (optional)
            <textarea name="notes" rows={2}></textarea>
          </label>
          <label>
            File
            <input type="file" name="file" required accept=".ppt,.pptx,.pdf,.key,.odp" />
          </label>
          <button type="submit">Upload</button>
        </form>
      </section>

      <h2>Archive</h2>
      {powerpoints.length === 0 && <p>Nothing uploaded yet.</p>}
      <table>
        <tbody>
          {powerpoints.map((powerpoint) => (
            <tr>
              <td>{formatDate(powerpoint.service_date)}</td>
              <td>
                <a href={"/powerpoints/" + powerpoint.id + "/file?download=1"}>{powerpoint.title}</a>
                <br />
                <span class="muted">
                  {powerpoint.event_title !== null && powerpoint.event_title + " - "}
                  {powerpoint.filename} ({formatFileSize(powerpoint.size)})
                </span>
              </td>
              <td>
                <form
                  method="post"
                  action={"/admin/powerpoints/" + powerpoint.id + "/delete"}
                  class="inline"
                  onsubmit="return confirm('Delete this PowerPoint?')"
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

routes.post("/admin/powerpoints", async (c) => {
  const form = await c.req.parseBody();
  const title = getFormText(form, "title");
  let serviceDate = getFormText(form, "serviceDate");
  const notes = getFormText(form, "notes");
  const uploaded = form["file"];
  const returnTo = safeRedirectPath(getFormText(form, "returnTo") || "/admin/powerpoints");
  const goBack = (message: string) => c.redirect(returnTo + (returnTo.includes("?") ? "&" : "?") + "message=" + message);

  // Uploaded from an event's page: tie it to that event, on its date.
  let eventId: number | null = null;
  if (getFormText(form, "eventId") !== "") {
    const event = await getEvent(c.env.DB, Number(getFormText(form, "eventId")));
    if (event !== null) {
      eventId = event.id;
      serviceDate = event.starts_at.slice(0, 10);
    }
  }

  // If no file was picked, "uploaded" is a string, not a File.
  if (!(uploaded instanceof File) || uploaded.size === 0 || title === "" || !isValidDate(serviceDate)) {
    return goBack("missing");
  }

  // Stop before going over Cloudflare's free 10 GB of storage.
  if (wouldGoOverFreeStorage(await getStorageUsed(c.env.DB), uploaded.size)) {
    return goBack("storage-full");
  }

  const r2Key = makeStorageKey("powerpoints", uploaded.name);
  const contentType = uploaded.type || "application/octet-stream";

  await c.env.MUSIC.put(r2Key, uploaded.stream(), {
    httpMetadata: { contentType: contentType },
  });
  await addPowerpoint(c.env.DB, {
    title: title,
    serviceDate: serviceDate,
    notes: notes,
    eventId: eventId,
    r2Key: r2Key,
    filename: uploaded.name,
    contentType: contentType,
    size: uploaded.size,
  });

  return goBack("saved");
});

routes.post("/admin/powerpoints/:id/delete", async (c) => {
  const powerpointId = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const powerpoint = await getPowerpoint(c.env.DB, powerpointId);
  if (powerpoint !== null) {
    await c.env.MUSIC.delete(powerpoint.r2_key);
    await deletePowerpointRecord(c.env.DB, powerpointId);
  }
  return c.redirect(safeRedirectPath(getFormText(form, "returnTo") || "/admin/powerpoints"));
});

export default routes;
