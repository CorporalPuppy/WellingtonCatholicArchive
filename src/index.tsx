// ===========================================================================
// The starting point of the website.
//
// Cloudflare runs this file for every request that isn't a static file
// (static files like styles.css live in the /public folder and are served
// automatically). Here we switch on a few safety checks, work out who is
// logged in, and hand the request to the right page.
// ===========================================================================

import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { loadUser } from "./middleware";
import type { AppEnv } from "./types";

import publicPages from "./routes/public-pages";
import calendarPages from "./routes/calendar";
import loginPages from "./routes/login";
import accountPages from "./routes/account";
import musicPages from "./routes/music";
import powerpointPages from "./routes/powerpoints";
import readingsPages from "./routes/readings";
import adminHome from "./routes/admin-home";
import adminEvents from "./routes/admin-events";
import adminParishes from "./routes/admin-parishes";
import adminSongs from "./routes/admin-songs";
import adminUsers from "./routes/admin-users";
import adminPowerpoints from "./routes/admin-powerpoints";
import adminReadings from "./routes/admin-readings";

const app = new Hono<AppEnv>();

// Blocks forms submitted from other websites (a common trick called CSRF).
app.use(csrf());

// Works out who is logged in, for every page.
app.use(loadUser);

// Better Auth's own endpoints (session checks, sign out, and so on).
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return c.get("auth").handler(c.req.raw);
});

// All the pages of the site, grouped by area.
app.route("/", publicPages); //   /, /events/:id
app.route("/", calendarPages); // /events (the calendar)
app.route("/", loginPages); //    /login, /logout, /setup
app.route("/", accountPages); //  /account
app.route("/", musicPages); //    /music, /music/:id, /files/:id
app.route("/", powerpointPages); // /powerpoints
app.route("/", readingsPages); // /readings
app.route("/", adminHome); //     /admin
app.route("/", adminEvents); //   /admin/events/...
app.route("/", adminParishes); // /admin/parishes/...
app.route("/", adminSongs); //    /admin/songs/...
app.route("/", adminUsers); //    /admin/users/...
app.route("/", adminPowerpoints); // /admin/powerpoints/...
app.route("/", adminReadings); // /admin/readings/...

export default app;
