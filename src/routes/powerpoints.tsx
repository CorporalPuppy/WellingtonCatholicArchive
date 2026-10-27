// ===========================================================================
// The PowerPoint archive: the slides for each Sunday and service, for
// anyone to find again. (Members only if EVERYTHING_PUBLIC is "no".)
// Slides tied to an event also show on that event's page.
//
//   GET /powerpoints              grouped into Year A, B and C (the Sunday
//                                 cycle), then by year, newest first, with
//                                 a search box
//   GET /powerpoints/:id/file     open or download one file
// ===========================================================================

import { Hono } from "hono";
import { getPowerpoint, getPowerpoints } from "../database";
import { sendFileFromStorage } from "../files";
import { formatDate, formatFileSize, getTodaysDate, liturgicalYear } from "../helpers";
import { requireMemberAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv, PowerpointRow } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/powerpoints", requireMemberAccess);
routes.use("/powerpoints/*", requireMemberAccess);

routes.get("/powerpoints", async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const powerpoints = await getPowerpoints(c.env.DB, search);
  const currentCycle = liturgicalYear(getTodaysDate(c.env.TIMEZONE)).cycle;

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
      {/* One dropdown each for Year A, B and C. Inside, a heading per
          Church year (e.g. "2025 - 2026") and its PowerPoints by date.
          The current year's dropdown starts open (all of them when searching). */}
      {groupByCycle(powerpoints).map((cycle) => (
        <details class="file-section" open={search !== "" || cycle.cycle === currentCycle}>
          <summary>
            <span class="file-section-heading">Year {cycle.cycle}</span>
            <span class="count-pill">{cycle.count}</span>
          </summary>
          {cycle.years.map((year) => (
            <section>
              <h2 class="month-heading">
                {year.endYear - 1} - {year.endYear}
              </h2>
              <ul class="file-list">
                {year.powerpoints.map((powerpoint) => (
                  <li>
                    <div class="file-row">
                      <div>
                        <strong>{powerpoint.title}</strong>
                        <br />
                        <span class="muted">
                          {formatDate(powerpoint.service_date)} -{" "}
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
        </details>
      ))}
    </>,
  );
});

type YearGroup = { endYear: number; powerpoints: PowerpointRow[] };
type CycleGroup = { cycle: "A" | "B" | "C"; count: number; years: YearGroup[] };

/**
 * Splits PowerPoints (already newest first) into Year A, B and C, and
 * within each into Church years, newest first. Cycles with nothing in
 * them are left out.
 */
function groupByCycle(powerpoints: PowerpointRow[]): CycleGroup[] {
  const cycles: CycleGroup[] = [
    { cycle: "A", count: 0, years: [] },
    { cycle: "B", count: 0, years: [] },
    { cycle: "C", count: 0, years: [] },
  ];
  for (const powerpoint of powerpoints) {
    const { cycle, endYear } = liturgicalYear(powerpoint.service_date);
    const group = cycles.find((each) => each.cycle === cycle)!;
    group.count += 1;
    const lastYear = group.years[group.years.length - 1];
    if (lastYear !== undefined && lastYear.endYear === endYear) {
      lastYear.powerpoints.push(powerpoint);
    } else {
      group.years.push({ endYear: endYear, powerpoints: [powerpoint] });
    }
  }
  return cycles.filter((each) => each.count > 0);
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
