// ===========================================================================
// Site settings that admins can change on the website (Admin > Site settings).
//
// Each one has a default. CHOIR_NAME and EVERYTHING_PUBLIC in wrangler.jsonc
// are still used until an admin saves the settings page for the first time.
//
// Saved in the site_settings table (migrations/0012_...sql), one row each.
// ===========================================================================

import type { Env } from "./types";

export type SiteSettings = {
  choirName: string;
  everythingPublic: boolean; // true = music, PowerPoints and rosters need no login
  eyebrow: string; //          the small label above the name on the home page
  welcomeText: string; //      the welcome under the name on the home page
  announcement: string; //     a notice at the top of the home page ("" = none)
};

/** The longest each setting may be, so a slip of the paste can't fill the page. */
export const SETTING_LIMITS = {
  choirName: 80,
  eyebrow: 60,
  welcomeText: 1000,
  announcement: 500,
};

function defaults(env: Env): SiteSettings {
  return {
    choirName: env.CHOIR_NAME,
    everythingPublic: env.EVERYTHING_PUBLIC === "yes",
    eyebrow: "Catholic choir",
    welcomeText: "A short welcome goes here: who the choir is, which parishes we sing at, and how to join.",
    announcement: "",
  };
}

// The settings are read for every page, so each copy of the Worker keeps
// them for 30 seconds instead of asking the database every time. This keeps
// well inside D1's free daily reads. After a change, other copies can show
// the old settings for up to 30 seconds.
const KEEP_FOR_MS = 30_000;
let saved: { settings: SiteSettings; at: number } | null = null;

/** The current site settings. */
export async function getSiteSettings(env: Env): Promise<SiteSettings> {
  if (saved !== null && Date.now() - saved.at < KEEP_FOR_MS) {
    return saved.settings;
  }
  const settings = defaults(env);
  try {
    const result = await env.DB.prepare("SELECT key, value FROM site_settings").all<{ key: string; value: string }>();
    for (const row of result.results) {
      if (row.key === "choir_name" && row.value !== "") settings.choirName = row.value;
      if (row.key === "everything_public") settings.everythingPublic = row.value === "yes";
      if (row.key === "eyebrow") settings.eyebrow = row.value;
      if (row.key === "welcome_text") settings.welcomeText = row.value;
      if (row.key === "announcement") settings.announcement = row.value;
    }
  } catch (error) {
    // The table doesn't exist until `npm run db:migrate:remote` has run.
    // Use the defaults until then rather than breaking every page.
    console.error("Couldn't read site settings:", error);
  }
  saved = { settings: settings, at: Date.now() };
  return settings;
}

/** Saves all the settings at once. */
export async function saveSiteSettings(env: Env, settings: SiteSettings): Promise<void> {
  const rows: [string, string][] = [
    ["choir_name", settings.choirName],
    ["everything_public", settings.everythingPublic ? "yes" : "no"],
    ["eyebrow", settings.eyebrow],
    ["welcome_text", settings.welcomeText],
    ["announcement", settings.announcement],
  ];
  const statement = env.DB.prepare(
    "INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  await env.DB.batch(rows.map(([key, value]) => statement.bind(key, value)));
  saved = null; // this copy of the Worker picks up the change straight away
}
