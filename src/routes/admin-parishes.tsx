// ===========================================================================
// Admin page for the parishes the choir sings at.
//
//   GET  /admin/parishes               list (each one editable) + add form
//   POST /admin/parishes               add a parish
//   POST /admin/parishes/:id           save changes to a parish
//   POST /admin/parishes/:id/delete    delete a parish (its events are kept)
// ===========================================================================

import { Hono } from "hono";
import { createParish, deleteParish, getParishes, updateParish } from "../database";
import { getFormText } from "../helpers";
import { requireAdmin } from "../middleware";
import { Notice } from "../pages/layout";
import { renderPage } from "../pages/render";
import type { AppEnv, ParishRow } from "../types";

const routes = new Hono<AppEnv>();

routes.use("/admin/parishes", requireAdmin);
routes.use("/admin/parishes/*", requireAdmin);

/** The boxes for a parish, used for adding and for editing. */
function ParishFields(props: { parish?: ParishRow }) {
  const parish = props.parish;
  return (
    <>
      <label>
        Name
        <input type="text" name="name" required value={parish?.name ?? ""} placeholder="e.g. St Mary of the Angels" />
      </label>
      <label>
        Address
        <input type="text" name="address" value={parish?.address ?? ""} placeholder="Street, suburb, city" />
      </label>
      <label>
        Notes (optional)
        <input type="text" name="notes" value={parish?.notes ?? ""} placeholder="e.g. Choir loft upstairs, parking at the back" />
      </label>
    </>
  );
}

routes.get("/admin/parishes", async (c) => {
  const parishes = await getParishes(c.env.DB);
  const justSaved = c.req.query("saved") === "1";

  return renderPage(
    c,
    "Parishes",
    <>
      <p><a href="/admin">Back to admin</a></p>
      <h1>Parishes</h1>
      <p class="muted">The parishes the choir sings at. Each event can be linked to one.</p>
      {justSaved && <Notice kind="success" message="Saved." />}

      {parishes.map((parish) => (
        <section class="narrow card">
          <form method="post" action={"/admin/parishes/" + parish.id}>
            <ParishFields parish={parish} />
            <button type="submit">Save</button>
          </form>
          <form
            method="post"
            action={"/admin/parishes/" + parish.id + "/delete"}
            onsubmit="return confirm('Delete this parish? Its events will be kept.')"
          >
            <button type="submit" class="link-button danger-text">Delete parish</button>
          </form>
        </section>
      ))}

      <section class="narrow">
        <h2>Add a parish</h2>
        <form method="post" action="/admin/parishes">
          <ParishFields />
          <button type="submit">Add parish</button>
        </form>
      </section>
    </>,
  );
});

routes.post("/admin/parishes", async (c) => {
  const form = await c.req.parseBody();
  const name = getFormText(form, "name");
  if (name !== "") {
    await createParish(c.env.DB, name, getFormText(form, "address"), getFormText(form, "notes"));
  }
  return c.redirect("/admin/parishes?saved=1");
});

routes.post("/admin/parishes/:id", async (c) => {
  const parishId = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const name = getFormText(form, "name");
  if (name !== "") {
    await updateParish(c.env.DB, parishId, name, getFormText(form, "address"), getFormText(form, "notes"));
  }
  return c.redirect("/admin/parishes?saved=1");
});

routes.post("/admin/parishes/:id/delete", async (c) => {
  const parishId = Number(c.req.param("id"));
  await deleteParish(c.env.DB, parishId);
  return c.redirect("/admin/parishes");
});

export default routes;
