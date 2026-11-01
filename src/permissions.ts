// ===========================================================================
// What a member may manage.
//
// Admins can do everything. A member can be given any of the parts below,
// which lets them into just that part of the admin area. Only admins can
// manage member accounts and site settings.
//
// Saved in the member_permissions table (migrations/0012_...sql).
// ===========================================================================

export const PERMISSIONS = [
  {
    key: "events",
    label: "Events and calendar",
    description: "Add and edit Masses and rehearsals, set lists, rosters and parishes.",
  },
  {
    key: "songs",
    label: "Songs, prayers and services",
    description: "Add and edit songs and prayers, and upload their files.",
  },
  {
    key: "powerpoints",
    label: "PowerPoints",
    description: "Upload and delete PowerPoints, including from an event's page.",
  },
  {
    key: "readings",
    label: "Daily readings",
    description: "Replace a day's readings with your own.",
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

/** True if this text is one of the permission names above. */
export function isPermission(value: string): value is Permission {
  return PERMISSIONS.some((permission) => permission.key === value);
}
