// ===========================================================================
// The PowerPoint archive: the slides for each Sunday and service, for
// anyone to find again. (Members only if EVERYTHING_PUBLIC is "no".)
// Slides tied to an event also show on that event's page.
//
//   GET /powerpoints              filed by occasion, not by date: Year A, B
//                                 and C (the Sunday cycle), then the season,
//                                 then each Sunday or feast in the Church's
//                                 order. Decks with no occasion (rosaries,
//                                 ordinations, retreats...) are under Other
//                                 services.
//                                 ?search= finds words in the title, church,
//                                 notes or on the slides, best match first.
//                                 ?year=A|B|C|current, ?church= and ?season=
//                                 filter.
//   GET /powerpoints/:id/file     open or download one file
// ===========================================================================

import { Hono } from "hono";
import { getPowerpoint, getPowerpointChurches, getPowerpoints } from "../database";
import { sendFileFromStorage } from "../files";
import { formatDate, formatFileSize, getTodaysDate, liturgicalYear } from "../helpers";
import { OCCASION_GROUPS, occasionGroup, occasionOrder, occasionsOn } from "../liturgy";
import { requireMemberAccess } from "../middleware";
import { FilterPills, FilterSelect, pageLink } from "../pages/filters";
import { renderPage } from "../pages/render";
import type { AppEnv, PowerpointRow } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/powerpoints", requireMemberAccess);
routes.use("/powerpoints/*", requireMemberAccess);

