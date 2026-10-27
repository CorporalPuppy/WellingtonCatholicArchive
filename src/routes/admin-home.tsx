// ===========================================================================
// The admin dashboard: GET /admin
// ===========================================================================

import { Hono } from "hono";
import { getStorageUsed } from "../database";
import { FREE_STORAGE_BYTES } from "../helpers";
import { requireAdmin } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin", requireAdmin);

routes.get("/admin", async (c) => {
  // How much of Cloudflare's free 10 GB of file storage is used.
  const used = await getStorageUsed(c.env.DB);
  const percent = Math.min(100, Math.round((used / FREE_STORAGE_BYTES) * 100));

  return renderPage(
    c,
    "Admin",
    <>
      <h1>Admin</h1>
      <div class="storage-meter">
        <p>
          <strong>File storage:</strong> {(used / 1_000_000_000).toFixed(2)} GB of 10 GB free ({percent}%)
        </p>
        <div class="storage-bar">
          <div class="storage-bar-fill" style={"width: " + percent + "%"}></div>
        </div>
        <p class="muted">Uploads stop at 9.5 GB so the site stays on Cloudflare's free plan.</p>
      </div>
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
