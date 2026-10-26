// ===========================================================================
// Logging in and out, and creating the very first admin account.
// ===========================================================================

import { Hono } from "hono";
import { countUsers } from "../database";
import { getFormText, safeRedirectPath } from "../helpers";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

/**
 * Better Auth answers with a Response that sets (or clears) the login
 * cookie. We want to send the browser to a different page instead, so we
 * copy those cookies onto a redirect.
 */
function redirectWithCookies(location: string, authResponse: Response): Response {
  const redirect = new Response(null, { status: 302, headers: { Location: location } });
  for (const cookie of authResponse.headers.getSetCookie()) {
    redirect.headers.append("Set-Cookie", cookie);
  }
  return redirect;
}

// ---------------------------------------------------------------------------
// The login form: GET /login
// ---------------------------------------------------------------------------
function LoginForm(props: { next: string; error?: string }) {
  return (
    <section class="narrow">
      <h1>Members login</h1>
      {props.error && <Notice kind="error" message={props.error} />}
      <form method="post" action="/login">
        <input type="hidden" name="next" value={props.next} />
        <label>
          Email
          <input type="email" name="email" required autocomplete="username" />
        </label>
        <label>
          Password
          <input type="password" name="password" required autocomplete="current-password" />
        </label>
        <button type="submit">Log in</button>
      </form>
      <p class="muted">Accounts are made by the choir admin. Ask them if you need one.</p>
    </section>
  );
}

routes.get("/login", (c) => {
  const next = safeRedirectPath(c.req.query("next"));
  return renderPage(c, "Login", <LoginForm next={next} />);
});

// ---------------------------------------------------------------------------
// Checking the password: POST /login
// ---------------------------------------------------------------------------
routes.post("/login", async (c) => {
  const form = await c.req.parseBody();
  const email = getFormText(form, "email");
  const password = getFormText(form, "password");
  const next = safeRedirectPath(getFormText(form, "next"));

  const auth = c.get("auth");
  let authResponse: Response;
  try {
    authResponse = await auth.api.signInEmail({
      body: { email: email, password: password },
      headers: c.req.raw.headers,
      asResponse: true,
    });
  } catch (error) {
    console.error("Login failed:", error);
    authResponse = new Response(null, { status: 500 });
  }

  if (!authResponse.ok) {
    const page = <LoginForm next={next} error="That email and password didn't match. Please try again." />;
    return renderPage(c, "Login", page, 400);
  }
  return redirectWithCookies(next, authResponse);
});

// ---------------------------------------------------------------------------
// Logging out: POST /logout
// ---------------------------------------------------------------------------
routes.post("/logout", async (c) => {
  const auth = c.get("auth");
  const authResponse = await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true });
  return redirectWithCookies("/", authResponse);
});

// ---------------------------------------------------------------------------
// First-time setup: GET /setup and POST /setup
//
// When the site is brand new there are no accounts, so nobody can log in to
// create one. This page makes the first admin account. It needs the
// SETUP_TOKEN secret (so a stranger can't do it first), and it switches
// itself off as soon as any account exists.
// ---------------------------------------------------------------------------
function SetupForm(props: { error?: string }) {
  return (
    <section class="narrow">
      <h1>Create the first admin account</h1>
      {props.error && <Notice kind="error" message={props.error} />}
      <form method="post" action="/setup">
        <label>
          Setup code (the SETUP_TOKEN secret you set)
          <input type="password" name="token" required />
        </label>
        <label>
          Your name
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
        <button type="submit">Create admin account</button>
      </form>
    </section>
  );
}

routes.get("/setup", async (c) => {
  if ((await countUsers(c.env.DB)) > 0) {
    return renderPage(c, "Setup", <p>Setup is already done. <a href="/login">Log in here.</a></p>);
  }
  return renderPage(c, "Setup", <SetupForm />);
});

routes.post("/setup", async (c) => {
  if ((await countUsers(c.env.DB)) > 0) {
    return renderPage(c, "Setup", <p>Setup is already done. <a href="/login">Log in here.</a></p>, 403);
  }

  const form = await c.req.parseBody();
  const token = getFormText(form, "token");
  const name = getFormText(form, "name");
  const email = getFormText(form, "email");
  const password = getFormText(form, "password");

  if (!c.env.SETUP_TOKEN) {
    return renderPage(c, "Setup", <SetupForm error="The SETUP_TOKEN secret hasn't been set yet. See the README." />, 400);
  }
  if (token !== c.env.SETUP_TOKEN) {
    return renderPage(c, "Setup", <SetupForm error="That setup code is wrong." />, 400);
  }
  if (password.length < 10) {
    return renderPage(c, "Setup", <SetupForm error="The password must be at least 10 characters." />, 400);
  }

  // Called from the server with no logged-in user, which Better Auth allows.
  const auth = c.get("auth");
  await auth.api.createUser({
    body: { name: name, email: email, password: password, role: "admin" },
  });

  return renderPage(
    c,
    "Setup",
    <section class="narrow">
      <Notice kind="success" message="Your admin account is ready." />
      <p><a href="/login?next=/admin">Log in now</a></p>
    </section>,
  );
});

export default routes;
