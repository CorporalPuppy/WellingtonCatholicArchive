// The frame around every page: header, menu, and footer.
// Each page passes its own content in as "children".

import type { Child } from "hono/jsx";
import type { SessionUser } from "../auth";

type LayoutProps = {
  title: string;
  churchName: string;
  user: SessionUser | null;
  showMusicLink: boolean;
  children?: Child;
};

export function Layout(props: LayoutProps) {
  const user = props.user;
  const isAdmin = user !== null && user.role === "admin";

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} | {props.churchName}</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <header class="site-header">
          <a href="/" class="site-name">{props.churchName}</a>
          <nav>
            <a href="/">Home</a>
            <a href="/events">Events</a>
            {props.showMusicLink && <a href="/music">Music</a>}
            {isAdmin && <a href="/admin">Admin</a>}
            {user !== null && <a href="/account">My account</a>}
            {user === null && <a href="/login">Members login</a>}
            {user !== null && (
              <form method="post" action="/logout" class="inline">
                <button type="submit" class="link-button">Log out</button>
              </form>
            )}
          </nav>
        </header>

        <main>{props.children}</main>

        <footer class="site-footer">
          <p>{props.churchName}</p>
        </footer>
      </body>
    </html>
  );
}

/** A coloured message box, used for errors and "saved!" notices. */
export function Notice(props: { kind: "error" | "success"; message: string }) {
  return <p class={"notice notice-" + props.kind}>{props.message}</p>;
}
