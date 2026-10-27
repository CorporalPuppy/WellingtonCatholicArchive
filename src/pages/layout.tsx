// The frame around every page: header, menu, and footer.
// Each page passes its own content in as "children".

import type { Child } from "hono/jsx";
import type { SessionUser } from "../auth";

type LayoutProps = {
  title: string;
  choirName: string;
  user: SessionUser | null;
  showMemberLinks: boolean;
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
        <title>{props.title} | {props.choirName}</title>

        {/* The site icon: in the browser tab, and on a phone's home screen. */}
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#fbfaf7" />

        {/* The "Inter" font from Google Fonts: clean and modern, easy to read. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
        <link rel="stylesheet" href="/styles.css" />
        {/* Picks light or dark mode before the page shows (see public/theme.js). */}
        <script src="/theme.js"></script>
      </head>
      <body>
        <header class="site-header">
          <div class="header-inner">
            <a href="/" class="site-name">
              <img src="/icon.svg" alt="" width="32" height="32" />
              <span>{props.choirName}</span>
            </a>
            <nav>
              <a href="/">Home</a>
              <a href="/events">Calendar</a>
              <a href="/readings">Readings</a>
              {props.showMemberLinks && <a href="/music">Music</a>}
              {props.showMemberLinks && <a href="/powerpoints">PowerPoints</a>}
              {isAdmin && <a href="/admin">Admin</a>}
              {user !== null && <a href="/account">My account</a>}
              {user === null && <a href="/login">Log in</a>}
              {user !== null && (
                <form method="post" action="/logout" class="inline">
                  <button type="submit" class="nav-button">Log out</button>
                </form>
              )}
              <button type="button" class="theme-toggle" onclick="toggleTheme()" aria-label="Switch light or dark mode" title="Light / dark">
                {/* A circle that is half filled in: the usual "light / dark" symbol. */}
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
                  <path d="M12 3 a9 9 0 0 1 0 18 z" fill="currentColor" />
                </svg>
              </button>
            </nav>
          </div>
        </header>

        <main>{props.children}</main>

        <footer class="site-footer">
          <p>
            <strong>{props.choirName}</strong>
          </p>
          <p>
            <a href="/events">Calendar</a> · <a href="/readings">Readings</a> · <a href="/login">Members</a>
          </p>
        </footer>
      </body>
    </html>
  );
}

/** A coloured message box, used for errors and "saved!" notices. */
export function Notice(props: { kind: "error" | "success"; message: string }) {
  return <p class={"notice notice-" + props.kind}>{props.message}</p>;
}
