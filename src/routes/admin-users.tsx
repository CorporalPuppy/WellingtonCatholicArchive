// ===========================================================================
// Admin pages for member accounts. There is no public sign-up: an admin
// creates each account here and tells the person their password.
//
//   GET  /admin/users                       list of accounts + "new account" form
//   POST /admin/users/new                   create an account
//   GET  /admin/users/:id                   one account, with everything you can change
//   POST /admin/users/:id/details           change their name or email
//   POST /admin/users/:id/password          set a new password for someone
//   POST /admin/users/:id/role              make someone an admin or a member
//   POST /admin/users/:id/permissions       choose what a member may manage
//   POST /admin/users/:id/logout            log them out on all their devices
//   POST /admin/users/:id/disable           turn the account off (they can't log in)
//   POST /admin/users/:id/enable            turn it back on
//   POST /admin/users/:id/delete            remove the account
//
// Better Auth calls the two roles "admin" and "user". We show "user" as
// "Member" on the page. A member can also be given parts of the admin area
// to look after (see src/permissions.ts).
//
// Only admins can open these pages. The account changes also go through
// Better Auth's admin functions, which double-check that the logged-in
// person really is an admin. Nobody can demote, turn off or remove their
// own account, so there is always at least one admin.
// ===========================================================================

import { Hono } from "hono";
import type { Context } from "hono";
import { getAllMemberPermissions, getAllUsers, setMemberPermissions, type UserListRow } from "../database";
import { getFormText } from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import { isPermission, PERMISSIONS, type Permission } from "../permissions";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/users", requireAdmin);
routes.use("/admin/users/*", requireAdmin);

// Messages shown after an action, chosen by "?message=..." in the address.
const MESSAGES: Record<string, { kind: "error" | "success"; text: string }> = {
  created: { kind: "success", text: "Account created. Let the person know their email and password." },
  details: { kind: "success", text: "Name and email saved." },
  password: { kind: "success", text: "Password changed. That person has been logged out on all their devices." },
  "password-self": { kind: "success", text: "Your password has been changed." },
  role: { kind: "success", text: "Role changed." },
  permissions: { kind: "success", text: "Saved what this member can manage. It applies from their next page." },
  logout: { kind: "success", text: "Logged out on all their devices. They'll need to log in again." },
  disabled: { kind: "success", text: "Account turned off. They've been logged out and can't log in until you turn it back on." },
  enabled: { kind: "success", text: "Account turned back on. They can log in again." },
  deleted: { kind: "success", text: "Account removed." },
  "short-password": { kind: "error", text: "Passwords must be at least 10 characters." },
  "missing-details": { kind: "error", text: "Please fill in both the name and the email." },
  failed: { kind: "error", text: "That didn't work. The email may already be in use." },
  yourself: { kind: "error", text: "You can't do that to your own account. Ask another admin." },
};

/** "Admin", "Member", or "Member" plus what they look after. */
function describeRole(user: UserListRow, permissions: Set<Permission> | undefined): string {
  if (user.role === "admin") return "Admin";
  const labels = PERMISSIONS.filter((permission) => permissions?.has(permission.key)).map((permission) => permission.label);
  return labels.length === 0 ? "Member" : "Member, manages " + labels.join(", ");
}

