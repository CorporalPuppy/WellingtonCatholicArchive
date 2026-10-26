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
          <a href="/admin/events">Events, rosters and set lists</a>
          <p class="muted">Add services and events, who is on the roster, and which songs are sung.</p>
        </li>
        <li>
          <a href="/admin/songs">Songs and music files</a>
          <p class="muted">Add songs and upload recordings, sheet music and chord charts.</p>
        </li>
        <li>
          <a href="/admin/powerpoints">PowerPoint archive</a>
          <p class="muted">Upload the slides from each service so people can find them later.</p>
        </li>
        <li>
          <a href="/admin/readings">Daily readings</a>
          <p class="muted">Enter the readings for each day.</p>
        </li>
        <li>
          <a href="/admin/users">Member accounts</a>
          <p class="muted">Create logins for members, reset passwords, make someone an admin.</p>
        </li>
      </ul>
    </>,
  );
});

export default routes;
