// ===========================================================================
// Admin pages for events, plus each event's roster and set list.
//
//   GET  /admin/events                     goes to the calendar (/events), where
//                                          admins add, move and open events
//   GET  /admin/events?list=1              every event as a plain list
//   GET  /admin/events/new                 a new event (laid out like Google
//                                          Calendar's full event page)
//   POST /admin/events/new                 save the new event
//   GET  /admin/events/:id                 edit an event, its set list, slides and roster
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
import type { Child } from "hono/jsx";
import { raw } from "hono/html";
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
import { formatEventTime, formatFileSize, getFormText, getTodaysDate } from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv, EventRow, ParishRow } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/events", requireAdmin);
routes.use("/admin/events/*", requireAdmin);

/**
 * Reads the event form's boxes into an EventDetails object. The form has
 * a date and time box for the start and for the end, like Google Calendar;
 * they're joined back into "2026-11-01T10:00" to save.
 */
function readEventForm(form: Record<string, unknown>): EventDetails {
  const startDate = getFormText(form, "startDate");
  const startTime = getFormText(form, "startTime");
  const endDate = getFormText(form, "endDate") || startDate;
  const endTime = getFormText(form, "endTime");
  return {
    title: getFormText(form, "title") || "(No title)",
    description: getFormText(form, "description"),
    // The parish menu sends the parish's id, or "" for "No parish".
    parishId: getFormText(form, "parishId") === "" ? null : Number(getFormText(form, "parishId")),
    location: getFormText(form, "location"),
    startsAt: startDate + "T" + (startTime || "00:00"),
    // No end time = no end (the calendar shows it as an hour long).
    endsAt: endTime === "" ? "" : endDate + "T" + endTime,
    // A ticked checkbox sends "on"; an unticked one sends nothing.
    isPublic: getFormText(form, "membersOnly") !== "on",
  };
}

// The same colours the calendar gives each parish, in the same order
// (see COLOURS in public/calendar.js). "No parish" is grey.
const PARISH_COLOURS = ["#039be5", "#d50000", "#33b679", "#8e24aa", "#f4511e", "#3f51b5", "#e67c73", "#0b8043", "#7986cb", "#f6bf26"];

/** A small line icon, as used down the left of Google's event page. */
function Icon(props: { path: string }) {
  return (
    <svg class="gedit-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={props.path} />
    </svg>
  );
}
const ICONS = {
  close: "M6 6l12 12M18 6L6 18",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  place: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  calendar: "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M9 3v4M15 3v4",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  notes: "M4 6h16M4 12h16M4 18h10",
  bin: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  music: "M9 18V5l11-2v13M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0",
  slides: "M3 5h18v12H3zM8 21h8M12 17v4",
  people: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
};

/** One row of the form: an icon on the left, the boxes on the right. */
function Row(props: { icon: string; label: string; children?: Child }) {
  return (
    <div class="gedit-row">
      <span title={props.label}>
        <Icon path={props.icon} />
      </span>
      <div class="gedit-row-body">{props.children}</div>
    </div>
  );
}

/**
 * The event page, laid out like Google Calendar's: a close button, a big
 * "Add title" box and Save along the top, the date and times under it,
 * then the details. For an existing event, "side" holds the set list,
 * slides and roster, where Google puts the guest list.
 */
