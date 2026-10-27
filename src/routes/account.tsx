// ===========================================================================
// "My account": lets a logged-in person change their own password.
// ===========================================================================

import { Hono } from "hono";
import { getFormText } from "../helpers";
import { requireLogin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

// Every page in this file needs the visitor to be logged in.
routes.use("/account", requireLogin);
routes.use("/account/*", requireLogin);

function AccountPage(props: { name: string; email: string; message?: { kind: "error" | "success"; text: string } }) {
  return (
    <section class="narrow">
      <h1>My account</h1>
      <p>
        {props.name} ({props.email})
      </p>
      {props.message && <Notice kind={props.message.kind} message={props.message.text} />}
      <h2>Change password</h2>
      <form method="post" action="/account/password">
        <label>
          Current password
          <input type="password" name="currentPassword" required autocomplete="current-password" />
        </label>
        <label>
          New password (at least 10 characters)
          <input type="password" name="newPassword" required minlength={10} autocomplete="new-password" />
        </label>
        <button type="submit">Change password</button>
      </form>
    </section>
  );
}

routes.get("/account", (c) => {
  const user = c.get("user")!;
  return renderPage(c, "My account", <AccountPage name={user.name} email={user.email} />);
});

routes.post("/account/password", async (c) => {
  const user = c.get("user")!;
  const form = await c.req.parseBody();
  const currentPassword = getFormText(form, "currentPassword");
  const newPassword = getFormText(form, "newPassword");

  // revokeOtherSessions logs out every other device, in case someone else
  // knew the old password. Better Auth then gives this browser a new login
  // cookie, which we pass on so the person stays logged in here.
  let authResponse: Response;
  try {
    authResponse = await c.get("auth").api.changePassword({
      body: { currentPassword: currentPassword, newPassword: newPassword, revokeOtherSessions: true },
      headers: c.req.raw.headers,
      asResponse: true,
    });
  } catch (error) {
    authResponse = new Response(null, { status: 500 });
  }

  if (!authResponse.ok) {
    const message = { kind: "error" as const, text: "Couldn't change the password. Check your current password and try again." };
    return renderPage(c, "My account", <AccountPage name={user.name} email={user.email} message={message} />, 400);
  }

  const message = { kind: "success" as const, text: "Password changed. Any other devices have been logged out." };
  const page = await renderPage(c, "My account", <AccountPage name={user.name} email={user.email} message={message} />);
  for (const cookie of authResponse.headers.getSetCookie()) {
    page.headers.append("Set-Cookie", cookie);
  }
  return page;
});

export default routes;
