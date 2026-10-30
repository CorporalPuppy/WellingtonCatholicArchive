// ===========================================================================
// Admin pages for events, plus each event's roster and set list.
//
//   GET  /admin/events                     list of all events
//   GET  /admin/events/new                 form for a new event
//   POST /admin/events/new                 save the new event
//   GET  /admin/events/:id                 edit an event, its roster and set list
//   POST /admin/events/:id                 save changes to the event
//   POST /admin/events/:id/delete          delete the event
//   POST /admin/events/:id/roster          add a roster entry
//   POST /admin/events/:id/roster/:entryId/delete
//   POST /admin/events/:id/setlist         add a song to the set list
//   POST /admin/events/:id/setlist/:itemId/delete
//
// The event page also has a Slides section: its upload and delete forms
// are handled in admin-powerpoints.tsx.
// ===========================================================================

import { Hono } from "hono";
import {
  addRosterEntry,
  addSongToSetlist,
  createEvent,
  deleteEvent,
  deleteRosterEntry,
  getAllEvents,
  getParishes,
  getEvent,
  getPowerpointsForEvent,
  getRoster,
  getSetlist,
  getSongs,
  removeSongFromSetlist,
  updateEvent,
  type EventDetails,
} from "../database";
import { formatEventTime, formatFileSize, getFormText } from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv, EventRow, ParishRow } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/events", requireAdmin);
routes.use("/admin/events/*", requireAdmin);

/** Reads the event form's boxes into an EventDetails object. */
function readEventForm(form: Record<string, unknown>): EventDetails {
  return {
    title: getFormText(form, "title"),
    description: getFormText(form, "description"),
    // The parish menu sends the parish's id, or "" for "No parish".
    parishId: getFormText(form, "parishId") === "" ? null : Number(getFormText(form, "parishId")),
    location: getFormText(form, "location"),
    startsAt: getFormText(form, "startsAt"),
    endsAt: getFormText(form, "endsAt"),
    // A ticked checkbox sends "on"; an unticked one sends nothing.
    isPublic: getFormText(form, "isPublic") === "on",
  };
}