function EventEditor(props: {
  action: string;
  event: Partial<EventRow>;
  parishes: ParishRow[];
  isNew: boolean;
  notices?: Child;
  side?: Child;
}) {
  const event = props.event;
  const startsAt = event.starts_at ?? "";
  const endsAt = event.ends_at ?? "";
  const closeTo = startsAt === "" ? "/events" : "/events?view=week&date=" + startsAt.slice(0, 10);
  const colourOf = (parishId: number | null | undefined) => {
    const index = props.parishes.findIndex((parish) => parish.id === parishId);
    return index === -1 ? "#616161" : PARISH_COLOURS[index % PARISH_COLOURS.length];
  };

  return (
    <div class={"gedit" + (props.side ? " gedit-with-side" : "")}>
      <form method="post" action={props.action} class="gedit-form" id="event-form">
        <div class="gedit-top">
          <a class="gedit-icon-button" href={closeTo} title="Back to the calendar" aria-label="Back to the calendar">
            <Icon path={ICONS.close} />
          </a>
          <input
            type="text"
            name="title"
            class="gedit-title"
            placeholder="Add title"
            value={event.title ?? ""}
            aria-label="Title"
            autofocus={props.isNew}
            autocomplete="off"
          />
          <span class="gedit-top-buttons">
            {!props.isNew && (
              <>
                <a class="button button-small button-secondary" href={"/events/" + event.id}>View on site</a>
                <button type="submit" form="delete-form" class="gedit-icon-button" title="Delete event" aria-label="Delete event">
                  <Icon path={ICONS.bin} />
                </button>
              </>
            )}
            <button type="submit" class="button-small">Save</button>
          </span>
        </div>

        <div class="gedit-when">
          <input type="date" name="startDate" required value={startsAt.slice(0, 10)} aria-label="Start date" />
          <input type="time" name="startTime" required step={300} value={startsAt.slice(11, 16)} aria-label="Start time" />
          <span class="gedit-to">to</span>
          <input type="time" name="endTime" step={300} value={endsAt.slice(11, 16)} aria-label="End time" />
          <input type="date" name="endDate" value={endsAt.slice(0, 10) || startsAt.slice(0, 10)} aria-label="End date" />
        </div>
        {props.notices}

        <div class="gedit-details">
          <h2 class="gedit-tab">Event details</h2>
          <Row icon={ICONS.calendar} label="Parish">
            <span class="gedit-swatch" id="parish-colour" style={"background:" + colourOf(event.parish_id)}></span>
            <select name="parishId" id="parish-menu" aria-label="Parish">
              <option value="" data-colour={colourOf(null)}>No parish (somewhere else)</option>
              {props.parishes.map((parish) => (
                <option value={String(parish.id)} selected={event.parish_id === parish.id} data-colour={colourOf(parish.id)}>
                  {parish.name}
                </option>
              ))}
            </select>
            <a class="gedit-hint" href="/admin/parishes">Edit parishes</a>
          </Row>
          <Row icon={ICONS.place} label="Location">
            <input type="text" name="location" value={event.location ?? ""} placeholder="Add location details (e.g. Parish hall, or an address)" aria-label="Location" />
          </Row>
          <Row icon={ICONS.lock} label="Who can see it">
            <label class="gedit-check">
              <input type="checkbox" name="membersOnly" checked={event.is_public === 0} />
              Members only <span class="muted">(e.g. a rehearsal; untick to show it to everyone)</span>
            </label>
          </Row>
          <Row icon={ICONS.notes} label="Description">
            <textarea name="description" rows={6} placeholder="Add description" aria-label="Description">{event.description ?? ""}</textarea>
          </Row>
          {props.isNew && <p class="muted gedit-later">After you save, you can add the set list, slides and roster here.</p>}
        </div>
      </form>

      {!props.isNew && (
        <form method="post" action={props.action + "/delete"} id="delete-form" onsubmit="return confirm('Delete this event, its roster and set list?')"></form>
      )}
      {props.side && <aside class="gedit-side">{props.side}</aside>}

      {/* Keep the colour square next to the parish menu up to date. */}
      <script>{raw(`
        (function () {
          var menu = document.getElementById("parish-menu");
          var swatch = document.getElementById("parish-colour");
          var saved = {};
          try { saved = JSON.parse(localStorage.getItem("calendarColours") || "{}"); } catch (e) {}
          function show() {
            var option = menu.options[menu.selectedIndex];
            var key = menu.value === "" ? "other" : "p" + menu.value;
            swatch.style.background = saved[key] || option.dataset.colour;
          }
          menu.addEventListener("change", show);
          show();
        })();
      `)}</script>
    </div>
  );
}

