// ===========================================================================
// The PowerPoint archive: slides from past services, for anyone to find
// again. (Members only if EVERYTHING_PUBLIC is "no".)
//
//   GET /powerpoints              list, newest first, with a search box
//   GET /powerpoints/:id/file     open or download one file
// ===========================================================================

import { Hono } from "hono";
import { getPowerpoint, getPowerpoints } from "../database";
import { sendFileFromStorage } from "../files";
import { formatDate, formatFileSize } from "../helpers";
import { requireMemberAccess } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

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
      <h1>PowerPoint archive</h1>
      <form method="get" action="/powerpoints" class="search">
        <input type="search" name="search" value={search} placeholder="Search by title, notes or date (e.g. 2026-10)" />
        <button type="submit">Search</button>
      </form>

      {powerpoints.length === 0 && <p>No PowerPoints found.</p>}
      <ul class="file-list">
        {powerpoints.map((powerpoint) => (
          <li>
            <strong>{powerpoint.title}</strong>
            <br />
            <span class="muted">
              {formatDate(powerpoint.service_date)} - {powerpoint.filename} ({formatFileSize(powerpoint.size)})
            </span>
            {powerpoint.notes !== "" && <p>{powerpoint.notes}</p>}
            <br />
            <a href={"/powerpoints/" + powerpoint.id + "/file?download=1"}>Download</a>
          </li>
        ))}
      </ul>
    </>,
  );
});

routes.get("/powerpoints/:id/file", async (c) => {
  const powerpointId = Number(c.req.param("id"));
  const powerpoint = await getPowerpoint(c.env.DB, powerpointId);
  if (powerpoint === null) {
    return c.text("File not found", 404);
  }
  return await sendFileFromStorage(c, powerpoint.r2_key, powerpoint.filename, powerpoint.content_type);
});

export default routes;
