// "Middleware" runs before a page. These ones check who the visitor is.

import { createMiddleware } from "hono/factory";
import { createAuth } from "./auth";
import { getMemberPermissions } from "./database";
import { canManage, canSeeMemberPages, canUseAdminArea, isAdmin, isLoggedIn } from "./helpers";
import type { Permission } from "./permissions";
import { getSiteSettings } from "./settings";
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

  // What a logged-in member (not an admin) has been allowed to manage.
  const user = c.get("user");
  if (user !== null && user.role !== "admin") {
    c.set("permissions", await getMemberPermissions(c.env.DB, user.id));
  } else {
    c.set("permissions", new Set());
  }

  c.set("settings", await getSiteSettings(c.env));

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

/** Only lets through admins, and members who may manage this part of the site. */
export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!isLoggedIn(c)) {
      const backTo = encodeURIComponent(c.req.path);
      return c.redirect("/login?next=" + backTo);
    }
    if (!canManage(c, permission)) {
      return c.text("Sorry, you don't have permission to change this. Please ask an admin.", 403);
    }
    await next();
  });
}

/** Only lets through admins, and members who may manage at least one part of the site. */
export const requireAdminArea = createMiddleware<AppEnv>(async (c, next) => {
  if (!isLoggedIn(c)) {
    const backTo = encodeURIComponent(c.req.path);
    return c.redirect("/login?next=" + backTo);
  }
  if (!canUseAdminArea(c)) {
    return c.text("Sorry, only admins can see this page.", 403);
  }
  await next();
});

/**
 * Only lets people through who may see the members' pages
 * (everyone, if Site settings says everything is public).
 */
export const requireMemberAccess = createMiddleware<AppEnv>(async (c, next) => {
  if (!canSeeMemberPages(c)) {
    const backTo = encodeURIComponent(c.req.path);
    return c.redirect("/login?next=" + backTo);
  }
  await next();
});
