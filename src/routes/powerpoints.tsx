// ===========================================================================
// The PowerPoint archive: the slides for each Sunday and service, for
// anyone to find again. (Members only if EVERYTHING_PUBLIC is "no".)
// Slides tied to an event also show on that event's page.
//
//   GET /powerpoints              grouped into Year A, B and C (the Sunday
//                                 cycle), then by year, newest first.
//                                 ?search= finds words in the title, church,
//                                 notes or on the slides, best match first.
//                                 ?year=A|B|C, ?church= and ?season= filter.
//   GET /powerpoints/:id/file     open or download one file
// ===========================================================================

import { Hono } from "hono";
import { getPowerpoint, getPowerpointChurches, getPowerpoints } from "../database";
import { sendFileFromStorage } from "../files";
import { SEASONS, formatDate, formatFileSize, getTodaysDate, liturgicalSeason, liturgicalYear } from "../helpers";
import { requireMemberAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv, PowerpointRow } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/powerpoints", requireMemberAccess);
routes.use("/powerpoints/*", requireMemberAccess);

routes.get("/powerpoints", async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const year = c.req.query("year") ?? "";
  const church = c.req.query("church") ?? "";
  const season = c.req.query("season") ?? "";
  const filtering = year !== "" || church !== "" || season !== "";

  const churches = await getPowerpointChurches(c.env.DB);
  const powerpoints = (await getPowerpoints(c.env.DB, search)).filter(
    (powerpoint) =>
      (year === "" || liturgicalYear(powerpoint.service_date).cycle === year) &&
      (church === "" || powerpoint.church === church) &&
      (season === "" || liturgicalSeason(powerpoint.service_date) === season),
  );
  const currentCycle = liturgicalYear(getTodaysDate(c.env.TIMEZONE)).cycle;

  return renderPage(
    c,
    "PowerPoints",
    <>
      <h1>PowerPoints</h1>
      <p class="muted">The slides for each Sunday and service. Prayers, rosaries and other slides used again and again are under <a href="/prayers">Prayers and services</a>.</p>
      <form method="get" action="/powerpoints" class="powerpoint-search">
        <div class="search">
          <input type="search" name="search" value={search} placeholder="Search titles and the words on the slides, e.g. Here I Am Lord" />
          <button type="submit">Search</button>
        </div>
        <div class="filters">
          <select name="year" aria-label="Year" onchange="this.form.submit()">
            <option value="">Any year</option>
            {(["A", "B", "C"] as const).map((cycle) => (
              <option value={cycle} selected={year === cycle}>Year {cycle}</option>
            ))}
          </select>
          <select name="season" aria-label="Season" onchange="this.form.submit()">
            <option value="">Any season</option>
            {SEASONS.map((each) => (
              <option value={each} selected={season === each}>{each}</option>
            ))}
          </select>
          {churches.length > 0 && (
            <select name="church" aria-label="Church" onchange="this.form.submit()">
              <option value="">Any church</option>
              {churches.map((each) => (
                <option value={each} selected={church === each}>{each}</option>
              ))}
            </select>
          )}
          {(search !== "" || filtering) && <a href="/powerpoints">Clear</a>}
        </div>
      </form>

      {powerpoints.length === 0 && <p>No PowerPoints found.</p>}

      {/* Searching: one list, best match first. */}
      {search !== "" && powerpoints.length > 0 && (
        <>
          <p class="muted">{powerpoints.length === 1 ? "1 PowerPoint found" : powerpoints.length + " PowerPoints found"}</p>
          <ul class="file-list">{powerpoints.map((powerpoint) => <PowerpointItem powerpoint={powerpoint} />)}</ul>
        </>
      )}

      {/* Otherwise: one dropdown each for Year A, B and C. Inside, a heading
          per Church year (e.g. "2025 - 2026") and its PowerPoints by date.
          The current year's dropdown starts open (all of them when filtering). */}
      {search === "" &&
        groupByCycle(powerpoints).map((cycle) => (
          <details class="file-section" open={filtering || cycle.cycle === currentCycle}>
            <summary>
              <span class="file-section-heading">Year {cycle.cycle}</span>
              <span class="count-pill">{cycle.count}</span>
            </summary>
            {cycle.years.map((group) => (
              <section>
                <h2 class="month-heading">
                  {group.endYear - 1} - {group.endYear}
                </h2>
                <ul class="file-list">{group.powerpoints.map((powerpoint) => <PowerpointItem powerpoint={powerpoint} />)}</ul>
              </section>
            ))}
          </details>
        ))}
    </>,
  );
});

/** One PowerPoint in a list: title, date, church, event, file and download button. */
function PowerpointItem(props: { powerpoint: PowerpointRow }) {
  const powerpoint = props.powerpoint;
  const { cycle } = liturgicalYear(powerpoint.service_date);
  return (
    <li>
      <div class="file-row">
        <div>
          <strong>{powerpoint.title}</strong>
          <br />
          <span class="muted">
            {formatDate(powerpoint.service_date)} (Year {cycle}, {liturgicalSeason(powerpoint.service_date)})
            {powerpoint.church !== "" && " - " + powerpoint.church}
            {powerpoint.event_id !== null && powerpoint.event_title !== null && (
              <>
                {" - "}
                <a href={"/events/" + powerpoint.event_id}>{powerpoint.event_title}</a>
              </>
            )}
            <br />
            {powerpoint.filename} ({formatFileSize(powerpoint.size)})
          </span>
          {powerpoint.snippet !== undefined && powerpoint.snippet.includes("\u0001") && (
            <p class="search-snippet">
              <Highlighted text={powerpoint.snippet} />
            </p>
          )}
          {powerpoint.notes !== "" && <p>{powerpoint.notes}</p>}
        </div>
        <div class="file-actions">
          <a href={"/powerpoints/" + powerpoint.id + "/file?download=1"} class="button button-small">
            Download
          </a>
        </div>
      </div>
    </li>
  );
}

/**
 * Words from the slides around a search match. The database puts the
 * matching words between \u0001 and \u0002; those are shown highlighted.
 * (The text is still escaped like any other, so it's safe to show.)
 */
function Highlighted(props: { text: string }) {
  const parts = props.text.replace(/\n/g, " / ").split(/[\u0001\u0002]/);
  // Every other part (the 2nd, 4th...) was between the markers.
  return <>{parts.map((part, index) => (index % 2 === 1 ? <mark>{part}</mark> : part))}</>;
}

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
