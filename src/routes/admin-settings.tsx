// ===========================================================================
// Site settings: GET and POST /admin/settings (admins only)
//
// The choir's name, the home page's words and notice, and whether the music,
// prayers and PowerPoints need a login. See src/settings.ts.
// ===========================================================================

import { Hono } from "hono";
import { getFormText } from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import { saveSiteSettings, SETTING_LIMITS } from "../settings";
import type { AppEnv } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/settings", requireAdmin);
routes.use("/admin/settings/*", requireAdmin);

routes.get("/admin/settings", (c) => {
  const settings = c.get("settings");
  const saved = c.req.query("saved") === "1";
  const failed = c.req.query("failed") === "1";

  return renderPage(
    c,
    "Site settings",
    <section class="narrow">
      <p><a class="back-link" href="/admin">Back to admin</a></p>
      <h1>Site settings</h1>
      {saved && <Notice kind="success" message="Saved. It can take up to 30 seconds to show everywhere." />}
      {failed && <Notice kind="error" message="Couldn't save. If the site was just updated, the database may need updating first." />}

      <form method="post" action="/admin/settings">
        <label>
          Choir name (at the top of every page)
          <input type="text" name="choirName" required maxlength={SETTING_LIMITS.choirName} value={settings.choirName} />
        </label>

        <h2>Home page</h2>
        <label>
          Small label above the name (leave empty for none)
          <input type="text" name="eyebrow" maxlength={SETTING_LIMITS.eyebrow} value={settings.eyebrow} />
        </label>
        <label>
          Welcome (who the choir is, where you sing, how to join)
          <textarea name="welcomeText" rows={4} maxlength={SETTING_LIMITS.welcomeText}>{settings.welcomeText}</textarea>
        </label>
        <label>
          Notice at the top of the home page, e.g. "No rehearsal this Thursday" (leave empty for none)
          <textarea name="announcement" rows={2} maxlength={SETTING_LIMITS.announcement}>{settings.announcement}</textarea>
        </label>

        <h2>Everything public?</h2>
        <p>Who can see the music, prayers and PowerPoints without logging in.</p>
        <p class="muted">This also covers rosters, set lists and members-only events. Admin pages always need a login.</p>
        <label class="checkbox">
          <input type="radio" name="everythingPublic" value="yes" checked={settings.everythingPublic} />
          Everything public: anyone can see them, no login needed
        </label>
        <label class="checkbox">
          <input type="radio" name="everythingPublic" value="no" checked={!settings.everythingPublic} />
          Logged-in members only
        </label>
        <p class="muted">
          After switching to members only, files someone already opened can stay in their browser for up to an hour.
        </p>

        <button type="submit">Save settings</button>
      </form>
    </section>,
  );
});

routes.post("/admin/settings", async (c) => {
  const form = await c.req.parseBody();
  const choirName = getFormText(form, "choirName").slice(0, SETTING_LIMITS.choirName);
  try {
    await saveSiteSettings(c.env, {
      choirName: choirName === "" ? c.env.CHOIR_NAME : choirName,
      everythingPublic: getFormText(form, "everythingPublic") === "yes",
      eyebrow: getFormText(form, "eyebrow").slice(0, SETTING_LIMITS.eyebrow),
      welcomeText: getFormText(form, "welcomeText").replace(/\r\n/g, "\n").slice(0, SETTING_LIMITS.welcomeText),
      announcement: getFormText(form, "announcement").replace(/\r\n/g, "\n").slice(0, SETTING_LIMITS.announcement),
    });
  } catch (error) {
    console.error("Save settings failed:", error);
    return c.redirect("/admin/settings?failed=1");
  }
  return c.redirect("/admin/settings?saved=1");
});

export default routes;
