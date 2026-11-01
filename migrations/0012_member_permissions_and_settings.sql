-- More control over what each member can do, and a few site settings the
-- admins can change on the website instead of in wrangler.jsonc.
--
-- member_permissions: which parts of the admin area a member (not an admin)
-- may manage. One row per member per part. Admins can always manage
-- everything, so they have no rows here. The parts are listed in
-- src/permissions.ts: "events", "songs", "powerpoints" and "readings".
CREATE TABLE member_permissions (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
);

-- site_settings: one row per setting, e.g. ("choir_name", "Family Group").
-- A setting with no row uses its default (see src/settings.ts).
CREATE TABLE site_settings (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);