/** Turns a date Better Auth saved into "26 Oct 2026", or "" if there isn't one. */
function formatWhen(value: string | number | null, timeZone: string): string {
  if (value === null || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-NZ", { timeZone: timeZone, day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Reads the ticked "may manage" boxes from a form. Anything unknown is ignored. */
function readPermissions(form: Record<string, string | File | (string | File)[]>): Permission[] {
  const value = form["permission"];
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const chosen: Permission[] = [];
  for (const item of values) {
    if (typeof item === "string" && isPermission(item) && !chosen.includes(item)) {
      chosen.push(item);
    }
  }
  return chosen;
}

/** The "may manage" tick boxes, used on the new-account form and each account's page. */
function PermissionBoxes(props: { chosen?: Set<Permission> }) {
  return (
    <fieldset class="permission-boxes">
      <legend>Can also manage (members only, admins can manage everything)</legend>
      {PERMISSIONS.map((permission) => (
        <label class="checkbox">
          <input type="checkbox" name="permission" value={permission.key} checked={props.chosen?.has(permission.key) ?? false} />
          <strong>{permission.label}</strong>
          <span class="muted"> {permission.description}</span>
        </label>
      ))}
    </fieldset>
  );
}

function backTo(userId: string, message: string): string {
  return "/admin/users/" + encodeURIComponent(userId) + "?message=" + message;
}

/** Stops admins changing their own role, or turning off or removing their own account. */
function isMe(c: Context<AppEnv>, userId: string): boolean {
  return userId === c.get("user")!.id;
}

// ---------------------------------------------------------------------------
// The list of accounts
// ---------------------------------------------------------------------------
routes.get("/admin/users", async (c) => {
  const users = await getAllUsers(c.env.DB);
  const permissions = await getAllMemberPermissions(c.env.DB);
  const me = c.get("user")!;
  const message = MESSAGES[c.req.query("message") ?? ""];
  const timeZone = c.env.TIMEZONE;

  return renderPage(
    c,
    "Member accounts",
    <>
      <p><a class="back-link" href="/admin">Back to admin</a></p>
      <h1>Member accounts</h1>
      {message && <Notice kind={message.kind} message={message.text} />}
      <p class="muted">
        Members can see the music, prayers and PowerPoints. Tick what else a member may manage on their page, or make
        them an admin to let them do everything, including this page.
      </p>

      <table class="user-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr class={user.banned ? "user-off" : ""}>
              <td>
                {user.name}
                {user.id === me.id && <span class="muted"> (you)</span>}
              </td>
              <td>{user.email}</td>
              <td>{describeRole(user, permissions.get(user.id))}</td>
              <td>{user.banned ? <span class="status-off">Turned off</span> : "Active"}</td>
              <td>{formatWhen(user.lastActive, timeZone) || <span class="muted">Not yet</span>}</td>
              <td>
                <a class="button button-small button-secondary" href={"/admin/users/" + encodeURIComponent(user.id)}>Manage</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section class="narrow">
        <h2>Create an account</h2>
        <form method="post" action="/admin/users/new">
          <label>
            Name
            <input type="text" name="name" required maxlength={100} />
          </label>
          <label>
            Email
            <input type="email" name="email" required maxlength={200} />
          </label>
          <label>
            Password (at least 10 characters)
            <input type="password" name="password" required minlength={10} autocomplete="new-password" />
          </label>
          <label>
            Role
            <select name="role">
              <option value="user">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <PermissionBoxes />
          <button type="submit">Create account</button>
        </form>
      </section>
    </>,
  );
});

routes.post("/admin/users/new", async (c) => {
  const form = await c.req.parseBody({ all: true });
  const name = getFormText(form, "name");
  const email = getFormText(form, "email").toLowerCase();
  const password = getFormText(form, "password");
  const role = getFormText(form, "role") === "admin" ? "admin" : "user";

  if (password.length < 10) {
    return c.redirect("/admin/users?message=short-password");
  }
  if (name === "" || email === "") {
    return c.redirect("/admin/users?message=missing-details");
  }
  try {
    const result = await c.get("auth").api.createUser({
      body: { name: name, email: email, password: password, role: role },
      headers: c.req.raw.headers,
    });
    if (role === "user") {
      await setMemberPermissions(c.env.DB, result.user.id, readPermissions(form));
    }
  } catch (error) {
    console.error("Create user failed:", error);
    return c.redirect("/admin/users?message=failed");
  }
  return c.redirect("/admin/users?message=created");
});

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------
routes.get("/admin/users/:id", async (c) => {
  const userId = c.req.param("id");
  const user = (await getAllUsers(c.env.DB)).find((each) => each.id === userId);
  if (user === undefined) {
    return renderPage(c, "Not found", <p>That account doesn't exist. <a href="/admin/users">Back to member accounts</a></p>, 404);
  }
  const permissions = (await getAllMemberPermissions(c.env.DB)).get(user.id) ?? new Set<Permission>();
  const message = MESSAGES[c.req.query("message") ?? ""];
  const me = isMe(c, user.id);
  const isAdminAccount = user.role === "admin";
  const action = "/admin/users/" + encodeURIComponent(user.id);
  const timeZone = c.env.TIMEZONE;

  return renderPage(
    c,
    user.name,
    <section class="narrow">
      <p><a class="back-link" href="/admin/users">Back to member accounts</a></p>
      <h1>{user.name}</h1>
      <p class="muted">
        {describeRole(user, permissions)} · {user.banned ? "Turned off" : "Active"}
        {formatWhen(user.createdAt, timeZone) && " · Joined " + formatWhen(user.createdAt, timeZone)}
        {" · Last active " + (formatWhen(user.lastActive, timeZone) || "not yet")}
      </p>
      {message && <Notice kind={message.kind} message={message.text} />}

      <h2>Name and email</h2>
      <form method="post" action={action + "/details"}>
        <label>
          Name
          <input type="text" name="name" required maxlength={100} value={user.name} />
        </label>
        <label>
          Email (what they log in with)
          <input type="email" name="email" required maxlength={200} value={user.email} />
        </label>
        <button type="submit">Save</button>
      </form>

      <h2>Role and what they can manage</h2>
      {me ? (
        <p class="muted">You're an admin. Another admin would need to change your role.</p>
      ) : (
        <form method="post" action={action + "/role"} class="row">
          <input type="hidden" name="role" value={isAdminAccount ? "user" : "admin"} />
          <span>{isAdminAccount ? "Admin: can manage everything, including accounts and settings." : "Member."}</span>
          <button type="submit" class="button-secondary">{isAdminAccount ? "Make member" : "Make admin"}</button>
        </form>
      )}
      {!isAdminAccount && (
        <form method="post" action={action + "/permissions"}>
          <PermissionBoxes chosen={permissions} />
          <button type="submit">Save what they can manage</button>
        </form>
      )}

      <h2>Password</h2>
      <form method="post" action={action + "/password"} class="row">
        <input type="password" name="password" placeholder="New password" minlength={10} required autocomplete="new-password" aria-label="New password" />
        <button type="submit">Set password</button>
      </form>

      {!me && (
        <>
          <h2>Access</h2>
          <form method="post" action={action + "/logout"} class="row">
            <span class="muted">Logs them out on every phone and computer, e.g. after a lost phone.</span>
            <button type="submit" class="button-secondary">Log out everywhere</button>
          </form>
          {user.banned ? (
            <form method="post" action={action + "/enable"} class="row">
              <span class="muted">This account is turned off, so they can't log in.</span>
              <button type="submit">Turn account back on</button>
            </form>
          ) : (
            <form
              method="post"
              action={action + "/disable"}
              class="row"
              onsubmit="return confirm('Turn this account off? They will be logged out and unable to log in.')"
            >
              <span class="muted">Stops them logging in, but keeps the account so you can turn it back on later.</span>
              <button type="submit" class="button-secondary danger-text">Turn account off</button>
            </form>
          )}
          <form
            method="post"
            action={action + "/delete"}
            class="row"
            onsubmit="return confirm('Remove this account for good? This cannot be undone.')"
          >
            <span class="muted">Removes the account for good.</span>
            <button type="submit" class="button-secondary danger-text">Remove account</button>
          </form>
        </>
      )}
    </section>,
  );
});

routes.post("/admin/users/:id/details", async (c) => {
  const userId = c.req.param("id");
  const form = await c.req.parseBody();
  const name = getFormText(form, "name").slice(0, 100);
  const email = getFormText(form, "email").toLowerCase().slice(0, 200);
  if (name === "" || !email.includes("@")) {
    return c.redirect(backTo(userId, "missing-details"));
  }
  try {
    await c.get("auth").api.adminUpdateUser({
      body: { userId: userId, data: { name: name, email: email } },
      headers: c.req.raw.headers,
    });
  } catch (error) {
    console.error("Update user failed:", error);
    return c.redirect(backTo(userId, "failed"));
  }
  return c.redirect(backTo(userId, "details"));
});

routes.post("/admin/users/:id/password", async (c) => {
  const userId = c.req.param("id");
  const form = await c.req.parseBody();
  const password = getFormText(form, "password");

  if (password.length < 10) {
    return c.redirect(backTo(userId, "short-password"));
  }
  try {
    await c.get("auth").api.setUserPassword({
      body: { userId: userId, newPassword: password },
      headers: c.req.raw.headers,
    });
    // Log the person out everywhere, in case someone else knew the old
    // password. (Not for your own account, or you'd be logged out too.)
    if (!isMe(c, userId)) {
      await c.get("auth").api.revokeUserSessions({
        body: { userId: userId },
        headers: c.req.raw.headers,
      });
    }
  } catch (error) {
    console.error("Set password failed:", error);
    return c.redirect(backTo(userId, "failed"));
  }
  return c.redirect(backTo(userId, isMe(c, userId) ? "password-self" : "password"));
});

routes.post("/admin/users/:id/role", async (c) => {
  const userId = c.req.param("id");
  if (isMe(c, userId)) {
    return c.redirect(backTo(userId, "yourself"));
  }
  const form = await c.req.parseBody();
  const role = getFormText(form, "role") === "admin" ? "admin" : "user";

  try {
    await c.get("auth").api.setRole({
      body: { userId: userId, role: role },
      headers: c.req.raw.headers,
    });
    // Admins can do everything, so a new admin's old tick boxes are cleared.
    // (If they're made a member again later, they start with none.)
    if (role === "admin") {
      await setMemberPermissions(c.env.DB, userId, []);
    }
  } catch (error) {
    console.error("Set role failed:", error);
    return c.redirect(backTo(userId, "failed"));
  }
  return c.redirect(backTo(userId, "role"));
});

routes.post("/admin/users/:id/permissions", async (c) => {
  const userId = c.req.param("id");
  const exists = (await getAllUsers(c.env.DB)).some((user) => user.id === userId);
  if (!exists) {
    return c.redirect("/admin/users?message=failed");
  }
  const form = await c.req.parseBody({ all: true });
  try {
    await setMemberPermissions(c.env.DB, userId, readPermissions(form));
  } catch (error) {
    console.error("Set permissions failed:", error);
    return c.redirect(backTo(userId, "failed"));
  }
  return c.redirect(backTo(userId, "permissions"));
});

routes.post("/admin/users/:id/logout", async (c) => {
  const userId = c.req.param("id");
  if (isMe(c, userId)) {
    return c.redirect(backTo(userId, "yourself"));
  }
  try {
    await c.get("auth").api.revokeUserSessions({
      body: { userId: userId },
      headers: c.req.raw.headers,
    });
  } catch (error) {
    console.error("Log out everywhere failed:", error);
    return c.redirect(backTo(userId, "failed"));
  }
  return c.redirect(backTo(userId, "logout"));
});

// "Turn off" uses Better Auth's ban, which also logs them out everywhere.
routes.post("/admin/users/:id/disable", async (c) => {
  const userId = c.req.param("id");
  if (isMe(c, userId)) {
    return c.redirect(backTo(userId, "yourself"));
  }
  try {
    await c.get("auth").api.banUser({
      body: { userId: userId, banReason: "Turned off by an admin" },
      headers: c.req.raw.headers,
    });
  } catch (error) {
    console.error("Turn off account failed:", error);
    return c.redirect(backTo(userId, "failed"));
  }
  return c.redirect(backTo(userId, "disabled"));
});

routes.post("/admin/users/:id/enable", async (c) => {
  const userId = c.req.param("id");
  try {
    await c.get("auth").api.unbanUser({
      body: { userId: userId },
      headers: c.req.raw.headers,
    });
  } catch (error) {
    console.error("Turn on account failed:", error);
    return c.redirect(backTo(userId, "failed"));
  }
  return c.redirect(backTo(userId, "enabled"));
});

routes.post("/admin/users/:id/delete", async (c) => {
  const userId = c.req.param("id");
  if (isMe(c, userId)) {
    return c.redirect(backTo(userId, "yourself"));
  }
  try {
    await c.get("auth").api.removeUser({
      body: { userId: userId },
      headers: c.req.raw.headers,
    });
    await setMemberPermissions(c.env.DB, userId, []);
  } catch (error) {
    console.error("Remove user failed:", error);
    return c.redirect(backTo(userId, "failed"));
  }
  return c.redirect("/admin/users?message=deleted");
});

export default routes;