/** A card in the right-hand column of the event page. */
function SideCard(props: { icon: string; title: string; children?: Child }) {
  return (
    <section class="gedit-card">
      <h2>
        <Icon path={props.icon} />
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The calendar is the list of events now; ?list=1 still shows them all as a table
// ---------------------------------------------------------------------------
routes.get("/admin/events", async (c) => {
  if (c.req.query("list") !== "1") {
    return c.redirect("/events");
  }
  const events = await getAllEvents(c.env.DB);
  return renderPage(
    c,
    "Events",
    <>
      <p><a class="back-link" href="/events">Back to the calendar</a></p>
      <h1>All events</h1>
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
  // With nothing filled in, it starts at 10 am today, for an hour.
  const parishId = Number(c.req.query("parishId") ?? "");
  const startsAt = c.req.query("startsAt") || getTodaysDate(c.env.TIMEZONE) + "T10:00";
  const startingValues: Partial<EventRow> = {
    title: c.req.query("title") ?? "",
    starts_at: startsAt,
    ends_at: c.req.query("endsAt") ?? (c.req.query("startsAt") ? "" : startsAt.slice(0, 10) + "T11:00"),
    parish_id: parishId > 0 ? parishId : null,
    is_public: c.req.query("isPublic") === "0" ? 0 : 1,
  };
  return renderPage(
    c,
    "New event",
    <EventEditor action="/admin/events/new" event={startingValues} parishes={parishes} isNew={true} />,
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
// Edit an event, with its set list, slides and roster
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

  const notices = (
    <>
      {justSaved && <Notice kind="success" message="Saved." />}
      {message === "saved" && <Notice kind="success" message="Slides uploaded." />}
      {message === "missing" && <Notice kind="error" message="Please pick a file and give it a title." />}
      {message === "storage-full" && (
        <Notice kind="error" message="Not uploaded: this would go over the 10 GB of storage Cloudflare gives for free. Delete some old files first." />
      )}
    </>
  );

  const side = (
    <>
      <SideCard icon={ICONS.music} title={"Set list" + (setlist.length > 0 ? " (" + setlist.length + ")" : "")}>
        {setlist.length === 0 && <p class="muted">No songs yet.</p>}
        <ol class="gedit-list">
          {setlist.map((item) => (
            <li>
              <span>
                {item.title}
                {item.notes !== "" && <span class="muted"> · {item.notes}</span>}
              </span>
              <form method="post" action={base + "/setlist/" + item.id + "/delete"} class="inline">
                <button type="submit" class="gedit-remove" aria-label={"Remove " + item.title} title="Remove">
                  <Icon path={ICONS.close} />
                </button>
              </form>
            </li>
          ))}
        </ol>
        {allSongs.length === 0 && <p class="muted">Add songs under <a href="/admin/songs">Songs</a> first.</p>}
        {allSongs.length > 0 && (
          <form method="post" action={base + "/setlist"} class="gedit-add">
            <select name="songId" required aria-label="Song">
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
            <input type="text" name="notes" placeholder="Part of the Mass (e.g. Entrance, Communion)" aria-label="Part of the Mass" />
            <button type="submit" class="button-small">Add song</button>
          </form>
        )}
      </SideCard>

      <SideCard icon={ICONS.slides} title="Slides">
        <p class="muted gedit-small">
          The PowerPoint for this Mass, to put on the screen. Ones in the <a href="/admin/powerpoints">archive</a> for the
          same date show here too.
        </p>
        {slides.length === 0 && <p class="muted">No slides yet.</p>}
        <ul class="gedit-list">
          {slides.map((powerpoint) => (
            <li>
              <span>
                <a href={"/powerpoints/" + powerpoint.id + "/file?download=1"}>{powerpoint.title}</a>{" "}
                <span class="muted">({formatFileSize(powerpoint.size)})</span>
              </span>
              <form
                method="post"
                action={"/admin/powerpoints/" + powerpoint.id + "/delete"}
                class="inline"
                onsubmit="return confirm('Delete these slides?')"
              >
                <input type="hidden" name="returnTo" value={base} />
                <button type="submit" class="gedit-remove" aria-label={"Delete " + powerpoint.title} title="Delete">
                  <Icon path={ICONS.bin} />
                </button>
              </form>
            </li>
          ))}
        </ul>
        {/* enctype="multipart/form-data" is needed for forms that send files. */}
        <form method="post" action="/admin/powerpoints" enctype="multipart/form-data" class="gedit-add">
          <input type="hidden" name="eventId" value={String(eventId)} />
          <input type="hidden" name="returnTo" value={base} />
          <input type="text" name="title" required value={event.title + " slides"} aria-label="Title" />
          <input type="file" name="file" required accept=".ppt,.pptx,.pdf,.key,.odp" aria-label="File" />
          <button type="submit" class="button-small">Upload slides</button>
        </form>
      </SideCard>

      <SideCard icon={ICONS.people} title={"Roster" + (roster.length > 0 ? " (" + roster.length + ")" : "")}>
        {roster.length === 0 && <p class="muted">Nobody rostered yet.</p>}
        <ul class="gedit-list">
          {roster.map((entry) => (
            <li>
              <span>
                <strong>{entry.role}</strong> {entry.person_name}
                {entry.notes !== "" && <span class="muted"> · {entry.notes}</span>}
              </span>
              <form method="post" action={base + "/roster/" + entry.id + "/delete"} class="inline">
                <button type="submit" class="gedit-remove" aria-label={"Remove " + entry.person_name} title="Remove">
                  <Icon path={ICONS.close} />
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form method="post" action={base + "/roster"} class="gedit-add">
          <input type="text" name="role" placeholder="Job (e.g. Cantor, Organist)" required aria-label="Job" />
          <input type="text" name="personName" placeholder="Person's name" required aria-label="Person's name" />
          <input type="text" name="notes" placeholder="Notes (optional)" aria-label="Notes" />
          <button type="submit" class="button-small">Add to roster</button>
        </form>
      </SideCard>
    </>
  );

  return renderPage(
    c,
    "Edit " + event.title,
    <EventEditor action={base} event={event} parishes={parishes} isNew={false} notices={notices} side={side} />,
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
  return c.redirect("/events");
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
