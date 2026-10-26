// ===========================================================================
// Admin pages for member accounts. There is no public sign-up: an admin
// creates each account here and tells the person their password.
//
//   GET  /admin/users                     list of accounts + "new account" form
//   POST /admin/users/new                 create an account
//   POST /admin/users/:id/password        set a new password for someone
//   POST /admin/users/:id/role            make someone an admin or a member
//
// Better Auth calls the two roles "admin" and "user". We show "user" as
// "Member" on the page.
//   POST /admin/users/:id/delete          remove an account
//
// Each action calls Better Auth's admin functions, which double-check that
// the logged-in person really is an admin.
// ===========================================================================

import { Hono } from "hono";
import { getAllUsers } from "../database";
import { getFormText } from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/users", requireAdmin);
routes.use("/admin/users/*", requireAdmin);

// Messages shown after an action, chosen by "?message=..." in the address.
const MESSAGES: Record<string, { kind: "error" | "success"; text: string }> = {
  created: { kind: "success", text: "Account created. Let the person know their email and password." },
  password: { kind: "success", text: "Password changed." },
  role: { kind: "success", text: "Role changed." },
  deleted: { kind: "success", text: "Account removed." },
  "short-password": { kind: "error", text: "Passwords must be at least 10 characters." },
  failed: { kind: "error", text: "That didn't work. The email may already be in use." },
  yourself: { kind: "error", text: "You can't remove or demote your own account." },
};

routes.get("/admin/users", async (c) => {
  const users = await getAllUsers(c.env.DB);
  const me = c.get("user")!;
  const message = MESSAGES[c.req.query("message") ?? ""];

  return renderPage(
    c,
    "Member accounts",
    <>
      <p><a href="/admin">Back to admin</a></p>
      <h1>Member accounts</h1>
      {message && <Notice kind={message.kind} message={message.text} />}

      <table class="user-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{user.role === "admin" ? "Admin" : "Member"}</td>
              <td>
                <form method="post" action={"/admin/users/" + user.id + "/password"} class="row">
                  <input type="password" name="password" placeholder="New password" minlength={10} required />
                  <button type="submit">Set password</button>
                </form>
                {user.id !== me.id && (
                  <>
                    <form method="post" action={"/admin/users/" + user.id + "/role"} class="inline">
                      <input type="hidden" name="role" value={user.role === "admin" ? "user" : "admin"} />
                      <button type="submit" class="link-button">
                        {user.role === "admin" ? "Make member" : "Make admin"}
                      </button>
                    </form>{" "}
                    <form
                      method="post"
                      action={"/admin/users/" + user.id + "/delete"}
                      class="inline"
                      onsubmit="return confirm('Remove this account?')"
                    >
                      <button type="submit" class="link-button danger-text">Remove</button>
                    </form>
                  </>
                )}
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
            <input type="text" name="name" required />
          </label>
          <label>
            Email
            <input type="email" name="email" required />
          </label>
          <label>
            Password (at least 10 characters)
            <input type="password" name="password" required minlength={10} />
          </label>
          <label>
            Role
            <select name="role">
              <option value="user">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit">Create account</button>
        </form>
      </section>
    </>,
  );
});

routes.post("/admin/users/new", async (c) => {
  const form = await c.req.parseBody();
  const name = getFormText(form, "name");
  const email = getFormText(form, "email");
  const password = getFormText(form, "password");
  const role = getFormText(form, "role") === "admin" ? "admin" : "user";

  if (password.length < 10) {
    return c.redirect("/admin/users?message=short-password");
  }
  try {
    await c.get("auth").api.createUser({
      body: { name: name, email: email, password: password, role: role },
      headers: c.req.raw.headers,
    });
  } catch (error) {
    console.error("Create user failed:", error);
    return c.redirect("/admin/users?message=failed");
  }
  return c.redirect("/admin/users?message=created");
});

routes.post("/admin/users/:id/password", async (c) => {
  const userId = c.req.param("id");
  const form = await c.req.parseBody();
  const password = getFormText(form, "password");

  if (password.length < 10) {
    return c.redirect("/admin/users?message=short-password");
  }
  try {
    await c.get("auth").api.setUserPassword({
      body: { userId: userId, newPassword: password },
      headers: c.req.raw.headers,
    });
  } catch (error) {
    console.error("Set password failed:", error);
    return c.redirect("/admin/users?message=failed");
  }
  return c.redirect("/admin/users?message=password");
});

routes.post("/admin/users/:id/role", async (c) => {
  const userId = c.req.param("id");
  if (userId === c.get("user")!.id) {
    return c.redirect("/admin/users?message=yourself");
  }
  const form = await c.req.parseBody();
  const role = getFormText(form, "role") === "admin" ? "admin" : "user";

  await c.get("auth").api.setRole({
    body: { userId: userId, role: role },
    headers: c.req.raw.headers,
  });
  return c.redirect("/admin/users?message=role");
});

routes.post("/admin/users/:id/delete", async (c) => {
  const userId = c.req.param("id");
  if (userId === c.get("user")!.id) {
    return c.redirect("/admin/users?message=yourself");
  }
  await c.get("auth").api.removeUser({
    body: { userId: userId },
    headers: c.req.raw.headers,
  });
  return c.redirect("/admin/users?message=deleted");
});

export default routes;
