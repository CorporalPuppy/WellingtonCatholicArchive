// "Middleware" runs before a page. These ones check who the visitor is.

import { createMiddleware } from "hono/factory";
import { createAuth } from "./auth";
import { canSeeMusic, isAdmin, isLoggedIn } from "./helpers";
import type { AppEnv } from "./types";

/**
 * Runs before every page. Works out who is logged in (if anyone) and
 * saves it so pages can call c.get("user").
 */
export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env);
  c.set("auth", auth);

  // Only ask the database about a session if the browser sent a login
  // cookie. This saves a database read for every public visitor.
  const cookies = c.req.header("Cookie") ?? "";
  if (cookies.includes("session_token")) {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", session ? session.user : null);
  } else {
    c.set("user", null);
  }

  await next();
});

/** Sends visitors who aren't logged in to the login page. */
export const requireLogin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isLoggedIn(c)) {
    const backTo = encodeURIComponent(c.req.path);
    return c.redirect("/login?next=" + backTo);
  }
  await next();
});

/** Only lets admins through. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isLoggedIn(c)) {
    const backTo = encodeURIComponent(c.req.path);
    return c.redirect("/login?next=" + backTo);
  }
  if (!isAdmin(c)) {
    return c.text("Sorry, only admins can see this page.", 403);
  }
  await next();
});

/** Only lets people through who are allowed to see the music. */
export const requireMusicAccess = createMiddleware<AppEnv>(async (c, next) => {
  if (!canSeeMusic(c)) {
    const backTo = encodeURIComponent(c.req.path);
    return c.redirect("/login?next=" + backTo);
  }
  await next();
});
