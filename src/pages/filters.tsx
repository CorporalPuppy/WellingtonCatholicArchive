// The search box and filters shared by the music library, prayers and the
// PowerPoint archive, so they all look and work the same way:
//   - a dropdown in the search box (any tag, any season...) that filters
//     as soon as you pick something
//   - a row of pill links along the top, like a shop's categories
// The styles are .music-search, .tag-filter and .music-filters in styles.css.

/** A page's address with these settings in the query, leaving out empty ones. */
export function pageLink(address: string, settings: Record<string, string>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(settings)) {
    if (value !== "") query.set(name, value);
  }
  const text = query.toString();
  return text === "" ? address : address + "?" + text;
}

/** A dropdown inside the search box, e.g. "Any tag". Picking one submits the form. */
export function FilterSelect(props: {
  name: string;
  label: string;
  anyLabel: string;
  options: (string | { value: string; label: string })[];
  selected: string;
}) {
  return (
    <select name={props.name} aria-label={props.label} onchange="this.form.submit()" class="tag-filter">
      <option value="">{props.anyLabel}</option>
      {props.options.map((option) => {
        const value = typeof option === "string" ? option : option.value;
        const label = typeof option === "string" ? option : option.label;
        return <option value={value} selected={props.selected === value}>{label}</option>;
      })}
    </select>
  );
}

/** "All · Sheet music · Chord charts...": pill links, the chosen one filled in. */
export function FilterPills(props: { label: string; pills: { label: string; href: string; active: boolean }[] }) {
  return (
    <nav class="music-filters" aria-label={props.label}>
      {props.pills.map((pill) => (
        <a href={pill.href} class={pill.active ? "active" : ""}>{pill.label}</a>
      ))}
    </nav>
  );
}

/**
 * The "Updated" filter on the music library and PowerPoints: only things
 * uploaded or changed (e.g. by the sync app) in the past week, month or year.
 */
export const UPDATED_FILTERS = [
  { value: "week", label: "Past week", days: 7 },
  { value: "month", label: "Past month", days: 31 },
  { value: "year", label: "Past year", days: 366 },
];

/**
 * The earliest upload time the "Updated" filter lets through, written the
 * way the database writes times ("2026-10-25 09:30:00", in UTC) so the two
 * can be compared as text. "" = no filter.
 */
export function updatedSince(choice: string): string {
  const filter = UPDATED_FILTERS.find((item) => item.value === choice);
  if (filter === undefined) return "";
  const cutoff = new Date(Date.now() - filter.days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().replace("T", " ").slice(0, 19);
}
