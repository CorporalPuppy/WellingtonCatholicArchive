// ===========================================================================
// The admin dashboard: GET /admin
// ===========================================================================

import { Hono } from "hono";
import { requireAdmin } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin", requireAdmin);

routes.get("/admin", (c) => {
  return renderPage(
    c,
    "Admin",
    <>
      <h1>Admin</h1>
      <ul class="admin-menu">
        <li>
          <a href="/admin/events">Events, set lists and rosters</a>
          <p class="muted">Add Masses and rehearsals, choose the songs, and say who is singing.</p>
        </li>
        <li>
          <a href="/admin/parishes">Parishes</a>
          <p class="muted">The parishes the choir sings at, with their addresses.</p>
        </li>
        <li>
          <a href="/admin/songs">Songs and music files</a>
          <p class="muted">Add songs, YouTube links, sheet music, chord charts and recordings.</p>
        </li>
        <li>
          <a href="/admin/powerpoints">PowerPoint archive</a>
          <p class="muted">Upload the slides from each service so people can find them later.</p>
        </li>
        <li>
          <a href="/admin/readings">Daily readings</a>
          <p class="muted">Readings fill in from Universalis by themselves. Use this only to replace a day's readings with your own.</p>
        </li>
        <li>
          <a href="/admin/users">Member accounts</a>
          <p class="muted">Create logins for choir members, reset passwords, make someone an admin.</p>
        </li>
      </ul>
    </>,
  );
});

export default routes;