/** The form used both for new events and for editing one. */
function EventForm(props: { action: string; event?: Partial<EventRow>; parishes: ParishRow[]; buttonText: string }) {
  const event = props.event;
  return (
    <form method="post" action={props.action}>
      <label>
        Title
        <input type="text" name="title" required value={event?.title ?? ""} />
      </label>
      <label>
        Starts
        <input type="datetime-local" name="startsAt" required value={event?.starts_at ?? ""} />
      </label>
      <label>
        Ends (optional)
        <input type="datetime-local" name="endsAt" value={event?.ends_at ?? ""} />
      </label>
      <label>
        Parish
        <select name="parishId">
          <option value="">No parish (somewhere else)</option>
          {props.parishes.map((parish) => (
            <option value={String(parish.id)} selected={event?.parish_id === parish.id}>
              {parish.name}
            </option>
          ))}
        </select>
      </label>
      <p class="muted">
        Add parishes under <a href="/admin/parishes">Parishes</a>.
      </p>
      <label>
        Extra location details (optional)
        <input type="text" name="location" value={event?.location ?? ""} placeholder="e.g. Parish hall, or an address" />
      </label>
      <label>
        Description
        <textarea name="description" rows={4}>{event?.description ?? ""}</textarea>
      </label>
      <label class="checkbox">
        <input type="checkbox" name="isPublic" checked={event ? event.is_public === 1 : true} />
        Show this event to the public (untick for members only, e.g. a rehearsal)
      </label>
      <button type="submit">{props.buttonText}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// List of all events
// ---------------------------------------------------------------------------
routes.get("/admin/events", async (c) => {
  const events = await getAllEvents(c.env.DB);
  return renderPage(
    c,
    "Events",
    <>
      <p><a class="back-link" href="/admin">Back to admin</a></p>
      <h1>Events</h1>
      <p><a class="button" href="/admin/events/new">Add an event</a></p>
      {events.length === 0 && <p>No events yet.</p>}
      <table>
        <tbody>
          {events.map((event) => (
            <tr>
              <td><a href={"/admin/events/" + event.id}>{event.title}</a></td>
              <td>{formatEventTime(event.starts_at)}</td>
              <td>{event.parish_name ?? event.location}</td>
              <td class="muted">{event.is_public === 1 ? "Public" : "Members only"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>,
  );
});

// ---------------------------------------------------------------------------
// New event
// ---------------------------------------------------------------------------
routes.get("/admin/events/new", async (c) => {
  const parishes = await getParishes(c.env.DB);
  // The calendar's "More options" button fills in what was already typed:
  // /admin/events/new?title=...&startsAt=2026-11-01T10:00&endsAt=...&parishId=2&isPublic=0
  const parishId = Number(c.req.query("parishId") ?? "");
  const startingValues: Partial<EventRow> = {
    title: c.req.query("title") ?? "",
    starts_at: c.req.query("startsAt") ?? "",
    ends_at: c.req.query("endsAt") ?? "",
    parish_id: parishId > 0 ? parishId : null,
    is_public: c.req.query("isPublic") === "0" ? 0 : 1,
  };
  return renderPage(
    c,
    "New event",
    <section class="narrow">
      <p><a class="back-link" href="/admin/events">Back to events</a></p>
      <h1>New event</h1>
      <EventForm action="/admin/events/new" event={startingValues} parishes={parishes} buttonText="Create event" />
    </section>,
  );
});

routes.post("/admin/events/new", async (c) => {
  const form = await c.req.parseBody();
  const details = readEventForm(form);
  const newId = await createEvent(c.env.DB, details);
  // Go to the edit page so the admin can add the roster and set list.
  return c.redirect("/admin/events/" + newId + "?saved=1");
});

// ---------------------------------------------------------------------------
// Edit an event, with its roster and set list
// ---------------------------------------------------------------------------
routes.get("/admin/events/:id", async (c) => {
  const eventId = Number(c.req.param("id"));
  const event = await getEvent(c.env.DB, eventId);
  if (event === null) {
    return renderPage(c, "Not found", <p>That event doesn't exist.</p>, 404);
  }
  const roster = await getRoster(c.env.DB, eventId);
  const setlist = await getSetlist(c.env.DB, eventId);
  const allSongs = await getSongs(c.env.DB, "");
  const parishes = await getParishes(c.env.DB);
  const slides = await getPowerpointsForEvent(c.env.DB, eventId, event.starts_at.slice(0, 10));
  const songs = allSongs.filter((song) => song.section === "music");
  const prayers = allSongs.filter((song) => song.section === "prayers");
  const justSaved = c.req.query("saved") === "1";
  const message = c.req.query("message");
  const base = "/admin/events/" + eventId;

  return renderPage(
    c,
    "Edit " + event.title,
    <>
      <p><a class="back-link" href="/admin/events">Back to events</a> <a class="button button-small button-secondary" href={"/events/" + eventId}>View on site</a></p>
      <h1>{event.title}</h1>
      {justSaved && <Notice kind="success" message="Saved." />}
      {message === "saved" && <Notice kind="success" message="Slides uploaded." />}
      {message === "missing" && <Notice kind="error" message="Please pick a file and give it a title." />}
      {message === "storage-full" && (
        <Notice kind="error" message="Not uploaded: this would go over the 10 GB of storage Cloudflare gives for free. Delete some old files first." />
      )}

      <section class="narrow">
        <h2>Details</h2>
        <EventForm action={base} event={event} parishes={parishes} buttonText="Save changes" />
      </section>

      <section>
        <h2>Set list</h2>
        {setlist.length === 0 && <p>No songs yet.</p>}
        <ol>
          {setlist.map((item) => (
            <li>
              {item.title}
              {item.notes !== "" && <span class="muted"> - {item.notes}</span>}{" "}
              <form method="post" action={base + "/setlist/" + item.id + "/delete"} class="inline">
                <button type="submit" class="link-button">Remove</button>
              </form>
            </li>
          ))}
        </ol>
        {allSongs.length === 0 && <p class="muted">Add songs under <a href="/admin/songs">Songs</a> first.</p>}
        {allSongs.length > 0 && (
          <form method="post" action={base + "/setlist"} class="row">
            <select name="songId" required>
              <optgroup label="Songs">
                {songs.map((song) => (
                  <option value={String(song.id)}>{song.title}</option>
                ))}
              </optgroup>
              {prayers.length > 0 && (
                <optgroup label="Prayers and services">
                  {prayers.map((song) => (
                    <option value={String(song.id)}>{song.title}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <input type="text" name="notes" placeholder="Part of the Mass (e.g. Entrance, Creed, Communion)" />
            <button type="submit">Add</button>
          </form>
        )}
      </section>

      <section>
        <h2>Slides</h2>
        <p class="muted">
          The PowerPoint for this Mass or service, to put on the screen. PowerPoints uploaded in the{" "}
          <a href="/admin/powerpoints">archive</a> for the same date show here too.
        </p>
        {slides.length === 0 && <p>No slides yet.</p>}
        <ul class="file-list">
          {slides.map((powerpoint) => (
            <li>
              <a href={"/powerpoints/" + powerpoint.id + "/file?download=1"}>{powerpoint.title}</a>{" "}
              <span class="muted">({powerpoint.filename}, {formatFileSize(powerpoint.size)})</span>{" "}
              <form
                method="post"
                action={"/admin/powerpoints/" + powerpoint.id + "/delete"}
                class="inline"
                onsubmit="return confirm('Delete these slides?')"
              >
                <input type="hidden" name="returnTo" value={base} />
                <button type="submit" class="link-button danger-text">Delete</button>
              </form>
            </li>
          ))}
        </ul>
        {/* enctype="multipart/form-data" is needed for forms that send files. */}
        <form method="post" action="/admin/powerpoints" enctype="multipart/form-data" class="row">
          <input type="hidden" name="eventId" value={String(eventId)} />
          <input type="hidden" name="returnTo" value={base} />
          <input type="text" name="title" required value={event.title + " slides"} aria-label="Title" />
          <input type="file" name="file" required accept=".ppt,.pptx,.pdf,.key,.odp" />
          <button type="submit">Upload slides</button>
        </form>
      </section>

      <section>
        <h2>Roster</h2>
        {roster.length === 0 && <p>Nobody rostered yet.</p>}
        <table>
          <tbody>
            {roster.map((entry) => (
              <tr>
                <th>{entry.role}</th>
                <td>{entry.person_name}</td>
                <td class="muted">{entry.notes}</td>
                <td>
                  <form method="post" action={base + "/roster/" + entry.id + "/delete"} class="inline">
                    <button type="submit" class="link-button">Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form method="post" action={base + "/roster"} class="row">
          <input type="text" name="role" placeholder="Job (e.g. Cantor, Organist)" required />
          <input type="text" name="personName" placeholder="Person's name" required />
          <input type="text" name="notes" placeholder="Notes (optional)" />
          <button type="submit">Add to roster</button>
        </form>
      </section>

      <section>
        <h2>Delete this event</h2>
        <form method="post" action={base + "/delete"} onsubmit="return confirm('Delete this event, its roster and set list?')">
          <button type="submit" class="danger">Delete event</button>
        </form>
      </section>
    </>,
  );
});

routes.post("/admin/events/:id", async (c) => {
  const eventId = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  await updateEvent(c.env.DB, eventId, readEventForm(form));
  return c.redirect("/admin/events/" + eventId + "?saved=1");
});

routes.post("/admin/events/:id/delete", async (c) => {
  const eventId = Number(c.req.param("id"));
  await deleteEvent(c.env.DB, eventId);
  return c.redirect("/admin/events");
});

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------
routes.post("/admin/events/:id/roster", async (c) => {
  const eventId = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const role = getFormText(form, "role");
  const personName = getFormText(form, "personName");
  const notes = getFormText(form, "notes");
  await addRosterEntry(c.env.DB, eventId, role, personName, notes);
  return c.redirect("/admin/events/" + eventId);
});

routes.post("/admin/events/:id/roster/:entryId/delete", async (c) => {
  const eventId = Number(c.req.param("id"));
  const entryId = Number(c.req.param("entryId"));
  await deleteRosterEntry(c.env.DB, entryId);
  return c.redirect("/admin/events/" + eventId);
});

// ---------------------------------------------------------------------------
// Set list
// ---------------------------------------------------------------------------
routes.post("/admin/events/:id/setlist", async (c) => {
  const eventId = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const songId = Number(getFormText(form, "songId"));
  const notes = getFormText(form, "notes");
  await addSongToSetlist(c.env.DB, eventId, songId, notes);
  return c.redirect("/admin/events/" + eventId);
});

routes.post("/admin/events/:id/setlist/:itemId/delete", async (c) => {
  const eventId = Number(c.req.param("id"));
  const itemId = Number(c.req.param("itemId"));
  await removeSongFromSetlist(c.env.DB, itemId);
  return c.redirect("/admin/events/" + eventId);
});

export default routes;
