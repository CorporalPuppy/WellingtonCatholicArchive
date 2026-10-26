// A shortcut for showing a page inside the site layout.
// Every route uses this, so the header/menu is always the same.

import type { Context } from "hono";
import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout";
import { canSeeMemberPages } from "../helpers";
import type { AppEnv } from "../types";

export function renderPage(c: Context<AppEnv>, title: string, content: Child, status: 200 | 400 | 403 | 404 = 200) {
  const page = (
    <>
      {/* Tells the browser this is a modern HTML page. */}
      {raw("<!doctype html>")}
      <Layout
        title={title}
        churchName={c.env.CHURCH_NAME}
        user={c.get("user")}
        showMemberLinks={canSeeMemberPages(c)}
      >
        {content}
      </Layout>
    </>
  );
  return c.html(page, status);
}