routes.get("/powerpoints", async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  // The Year we're in now (it changes at the First Sunday of Advent).
  const currentCycle = liturgicalYear(getTodaysDate(c.env.TIMEZONE)).cycle;
  // ?year=current means whichever Year that is, so a bookmark keeps up.
  const yearChoice = c.req.query("year") ?? "";
  const year = yearChoice === "current" ? currentCycle : yearChoice;
  const church = c.req.query("church") ?? "";
  const season = c.req.query("season") ?? "";
  const filtering = year !== "" || church !== "" || season !== "";

  const churches = await getPowerpointChurches(c.env.DB);
  const powerpoints = (await getPowerpoints(c.env.DB, search))
    .map((powerpoint) => ({ powerpoint: powerpoint, filed: filingOf(powerpoint) }))
    .filter(
      ({ powerpoint, filed }) =>
        (year === "" || filed.cycle === year) &&
        (church === "" || powerpoint.church === church) &&
        (season === "" || filed.group === season),
    );

  /** The address of this page with a different Year, keeping the search and other filters. */
  function yearLink(cycle: string): string {
    return pageLink("/powerpoints", { search: search, year: cycle, season: season, church: church });
  }

  return renderPage(
    c,
    "PowerPoints",
    <div class="music-page">
      <header class="music-hero">
        <p class="music-eyebrow">PowerPoint archive</p>
        <h1 class="music-title">Slides for every Sunday</h1>
        <p class="music-intro">
          The slides for each Sunday and service, filed by Year and season. Prayers, rosaries and other slides used
          again and again are under <a href="/prayers">Prayers and services</a>.
        </p>
        <form method="get" action="/powerpoints" class="search music-search music-search-wide">
          <input type="search" name="search" value={search} placeholder="Search titles and the words on the slides" />
          {yearChoice !== "" && <input type="hidden" name="year" value={yearChoice} />}
          <FilterSelect name="season" label="Season" anyLabel="Any season" options={[...OCCASION_GROUPS, OTHER]} selected={season} />
          {churches.length > 0 && (
            <FilterSelect name="church" label="Church" anyLabel="Any church" options={churches} selected={church} />
          )}
          <button type="submit">Search</button>
        </form>
      </header>

      {/* Like a shop's categories: Year A, B or C of the Sunday cycle. */}
      <FilterPills
        label="Show slides for"
        pills={[
          { label: "All", href: yearLink(""), active: year === "" },
          { label: "Current year (" + currentCycle + ")", href: yearLink("current"), active: yearChoice === "current" },
          ...(["A", "B", "C"] as const).map((cycle) => ({
            label: "Year " + cycle,
            href: yearLink(cycle),
            active: yearChoice === cycle,
          })),
        ]}
      />

      <p class="music-count muted">
        {powerpoints.length === 1 ? "1 PowerPoint" : powerpoints.length + " PowerPoints"}
        {search !== "" && <> matching "{search}"</>}
        {year !== "" && <> for Year {year}{yearChoice === "current" && " (the current year)"}</>}
        {season !== "" && <> in {season}</>}
        {church !== "" && <> at {church}</>}
        {(search !== "" || filtering) && (
          <>
            {" · "}
            <a href="/powerpoints">Clear</a>
          </>
        )}
      </p>

      {powerpoints.length === 0 && <p class="music-empty">No PowerPoints found.</p>}

      {/* Searching: one list, best match first. */}
      {search !== "" && powerpoints.length > 0 && (
        <ul class="file-list">
          {powerpoints.map(({ powerpoint, filed }) => (
            <PowerpointItem powerpoint={powerpoint} filed={filed} showOccasion={true} />
          ))}
        </ul>
      )}

      {/* Otherwise: a dropdown for each of Year A, B and C (then any year,
          then other services). Inside, a heading per season and one per
          Sunday or feast, in the Church's order. The current Year starts
          open (all of them when filtering). */}
      {search === "" &&
        groupForPage(powerpoints).map((shelf) => (
          <details class="file-section" open={filtering || shelf.cycle === currentCycle}>
            <summary>
              <span class="file-section-heading">{shelf.label}</span>
              <span class="count-pill">{shelf.count}</span>
            </summary>
            {shelf.seasons.map((seasonGroup) => (
              <section>
                {shelf.label !== OTHER && <h2 class="month-heading">{seasonGroup.season}</h2>}
                {seasonGroup.occasions.map((occasionGroup) => (
                  <div class="occasion">
                    {occasionGroup.occasion !== "" && <h3 class="occasion-heading">{occasionGroup.occasion}</h3>}
                    <ul class="file-list">
                      {occasionGroup.items.map(({ powerpoint, filed }) => (
                        <PowerpointItem powerpoint={powerpoint} filed={filed} showOccasion={false} />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </details>
        ))}
    </div>,
  );
});

const OTHER = "Other services";

type Filed = { cycle: string; occasion: string; group: string };

/**
 * Where a PowerPoint is filed. The bulk import sets its Year and occasion.
 * One with a date but no occasion (uploaded by hand, or a date was all its
 * file name had) is filed under the Sunday or feast of that date, if there
 * is one. No occasion = other services.
 */
function filingOf(powerpoint: PowerpointRow): Filed {
  let cycle = powerpoint.cycle;
  let occasion = powerpoint.occasion;
  const date = powerpoint.service_date;
  if (occasion === "" && date !== "") {
    occasion = occasionsOn(date)[0] ?? "";
  }
  if (cycle === "" && date !== "" && occasion !== "") {
    cycle = liturgicalYear(date).cycle;
  }
  return { cycle: cycle, occasion: occasion, group: occasionGroup(occasion) ?? OTHER };
}

/** One PowerPoint in a list: title, where it's filed, church, date, event, file and download button. */
function PowerpointItem(props: { powerpoint: PowerpointRow; filed: Filed; showOccasion: boolean }) {
  const { powerpoint, filed } = props;
  const details: string[] = [];
  if (props.showOccasion && filed.occasion !== "") details.push(filed.occasion);
  if (filed.cycle !== "" && (props.showOccasion || filed.group === OTHER)) details.push("Year " + filed.cycle);
  if (powerpoint.church !== "") details.push(powerpoint.church);
  if (powerpoint.service_date !== "") details.push(formatDate(powerpoint.service_date));
  return (
    <li>
      <div class="file-row">
        <div>
          <strong>{powerpoint.title}</strong>
          <br />
          <span class="muted">
            {details.join(" - ")}
            {powerpoint.event_id !== null && powerpoint.event_title !== null && (
              <>
                {details.length > 0 && " - "}
                <a href={"/events/" + powerpoint.event_id}>{powerpoint.event_title}</a>
              </>
            )}
            {(details.length > 0 || powerpoint.event_id !== null) && <br />}
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

type Item = { powerpoint: PowerpointRow; filed: Filed };
type OccasionShelf = { occasion: string; items: Item[] };
type SeasonShelf = { season: string; occasions: OccasionShelf[] };
type Shelf = { label: string; cycle: string; count: number; seasons: SeasonShelf[] };

/**
 * Puts PowerPoints on the page's shelves: Year A, B and C, then any year
 * (an occasion with no Year), then other services. Inside each Year, by
 * season, then by Sunday or feast in the Church's order, then by title.
 * Shelves with nothing on them are left out.
 */
function groupForPage(items: Item[]): Shelf[] {
  const shelves: Shelf[] = [
    ...(["A", "B", "C"] as const).map((cycle) => ({ label: "Year " + cycle, cycle: cycle as string, count: 0, seasons: [] })),
    { label: "Any year", cycle: "", count: 0, seasons: [] },
    { label: OTHER, cycle: "", count: 0, seasons: [] },
  ];
  const sorted = [...items].sort(
    (a, b) =>
      occasionOrder(a.filed.occasion) - occasionOrder(b.filed.occasion) ||
      a.powerpoint.title.localeCompare(b.powerpoint.title),
  );
  for (const item of sorted) {
    const { cycle, occasion, group } = item.filed;
    const shelf =
      group === OTHER ? shelves[4] : shelves.find((each) => each.label === "Year " + cycle) ?? shelves[3];
    shelf.count += 1;
    let seasonShelf = shelf.seasons.find((each) => each.season === group);
    if (seasonShelf === undefined) {
      seasonShelf = { season: group, occasions: [] };
      shelf.seasons.push(seasonShelf);
    }
    let occasionShelf = seasonShelf.occasions.find((each) => each.occasion === occasion);
    if (occasionShelf === undefined) {
      occasionShelf = { occasion: occasion, items: [] };
      seasonShelf.occasions.push(occasionShelf);
    }
    occasionShelf.items.push(item);
  }
  return shelves.filter((shelf) => shelf.count > 0);
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
