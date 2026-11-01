// ===========================================================================
// The admin dashboard: GET /admin
// ===========================================================================

import { Hono } from "hono";
import { getStorageUsed } from "../database";
import { canManage, FREE_STORAGE_BYTES, isAdmin } from "../helpers";
import { requireAdminArea } from "../middleware";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin", requireAdminArea);

routes.get("/admin", async (c) => {
  // Admins see everything. Members only see the parts they may manage.
  const admin = isAdmin(c);
  const events = canManage(c, "events");
  const songs = canManage(c, "songs");
  const powerpoints = canManage(c, "powerpoints");
  const readings = canManage(c, "readings");

  // How much of Cloudflare's free 10 GB of file storage is used.
  const used = await getStorageUsed(c.env.DB);
  const percent = Math.min(100, Math.round((used / FREE_STORAGE_BYTES) * 100));

  return renderPage(
    c,
    "Admin",
    <>
      <h1>Admin</h1>
      {!admin && <p class="muted">You can manage the parts of the site below. Ask an admin if you need more.</p>}
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
        {events && (
          <li>
            <a href="/admin/events">Events, set lists and rosters</a>
            <p class="muted">Add Masses and rehearsals, choose the songs, and say who is singing.</p>
          </li>
        )}
        {events && (
          <li>
            <a href="/admin/parishes">Parishes</a>
            <p class="muted">The parishes the choir sings at, with their addresses.</p>
          </li>
        )}
        {songs && (
          <li>
            <a href="/admin/songs">Songs, prayers and services</a>
            <p class="muted">Add songs, YouTube links, sheet music, chord charts and recordings, and the slides for prayers, rosaries and special services.</p>
          </li>
        )}
        {powerpoints && (
          <li>
            <a href="/admin/powerpoints">PowerPoint archive</a>
            <p class="muted">Every PowerPoint for a Sunday or service. You can also upload slides straight from an event's page.</p>
          </li>
        )}
        {readings && (
          <li>
            <a href="/admin/readings">Daily readings</a>
            <p class="muted">Readings fill in from Universalis by themselves. Use this only to replace a day's readings with your own.</p>
          </li>
        )}
        {admin && (
          <li>
            <a href="/admin/users">Member accounts</a>
            <p class="muted">Create logins, reset passwords, choose what each member can manage, and turn accounts off.</p>
          </li>
        )}
        {admin && (
          <li>
            <a href="/admin/settings">Site settings</a>
            <p class="muted">The choir's name, the home page welcome and notice, and who can see the music and PowerPoints.</p>
          </li>
        )}
      </ul>
    </>,
  );
});

export default routes;
