// ===========================================================================
// The PowerPoint archive: the slides for each Sunday and service, for
// anyone to find again. (Members only if EVERYTHING_PUBLIC is "no".)
// Slides tied to an event also show on that event's page.
//
//   GET /powerpoints              list by date, newest first, with a search box
//   GET /powerpoints/:id/file     open or download one file
// ===========================================================================

import { Hono } from "hono";
import { getPowerpoint, getPowerpoints } from "../database";
import { sendFileFromStorage } from "../files";
import { formatDate, formatFileSize } from "../helpers";
import { requireMemberAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv, PowerpointRow } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/powerpoints", requireMemberAccess);
routes.use("/powerpoints/*", requireMemberAccess);

routes.get("/powerpoints", async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const powerpoints = await getPowerpoints(c.env.DB, search);

  return renderPage(
    c,
    "PowerPoints",
    <>
      <h1>PowerPoints</h1>
      <p class="muted">The slides for each Sunday and service. Prayers, rosaries and other slides used again and again are under <a href="/prayers">Prayers and services</a>.</p>
      <form method="get" action="/powerpoints" class="search">
        <input type="search" name="search" value={search} placeholder="Search by title, event, notes or date (e.g. 2026-10)" />
        <button type="submit">Search</button>
      </form>

      {powerpoints.length === 0 && <p>No PowerPoints found.</p>}
      {/* One heading per date, e.g. "Sunday, 2 November 2026". */}
      {groupByDate(powerpoints).map((group) => (
        <section>
          <h2 class="month-heading">{formatDate(group.date)}</h2>
          <ul class="file-list">
            {group.powerpoints.map((powerpoint) => (
              <li>
                <div class="file-row">
                  <div>
                    <strong>{powerpoint.title}</strong>
                    <br />
                    <span class="muted">
                      {powerpoint.event_id !== null && powerpoint.event_title !== null && (
                        <>
                          <a href={"/events/" + powerpoint.event_id}>{powerpoint.event_title}</a> -{" "}
                        </>
                      )}
                      {powerpoint.filename} ({formatFileSize(powerpoint.size)})
                    </span>
                    {powerpoint.notes !== "" && <p>{powerpoint.notes}</p>}
                  </div>
                  <div class="file-actions">
                    <a href={"/powerpoints/" + powerpoint.id + "/file?download=1"} class="button button-small">
                      Download
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>,
  );
});

/** Splits PowerPoints (already newest first) into one group per date. */
function groupByDate(powerpoints: PowerpointRow[]): { date: string; powerpoints: PowerpointRow[] }[] {
  const groups: { date: string; powerpoints: PowerpointRow[] }[] = [];
  for (const powerpoint of powerpoints) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup !== undefined && lastGroup.date === powerpoint.service_date) {
      lastGroup.powerpoints.push(powerpoint);
    } else {
      groups.push({ date: powerpoint.service_date, powerpoints: [powerpoint] });
    }
  }
  return groups;
}

routes.get("/powerpoints/:id/file", async (c) => {
  const powerpointId = Number(c.req.param("id"));
  const powerpoint = await getPowerpoint(c.env.DB, powerpointId);
  if (powerpoint === null) {
    return c.text("File not found", 404);
  }
  return await sendFileFromStorage(c, powerpoint.r2_key, powerpoint.filename, powerpoint.content_type);
});

export default routes;
