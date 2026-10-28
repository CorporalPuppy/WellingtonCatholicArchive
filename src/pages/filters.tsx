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
