// ===========================================================================
// The calendar page, made to look and work like Google Calendar.
//
// src/routes/calendar.tsx sends a frame (top bar, side panel, empty main
// area). This file draws the views into it and handles clicks and drags:
//
//   Day / Week   a column per day with the hours down the side
//   Month        a grid of days
//   Schedule     a list of what's coming, day by day
//
// Everyone can switch views, click an event for its details, and hide or
// colour the parishes ("calendars") down the side. Admins can also click
// an empty spot to add an event, drag an event to move it, and drag its
// bottom edge to make it longer or shorter.
//
// Times are plain local text, "2026-11-01T10:00", exactly as saved, so
// there is no time zone maths. Dates are worked out with Date.UTC, which
// never shifts for daylight saving.
// ===========================================================================

(function () {
  "use strict";

  const root = document.getElementById("gcal");
  if (root === null) return;

  // ---- Settings sent by the server ----
  const TODAY = root.dataset.today; //           "2026-10-30"
  const TIMEZONE = root.dataset.timezone; //     "Pacific/Auckland"
  const IS_ADMIN = root.dataset.admin === "yes";
  const CALENDARS = JSON.parse(root.dataset.calendars); // [{ key: "p1", parishId: 1, name: "St Mary's" }, ...]

  const HOUR_HEIGHT = 48; //  pixels per hour in the Day and Week views
  const SNAP_MINUTES = 15; // dragging moves in steps of a quarter of an hour
  const PHONE = window.matchMedia("(max-width: 720px)");

  // Google Calendar's own colours, with their names.
  const COLOURS = [
    { name: "Peacock", value: "#039be5" },
    { name: "Tomato", value: "#d50000" },
    { name: "Sage", value: "#33b679" },
    { name: "Grape", value: "#8e24aa" },
    { name: "Tangerine", value: "#f4511e" },
    { name: "Blueberry", value: "#3f51b5" },
    { name: "Flamingo", value: "#e67c73" },
    { name: "Basil", value: "#0b8043" },
    { name: "Lavender", value: "#7986cb" },
    { name: "Banana", value: "#f6bf26" },
    { name: "Graphite", value: "#616161" },
  ];

  const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const VIEW_NAMES = { day: "Day", week: "Week", month: "Month", schedule: "Schedule" };

  // ---- What the page is showing right now ----
  const state = {
    view: "month", //   "day", "week", "month" or "schedule"
    date: TODAY, //     the day the view is built around
    miniMonth: TODAY.slice(0, 7), // the month shown in the small calendar
    scheduleDays: 62, // how far ahead the Schedule view looks (grows with "Show more")
    events: [], //      events for the current view (from the server)
    hidden: new Set(), // calendar keys switched off in the side panel
    colours: {}, //     calendar key -> colour chosen in the side panel
  };

  // Events already fetched, by "from|to", so going back and forth is instant.
  const cache = new Map();

  // =========================================================================
  // Small helpers
  // =========================================================================

  const $ = (id) => document.getElementById(id);

  /** Makes text safe to put inside HTML. */
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function readSaved(name, fallback) {
    try {
      const text = localStorage.getItem(name);
      return text === null ? fallback : JSON.parse(text);
    } catch (error) {
      return fallback; // private browsing can block localStorage; that's fine
    }
  }
  function save(name, value) {
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch (error) {
      // Can't remember it; everything still works on this page.
    }
  }

  // ---- Dates: always "YYYY-MM-DD" text ----

  function toDate(text) {
    return new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10))));
  }
  function fromDate(date) {
    return date.toISOString().slice(0, 10);
  }
  function addDays(text, days) {
    const date = toDate(text);
    date.setUTCDate(date.getUTCDate() + days);
    return fromDate(date);
  }
  function addMonths(text, months) {
    const date = toDate(text.slice(0, 7) + "-01");
    date.setUTCMonth(date.getUTCMonth() + months);
    // Keep the same day of the month if it exists (31 Jan + 1 month = 28 Feb).
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(Number(text.slice(8, 10)) || 1, lastDay));
    return fromDate(date);
  }
  /** The Monday on or before a day (weeks start on Monday, as in New Zealand). */
  function startOfWeek(text) {
    return addDays(text, -((toDate(text).getUTCDay() + 6) % 7));
  }
  function daysBetween(from, to) {
    return Math.round((toDate(to) - toDate(from)) / 86400000);
  }
  /** Formats a "YYYY-MM-DD" day with Intl options, e.g. { weekday: "long" }. */
  function formatDay(text, options) {
    return new Intl.DateTimeFormat("en-NZ", Object.assign({ timeZone: "UTC" }, options)).format(toDate(text));
  }

  // ---- Times ----

  /** "10:30" -> 630 (minutes after midnight) */
  function minutesOf(time) {
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  }
  /** 630 -> "10:30" */
  function timeOf(minutes) {
    const hours = Math.floor(minutes / 60);
    return String(hours).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
  }
  /** Adds minutes to "2026-11-01T10:00" (can go into the next day). */
  function addMinutes(localTime, minutes) {
    const total = minutesOf(localTime.slice(11, 16)) + minutes;
    const dayShift = Math.floor(total / 1440);
    return addDays(localTime.slice(0, 10), dayShift) + "T" + timeOf(((total % 1440) + 1440) % 1440);
  }
  /** Minutes from one "…T10:00" time to another. */
  function minutesBetween(from, to) {
    return daysBetween(from.slice(0, 10), to.slice(0, 10)) * 1440 + minutesOf(to.slice(11, 16)) - minutesOf(from.slice(11, 16));
  }
  /** "10:00" -> "10am", "19:30" -> "7:30pm", the way Google writes times. */
  function shortTime(time) {
    const minutes = minutesOf(time);
    const hour = Math.floor(minutes / 60) % 12 || 12;
    const minute = minutes % 60;
    return hour + (minute === 0 ? "" : ":" + String(minute).padStart(2, "0")) + (minutes < 720 ? "am" : "pm");
  }
  /** "10am – 11am", or "10 – 11am" when both are in the morning (or both afternoon). */
  function timeRange(event) {
    const start = shortTime(event.start.slice(11, 16));
    const end = shortTime(event.end.slice(11, 16));
    if (event.noEnd) return start;
    if (start.slice(-2) === end.slice(-2)) return start.slice(0, -2) + " – " + end;
    return start + " – " + end;
  }
  /** The time right now in the choir's time zone, as minutes after midnight, and today's date. */
  function nowInChoirTime() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type).value;
    return { date: get("year") + "-" + get("month") + "-" + get("day"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  }

  // ---- Calendars (one per parish) and their colours ----

  function calendarKeyOf(event) {
    return event.parish_id === null ? "other" : "p" + event.parish_id;
  }
  function calendarByKey(key) {
    return CALENDARS.find((calendar) => calendar.key === key) || { key: key, parishId: 0, name: "Other" };
  }
  function colourOf(key) {
    if (state.colours[key]) return state.colours[key];
    if (key === "other") return "#616161"; // Graphite
    const index = CALENDARS.findIndex((calendar) => calendar.key === key);
    return COLOURS[Math.max(index, 0) % (COLOURS.length - 1)].value;
  }
  /** Black or white text, whichever is easier to read on a colour. */
  function textColourOn(colour) {
    const r = parseInt(colour.slice(1, 3), 16);
    const g = parseInt(colour.slice(3, 5), 16);
    const b = parseInt(colour.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 170 ? "#202124" : "#ffffff";
  }

  // =========================================================================
  // Events from the server
  // =========================================================================

  /** Adds the fields the views need: start, end, and which calendar it's in. */
  function prepare(row) {
    const start = row.starts_at;
    let end = row.ends_at;
    let noEnd = false;
    if (!end || end <= start) {
      // No end time: show it as an hour long, like Google does.
      end = addMinutes(start, 60);
      noEnd = true;
    }
    return Object.assign({}, row, { start: start, end: end, noEnd: noEnd, calendar: calendarKeyOf(row) });
  }

  /** The days the current view covers: [first day, day after the last]. */
  function visibleRange() {
    if (state.view === "day") return [state.date, addDays(state.date, 1)];
    if (state.view === "week") {
      const monday = startOfWeek(state.date);
      return [monday, addDays(monday, 7)];
    }
    if (state.view === "month") {
      const days = monthGridDays(state.date);
      return [days[0], addDays(days[days.length - 1], 1)];
    }
    return [state.date, addDays(state.date, state.scheduleDays)];
  }

  async function fetchEvents(from, to) {
    const key = from + "|" + to;
    if (!cache.has(key)) {
      const response = await fetch("/api/calendar/events?from=" + from + "&to=" + to, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Couldn't load events");
      const data = await response.json();
      cache.set(key, data.events.map(prepare));
    }
    return cache.get(key);
  }

  let loadNumber = 0;
  /** Fetches the events for the current view (if needed) and draws it. */
  async function load() {
    const [from, to] = visibleRange();
    const thisLoad = ++loadNumber;
    render(); // draw straight away (with what we have), then again when the events arrive
    try {
      const events = await fetchEvents(from, to);
      if (thisLoad !== loadNumber) return; // the person has already moved on
      state.events = events;
      render();
    } catch (error) {
      showToast("Couldn't load the calendar. Check your internet connection and try again.");
    }
  }

  /** Throws away what's been fetched (after a change) and loads again. */
  function reload() {
    cache.clear();
    load();
  }

  /** The events to show: those in calendars that aren't switched off. */
  function shownEvents() {
    return state.events.filter((event) => !state.hidden.has(event.calendar));
  }

  /** Events on a day, soonest first (an event over several days is on each of them). */
  function eventsOn(day, events) {
    return events.filter((event) => event.start.slice(0, 10) <= day && endDay(event) >= day);
  }
  /** The last day an event is on (an event ending at midnight doesn't count that day). */
  function endDay(event) {
    const day = event.end.slice(0, 10);
    return event.end.slice(11, 16) === "00:00" && day > event.start.slice(0, 10) ? addDays(day, -1) : day;
  }
  function isMultiDay(event) {
    return endDay(event) > event.start.slice(0, 10);
  }

  // =========================================================================
  // Drawing
  // =========================================================================

  function render() {
    closeMenus();
    root.dataset.currentView = state.view;
    $("gcal-view-name").textContent = VIEW_NAMES[state.view];
    $("gcal-range").textContent = rangeTitle();
    drawMiniMonth();
    drawCalendarList();

    const main = $("gcal-main");
    // Keep the Day/Week scroll position when only the events change.
    const oldScroll = main.querySelector(".gt-scroll");
    const keepScroll = oldScroll && main.dataset.drawn === state.view + state.date ? oldScroll.scrollTop : null;

    if (state.view === "month") main.innerHTML = monthHtml();
    else if (state.view === "schedule") main.innerHTML = scheduleHtml();
    else main.innerHTML = timeGridHtml(state.view === "day" ? [state.date] : weekDays(state.date));

    if (state.view === "month") fitMonthChips();
    if (state.view === "day" || state.view === "week") {
      const scroller = main.querySelector(".gt-scroll");
      scroller.scrollTop = keepScroll !== null ? keepScroll : firstScrollPosition();
      drawNowLine();
    }
    main.dataset.drawn = state.view + state.date;
    rememberInAddressBar();
  }

  /** The words next to the arrows: "November 2026", "3 – 9 Nov 2026"... */
  function rangeTitle() {
    if (state.view === "day") return formatDay(state.date, { day: "numeric", month: "long", year: "numeric" });
    if (state.view === "month" || state.view === "schedule") return formatDay(state.date, { month: "long", year: "numeric" });
    const first = startOfWeek(state.date);
    const last = addDays(first, 6);
    if (first.slice(0, 7) === last.slice(0, 7)) return formatDay(first, { month: "long", year: "numeric" });
    if (first.slice(0, 4) === last.slice(0, 4)) {
      return formatDay(first, { month: "short" }) + " – " + formatDay(last, { month: "short", year: "numeric" });
    }
    return formatDay(first, { month: "short", year: "numeric" }) + " – " + formatDay(last, { month: "short", year: "numeric" });
  }

  function weekDays(day) {
    const monday = startOfWeek(day);
    return [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));
  }

  /** A small coloured dot, as next to events in Google's month and schedule views. */
  function dot(event) {
    return '<span class="gcal-dot" style="background:' + colourOf(event.calendar) + '"></span>';
  }

  const LOCK_ICON =
    '<svg class="gcal-lock" viewBox="0 0 24 24" aria-label="Members only"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>';

  // ---- Month ----

  /** Every day in the month grid: whole weeks, Monday to Sunday. */
  function monthGridDays(day) {
    const first = day.slice(0, 7) + "-01";
    const last = addDays(addMonths(first, 1), -1);
    const start = startOfWeek(first);
    const end = addDays(startOfWeek(last), 6);
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    return days;
  }

  function monthHtml() {
    const days = monthGridDays(state.date);
    const events = shownEvents();
    const month = state.date.slice(0, 7);
    let html = '<div class="gm" style="--weeks:' + days.length / 7 + '">';
    html += '<div class="gm-head">' + WEEKDAYS_SHORT.map((name) => "<div>" + name + "</div>").join("") + "</div>";
    html += '<div class="gm-grid">';
    for (const day of days) {
      let classes = "gm-cell";
      if (day.slice(0, 7) !== month) classes += " gm-other";
      if (day === TODAY) classes += " gm-today";
      // Google writes "1 Nov" on the first of each month.
      const label = day.slice(8) === "01" ? formatDay(day, { day: "numeric", month: "short" }) : String(Number(day.slice(8)));
      html += '<div class="' + classes + '" data-date="' + day + '">';
      html += '<button type="button" class="gm-daynum" data-goto="' + day + '" aria-label="' + formatDay(day, { weekday: "long", day: "numeric", month: "long" }) + '">' + label + "</button>";
      html += '<div class="gm-events">';
      for (const event of eventsOn(day, events)) html += monthChip(event, day);
      html += "</div></div>";
    }
    html += "</div></div>";
    return html;
  }

  function monthChip(event, day) {
    const colour = colourOf(event.calendar);
    if (isMultiDay(event)) {
      // Events over several days are filled bars, like Google's all-day events.
      return (
        '<button type="button" class="gcal-chip gcal-chip-filled" data-event="' + event.id + '" style="background:' + colour + ";color:" + textColourOn(colour) + '">' +
        (day === event.start.slice(0, 10) ? escapeHtml(event.title) : "&nbsp;" + escapeHtml(event.title)) +
        "</button>"
      );
    }
    return (
      '<button type="button" class="gcal-chip" data-event="' + event.id + '">' + dot(event) +
      '<span class="gcal-chip-time">' + shortTime(event.start.slice(11, 16)) + "</span> " +
      '<span class="gcal-chip-title">' + escapeHtml(event.title) + "</span>" + (event.is_public === 0 ? LOCK_ICON : "") +
      "</button>"
    );
  }

  /** Where a day has more events than fit, show "2 more" instead (click it to see them all). */
  function fitMonthChips() {
    for (const list of $("gcal-main").querySelectorAll(".gm-events")) {
      const chips = Array.from(list.children);
      if (chips.length === 0) continue;
      const chipHeight = chips[0].offsetHeight + 2;
      const fits = Math.max(1, Math.floor(list.clientHeight / chipHeight));
      if (chips.length <= fits) continue;
      const showing = fits - 1;
      chips.slice(showing).forEach((chip) => chip.remove());
      const more = document.createElement("button");
      more.type = "button";
      more.className = "gcal-more";
      more.dataset.more = list.parentElement.dataset.date;
      more.textContent = chips.length - showing + " more";
      list.appendChild(more);
    }
  }

  // ---- Day and Week ----

  function timeGridHtml(days) {
    const events = shownEvents();
    const allDayEvents = events.filter(isMultiDay);
    const timed = events.filter((event) => !isMultiDay(event));
    const cols = "--days:" + days.length;

    let html = '<div class="gt" style="' + cols + '">';

    // The row of day names along the top.
    html += '<div class="gt-head"><div class="gt-gutter gt-zone">' + escapeHtml(zoneLabel()) + "</div>";
    for (const day of days) {
      html += '<div class="gt-dayhead' + (day === TODAY ? " gt-today" : "") + (day < TODAY ? " gt-past" : "") + '">';
      html += '<span class="gt-dow">' + formatDay(day, { weekday: "short" }) + "</span>";
      html += '<button type="button" class="gt-daynum" data-goto="' + day + '">' + Number(day.slice(8)) + "</button></div>";
    }
    html += "</div>";

    // Events over several days go in a strip under the day names.
    if (allDayEvents.length > 0) {
      html += '<div class="gt-allday"><div class="gt-gutter"></div>';
      for (const day of days) {
        html += '<div class="gt-allday-cell">';
        for (const event of eventsOn(day, allDayEvents)) html += monthChip(event, day);
        html += "</div>";
      }
      html += "</div>";
    }

    // The hours, and a column for each day.
    html += '<div class="gt-scroll"><div class="gt-body" style="height:' + 24 * HOUR_HEIGHT + 'px">';
    html += '<div class="gt-hours">';
    for (let hour = 1; hour < 24; hour++) {
      html += '<span style="top:' + hour * HOUR_HEIGHT + 'px">' + shortTime(timeOf(hour * 60)).replace(":00", "").toUpperCase() + "</span>";
    }
    html += "</div>";
    for (const day of days) {
      html += '<div class="gt-col' + (day === TODAY ? " gt-today" : "") + '" data-date="' + day + '">';
      html += layOutDay(eventsOn(day, timed)).map((placed) => timedEventHtml(placed)).join("");
      html += "</div>";
    }
    html += "</div></div></div>";
    return html;
  }

  /** "GMT+13", shown above the hours, as Google does. */
  function zoneLabel() {
    try {
      const parts = new Intl.DateTimeFormat("en-NZ", { timeZone: TIMEZONE, timeZoneName: "shortOffset" }).formatToParts(new Date());
      return parts.find((part) => part.type === "timeZoneName").value;
    } catch (error) {
      return "";
    }
  }

  /**
   * Works out where each event goes in a day's column. Events at the same
   * time sit side by side, each taking a share of the width.
   */
  function layOutDay(events) {
    const sorted = events.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : b.end.localeCompare(a.end)));
    const placed = [];
    let group = []; //  events that overlap each other, one way or another
    let columnEnds = []; // when the last event in each column ends
    let groupEnd = "";

    function finishGroup() {
      for (const item of group) item.columns = columnEnds.length;
      group = [];
      columnEnds = [];
    }

    for (const event of sorted) {
      // An event that starts at least 15 minutes after everything in the
      // group has ended starts a new group.
      if (group.length > 0 && event.start >= groupEnd) finishGroup();
      const shownEnd = addMinutes(event.start, Math.max(minutesBetween(event.start, event.end), 30));
      let column = columnEnds.findIndex((end) => end <= event.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(shownEnd);
      } else {
        columnEnds[column] = shownEnd;
      }
      const item = { event: event, column: column, columns: 1 };
      group.push(item);
      placed.push(item);
      if (group.length === 1 || shownEnd > groupEnd) groupEnd = shownEnd;
    }
    finishGroup();
    return placed;
  }

  function timedEventHtml(placed) {
    const event = placed.event;
    const startMinutes = minutesOf(event.start.slice(11, 16));
    const length = Math.min(Math.max(minutesBetween(event.start, event.end), 0), 1440 - startMinutes);
    const top = (startMinutes / 60) * HOUR_HEIGHT;
    const height = Math.max((length / 60) * HOUR_HEIGHT, HOUR_HEIGHT / 4) - 2;
    const colour = colourOf(event.calendar);
    const width = 100 / placed.columns;
    // Like Google, events side by side overlap a little so the titles have room.
    const style =
      "top:" + top + "px;height:" + height + "px;left:calc(" + placed.column * width + "% + 1px);" +
      "width:calc(" + (placed.column === placed.columns - 1 ? width : width * 1.5) + "% - 4px);" +
      "z-index:" + (placed.column + 1) + ";background:" + colour + ";color:" + textColourOn(colour);
    const short = length < 45;
    let classes = "gt-event";
    if (short) classes += " gt-event-short";
    if (event.is_public === 0) classes += " gt-event-private";
    if (event.end.slice(0, 10) < TODAY || (event.end.slice(0, 10) === TODAY && minutesOf(event.end.slice(11, 16)) < nowInChoirTime().minutes)) {
      classes += " gt-event-past";
    }

    let html = '<div class="' + classes + '" data-event="' + event.id + '" style="' + style + '" role="button" tabindex="0">';
    if (short) {
      html += '<span class="gt-event-title">' + escapeHtml(event.title) + "</span>, " + shortTime(event.start.slice(11, 16));
    } else {
      html += '<span class="gt-event-title">' + escapeHtml(event.title) + (event.is_public === 0 ? " " + LOCK_ICON : "") + "</span>";
      html += '<span class="gt-event-time">' + timeRange(event) + "</span>";
      const where = event.parish_name || event.location;
      if (where && length >= 75) html += '<span class="gt-event-where">' + escapeHtml(where) + "</span>";
    }
    if (IS_ADMIN) html += '<span class="gt-resize" data-resize="' + event.id + '"></span>';
    html += "</div>";
    return html;
  }

  /** Scrolls the hours so the morning (or the first event) is in view. */
  function firstScrollPosition() {
    let firstMinutes = 8 * 60;
    for (const event of shownEvents()) {
      if (!isMultiDay(event)) firstMinutes = Math.min(firstMinutes, minutesOf(event.start.slice(11, 16)));
    }
    return Math.max(0, (firstMinutes / 60 - 0.5) * HOUR_HEIGHT);
  }

  /** The red "now" line across today's column. */
  function drawNowLine() {
    const now = nowInChoirTime();
    for (const old of document.querySelectorAll(".gt-now")) old.remove();
    const column = $("gcal-main").querySelector('.gt-col[data-date="' + now.date + '"]');
    if (column === null) return;
    const line = document.createElement("div");
    line.className = "gt-now";
    line.style.top = (now.minutes / 60) * HOUR_HEIGHT + "px";
    column.appendChild(line);
  }
  setInterval(() => {
    if (state.view === "day" || state.view === "week") drawNowLine();
  }, 60000);

  // ---- Schedule ----

  function scheduleHtml() {
    const events = shownEvents();
    const last = addDays(state.date, state.scheduleDays - 1);
    let html = '<div class="gs">';
    let month = "";
    let anything = false;
    for (let day = state.date; day <= last; day = addDays(day, 1)) {
      const todays = eventsOn(day, events);
      if (todays.length === 0 && day !== TODAY) continue;
      if (day.slice(0, 7) !== month) {
        month = day.slice(0, 7);
        html += '<h3 class="gs-month">' + formatDay(day, { month: "long", year: "numeric" }) + "</h3>";
      }
      html += '<div class="gs-day' + (day === TODAY ? " gs-today" : "") + '">';
      html += '<button type="button" class="gs-date" data-goto="' + day + '"><span class="gs-num">' + Number(day.slice(8)) + "</span>";
      html += '<span class="gs-dow">' + formatDay(day, { month: "short" }) + ", " + formatDay(day, { weekday: "short" }) + "</span></button>";
      html += '<div class="gs-events">';
      if (todays.length === 0) html += '<p class="gs-nothing">Nothing on today</p>';
      for (const event of todays) {
        anything = true;
        const where = [event.parish_name, event.location].filter(Boolean).join(" · ");
        html += '<button type="button" class="gs-event" data-event="' + event.id + '">' + dot(event);
        html += '<span class="gs-time">' + (isMultiDay(event) ? "All day" : timeRange(event)) + "</span>";
        html += '<span class="gs-title">' + escapeHtml(event.title) + (event.is_public === 0 ? " " + LOCK_ICON : "");
        if (where) html += '<span class="gs-where">' + escapeHtml(where) + "</span>";
        html += "</span></button>";
      }
      html += "</div></div>";
    }
    if (!anything) {
      html +=
        '<p class="gs-empty">Nothing planned from ' + formatDay(state.date, { day: "numeric", month: "long" }) +
        " to " + formatDay(last, { day: "numeric", month: "long", year: "numeric" }) + ".</p>";
    }
    html += '<p class="gs-more-row"><button type="button" class="gcal-pill" id="gs-more">Show more</button></p>';
    html += "</div>";
    return html;
  }

  // ---- The small month in the side panel ----

  function drawMiniMonth() {
    const days = monthGridDays(state.miniMonth + "-01");
    const [from, to] = state.view === "schedule" ? [state.date, addDays(state.date, 1)] : visibleRange();
    let html = '<div class="gcal-mini-head"><span>' + formatDay(state.miniMonth + "-01", { month: "long", year: "numeric" }) + "</span>";
    html += '<button type="button" class="gcal-icon-button" data-mini="-1" aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg></button>';
    html += '<button type="button" class="gcal-icon-button" data-mini="1" aria-label="Next month"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button></div>';
    html += '<div class="gcal-mini-grid">' + WEEKDAYS_SHORT.map((name) => "<span>" + name[0] + "</span>").join("");
    for (const day of days) {
      let classes = "";
      if (day.slice(0, 7) !== state.miniMonth) classes += " other";
      if (day >= from && day < to && state.view !== "month") classes += " in-range";
      if (day === state.date) classes += " selected";
      if (day === TODAY) classes += " today";
      html += '<button type="button" class="' + classes.trim() + '" data-pick="' + day + '">' + Number(day.slice(8)) + "</button>";
    }
    html += "</div>";
    $("gcal-mini").innerHTML = html;
  }

  // ---- The list of calendars in the side panel ----

  function drawCalendarList() {
    let html = "";
    for (const calendar of CALENDARS) {
      const colour = colourOf(calendar.key);
      const on = !state.hidden.has(calendar.key);
      html += '<li class="gcal-calendar">';
      html += '<label><input type="checkbox" data-calendar="' + calendar.key + '"' + (on ? " checked" : "") + ' style="--colour:' + colour + '" />';
      html += "<span>" + escapeHtml(calendar.name) + "</span></label>";
      html += '<button type="button" class="gcal-icon-button gcal-calendar-options" data-options="' + calendar.key + '" aria-label="Options for ' + escapeHtml(calendar.name) + '">';
      html += '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg></button></li>';
    }
    $("gcal-calendar-list").innerHTML = html;
  }

  // =========================================================================
  // Moving around
  // =========================================================================

  function setView(view) {
    state.view = view;
    save("calendarView", view);
    load();
  }

  function goTo(day) {
    state.date = day;
    state.miniMonth = day.slice(0, 7);
    if (state.view === "schedule") state.scheduleDays = 62;
    load();
  }

  /** The "<" and ">" arrows: back or on by a day, week or month. */
  function step(direction) {
    if (state.view === "day") goTo(addDays(state.date, direction));
    else if (state.view === "week") goTo(addDays(state.date, 7 * direction));
    else goTo(addMonths(state.date, direction));
  }

  /** Keeps the address bar up to date, so a refresh or a shared link shows the same thing. */
  function rememberInAddressBar() {
    const params = new URLSearchParams(location.search);
    params.set("view", state.view);
    params.set("date", state.date);
    params.delete("month");
    history.replaceState(null, "", "/events?" + params.toString());
  }

  // =========================================================================
  // Pop-ups: an event's details, "Add title", and "N more"
  // =========================================================================

  const popover = $("gcal-popover");
  let ghost = null; // the grey "(No title)" box shown while adding an event

  /** Shows the pop-up next to an element (or as a sheet from the bottom on phones). */
  function openPopover(html, anchor, extraClass) {
    popover.className = "gcal-popover" + (extraClass ? " " + extraClass : "");
    popover.innerHTML = html;
    popover.hidden = false;
    if (PHONE.matches) {
      popover.style.left = "";
      popover.style.top = "";
      $("gcal-scrim").hidden = false;
      return;
    }
    const box = anchor.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    // To the right of the thing clicked, or to the left if there's no room.
    let left = box.right + 8;
    if (left + width > window.innerWidth - 8) left = box.left - width - 8;
    if (left < 8) left = Math.max(8, Math.min(window.innerWidth - width - 8, box.left));
    let top = box.top;
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
    popover.style.left = left + "px";
    popover.style.top = Math.max(8, top) + "px";
  }

  function closePopover() {
    popover.hidden = true;
    popover.innerHTML = "";
    if (ghost !== null) {
      ghost.remove();
      ghost = null;
    }
    if (!root.classList.contains("gcal-side-open")) $("gcal-scrim").hidden = true;
  }

  function findEvent(id) {
    return state.events.find((event) => String(event.id) === String(id));
  }

  const ICONS = {
    clock: '<path d="M12 7v5l3 2" /><circle cx="12" cy="12" r="9" />',
    place: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />',
    notes: '<path d="M4 6h16M4 12h16M4 18h10" />',
    music: '<path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" />',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" />',
    lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" />',
  };
  function iconRow(icon, html) {
    return '<div class="gp-row"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[icon] + "</svg><div>" + html + "</div></div>";
  }

  function showEventDetails(id, anchor) {
    const event = findEvent(id);
    if (event === undefined) return;
    const colour = colourOf(event.calendar);
    const day = event.start.slice(0, 10);

    let when = formatDay(day, { weekday: "long", day: "numeric", month: "long" });
    if (isMultiDay(event)) {
      when += " " + shortTime(event.start.slice(11, 16)) + " – " + formatDay(endDay(event), { weekday: "long", day: "numeric", month: "long" }) + " " + shortTime(event.end.slice(11, 16));
    } else {
      when += " · " + timeRange(event);
    }

    let html = '<div class="gp-tools">';
    if (IS_ADMIN) {
      html += '<a class="gcal-icon-button" href="/admin/events/' + event.id + '" title="Edit event" aria-label="Edit event"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg></a>';
      html += '<button type="button" class="gcal-icon-button" data-delete="' + event.id + '" title="Delete event" aria-label="Delete event"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></button>';
    }
    html += '<button type="button" class="gcal-icon-button" data-close title="Close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>';

    html += '<div class="gp-heading"><span class="gp-swatch" style="background:' + colour + '"></span><div>';
    html += '<h3 class="gp-title">' + escapeHtml(event.title) + "</h3>";
    html += '<p class="gp-when">' + when + "</p></div></div>";

    const place = [event.parish_name, event.location].filter(Boolean).map(escapeHtml).join(" · ");
    if (place) {
      let placeHtml = place;
      const address = event.parish_address || event.location;
      if (address) {
        placeHtml += '<br /><a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) + '" target="_blank" rel="noopener">' + escapeHtml(event.parish_address || "Map") + "</a>";
      }
      html += iconRow("place", placeHtml);
    }
    if (event.description) {
      const text = event.description.length > 280 ? event.description.slice(0, 280) + "…" : event.description;
      html += iconRow("notes", '<span class="gp-description">' + escapeHtml(text) + "</span>");
    }
    if (event.song_count > 0) {
      html += iconRow("music", event.song_count + (event.song_count === 1 ? " song" : " songs") + " on the set list");
    }
    if (event.is_public === 0) html += iconRow("lock", "Members only");
    html += iconRow("calendar", escapeHtml(calendarByKey(event.calendar).name));

    html += '<p class="gp-actions"><a class="button button-small" href="/events/' + event.id + '">Open event</a></p>';
    openPopover(html, anchor, "gp-details");
  }

  /** The "Add title" box for a new event (admins). */
  function showQuickCreate(startsAt, endsAt, anchor) {
    let parishOptions = "";
    for (const calendar of CALENDARS) {
      if (calendar.key === "other") continue;
      parishOptions += '<option value="' + calendar.parishId + '">' + escapeHtml(calendar.name) + "</option>";
    }
    let html = '<div class="gp-tools"><button type="button" class="gcal-icon-button" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>';
    html += '<form class="gp-create" id="gp-create">';
    html += '<input type="text" name="title" class="gp-title-input" placeholder="Add title" autocomplete="off" />';
    html += iconRow(
      "clock",
      '<input type="date" name="day" value="' + startsAt.slice(0, 10) + '" required />' +
        '<span class="gp-times"><input type="time" name="start" value="' + startsAt.slice(11, 16) + '" step="300" required /> – ' +
        '<input type="time" name="end" value="' + endsAt.slice(11, 16) + '" step="300" /></span>',
    );
    html += iconRow("place", '<select name="parishId"><option value="0">No parish</option>' + parishOptions + "</select>");
    html += iconRow("lock", '<label class="gp-check"><input type="checkbox" name="membersOnly" /> Members only</label>');
    html += '<p class="gp-actions"><button type="button" class="gcal-pill" data-more-options>More options</button><button type="submit" class="button button-small">Save</button></p>';
    html += "</form>";
    openPopover(html, anchor, "gp-create-box");

    // Pick the parish of the calendar that's on its own, if only one is shown.
    const shown = CALENDARS.filter((calendar) => !state.hidden.has(calendar.key) && calendar.key !== "other");
    if (shown.length === 1) popover.querySelector('[name="parishId"]').value = String(shown[0].parishId);
    if (!PHONE.matches) popover.querySelector('[name="title"]').focus();
  }

  /** Reads the "Add title" box. The end time can be past midnight (into the next day). */
  function readQuickCreate() {
    const form = $("gp-create");
    const day = form.day.value;
    const startsAt = day + "T" + form.start.value;
    let endsAt = form.end.value === "" ? "" : day + "T" + form.end.value;
    if (endsAt !== "" && endsAt <= startsAt) endsAt = addDays(day, 1) + "T" + form.end.value;
    return {
      title: form.title.value.trim(),
      startsAt: startsAt,
      endsAt: endsAt,
      parishId: Number(form.parishId.value),
      isPublic: !form.membersOnly.checked,
    };
  }

  async function saveQuickCreate() {
    const details = readQuickCreate();
    if (!/T\d\d:\d\d$/.test(details.startsAt)) return;
    closePopover();
    const response = await sendChange("POST", "/api/calendar/events", details);
    if (response === null) return;
    showToast("Event saved", { label: "Open", href: "/admin/events/" + response.event.id });
    reload();
  }

  function moreOptions() {
    const details = readQuickCreate();
    const params = new URLSearchParams({ title: details.title, startsAt: details.startsAt, endsAt: details.endsAt });
    if (details.parishId > 0) params.set("parishId", String(details.parishId));
    if (!details.isPublic) params.set("isPublic", "0");
    location.href = "/admin/events/new?" + params.toString();
  }

  /** "N more" in the month view: every event on that day. */
  function showDayEvents(day, anchor) {
    let html = '<div class="gp-tools"><button type="button" class="gcal-icon-button" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>';
    html += '<div class="gp-day"><span class="gp-day-dow">' + formatDay(day, { weekday: "short" }) + "</span>";
    html += '<button type="button" class="gp-day-num" data-goto="' + day + '">' + Number(day.slice(8)) + "</button></div>";
    html += '<div class="gp-day-events">' + eventsOn(day, shownEvents()).map((event) => monthChip(event, day)).join("") + "</div>";
    openPopover(html, anchor, "gp-more-box");
  }

  // =========================================================================
  // Saving changes (admins)
  // =========================================================================

  /** Sends a change to the server. Returns its answer, or null (after saying why) if it failed. */
  async function sendChange(method, url, body) {
    try {
      const response = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.redirected || response.status === 401 || response.status === 403) {
        showToast("Please log in as an admin to change events.");
        return null;
      }
      const data = await response.json();
      if (!response.ok) {
        showToast(data.error || "Couldn't save that.");
        return null;
      }
      return data;
    } catch (error) {
      showToast("Couldn't save that. Check your internet connection and try again.");
      return null;
    }
  }

  /** Moves an event to new times, with "Undo" on the message. */
  async function moveEvent(event, startsAt, endsAt, message) {
    const before = { startsAt: event.starts_at, endsAt: event.ends_at || "" };
    // Show it in its new place straight away, then save.
    Object.assign(event, prepare(Object.assign({}, event, { starts_at: startsAt, ends_at: endsAt || null })));
    render();
    const saved = await sendChange("PATCH", "/api/calendar/events/" + event.id, { startsAt: startsAt, endsAt: endsAt });
    if (saved === null) {
      reload();
      return;
    }
    cache.clear();
    showToast(message, {
      label: "Undo",
      action: async () => {
        await sendChange("PATCH", "/api/calendar/events/" + event.id, before);
        reload();
      },
    });
  }

  async function deleteEventNow(id) {
    const event = findEvent(id);
    if (event === undefined) return;
    if (!confirm('Delete "' + event.title + '"? Its set list and roster will be deleted too.')) return;
    closePopover();
    if ((await sendChange("DELETE", "/api/calendar/events/" + id)) === null) return;
    showToast("Event deleted");
    reload();
  }

  // =========================================================================
  // The message at the bottom ("Event saved  Undo")
  // =========================================================================

  let toastTimer = 0;
  function showToast(message, button) {
    const toast = $("gcal-toast");
    toast.innerHTML = "<span>" + escapeHtml(message) + "</span>";
    if (button) {
      const link = document.createElement(button.href ? "a" : "button");
      link.className = "gcal-toast-button";
      link.textContent = button.label;
      if (button.href) link.href = button.href;
      else {
        link.type = "button";
        link.onclick = () => {
          toast.hidden = true;
          button.action();
        };
      }
      toast.appendChild(link);
    }
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 6000);
  }

  // =========================================================================
  // Dragging (admins): move events, stretch them, or drag out a new one
  // =========================================================================

  let drag = null;
  let justDragged = false; // stops the click that follows a drag from opening a pop-up

  /** Which day column (Day/Week) or day cell (Month) is under the pointer. */
  function dayUnder(x, y, selector) {
    const element = document.elementFromPoint(x, y);
    const target = element && element.closest(selector);
    return target ? target : null;
  }

  /** Minutes after midnight at a height in a day column, rounded to 15 minutes. */
  function minutesAt(column, y) {
    const offset = y - column.getBoundingClientRect().top;
    const minutes = Math.round(((offset / HOUR_HEIGHT) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.min(Math.max(minutes, 0), 1440 - SNAP_MINUTES);
  }

  function startDrag(pointerEvent) {
    if (!IS_ADMIN || pointerEvent.button !== 0) return;
    // On touch screens a finger drag scrolls the page; tap events to change them instead.
    if (pointerEvent.pointerType === "touch") return;
    const target = pointerEvent.target;

    const resize = target.closest("[data-resize]");
    const timed = target.closest(".gt-event");
    const chip = target.closest(".gm-cell .gcal-chip");
    const column = target.closest(".gt-col");

    if (resize) drag = { kind: "resize", event: findEvent(resize.dataset.resize), element: resize.parentElement };
    else if (timed) drag = { kind: "move", event: findEvent(timed.dataset.event), element: timed };
    else if (chip) drag = { kind: "move-day", event: findEvent(chip.dataset.event), element: chip };
    else if (column) drag = { kind: "create", column: column };
    else return;

    drag.x = pointerEvent.clientX;
    drag.y = pointerEvent.clientY;
    drag.started = false;
    if (drag.kind === "move") {
      // Where on the event it was grabbed, so it doesn't jump.
      drag.grabOffset = minutesAt(drag.element.parentElement, pointerEvent.clientY) - minutesOf(drag.event.start.slice(11, 16));
    }
    if (drag.kind === "create") drag.from = minutesAt(column, pointerEvent.clientY);
  }

  function moveDrag(pointerEvent) {
    if (drag === null) return;
    if (!drag.started) {
      if (Math.abs(pointerEvent.clientX - drag.x) + Math.abs(pointerEvent.clientY - drag.y) < 5) return;
      drag.started = true;
      closePopover();
      root.classList.add("gcal-dragging");
      if (drag.element) drag.element.classList.add("gcal-lifted");
    }
    pointerEvent.preventDefault();

    if (drag.kind === "resize") {
      const column = drag.element.parentElement;
      const startMinutes = minutesOf(drag.event.start.slice(11, 16));
      const endMinutes = Math.max(minutesAt(column, pointerEvent.clientY), startMinutes + SNAP_MINUTES);
      drag.endMinutes = Math.min(endMinutes, 1440);
      drag.element.style.height = ((drag.endMinutes - startMinutes) / 60) * HOUR_HEIGHT - 2 + "px";
      setDragLabel(drag.element, timeOf(startMinutes), timeOf(drag.endMinutes));
    } else if (drag.kind === "move") {
      const column = dayUnder(pointerEvent.clientX, pointerEvent.clientY, ".gt-col") || drag.element.parentElement;
      const length = Math.max(minutesBetween(drag.event.start, drag.event.end), SNAP_MINUTES);
      let start = minutesAt(column, pointerEvent.clientY) - drag.grabOffset;
      start = Math.min(Math.max(start, 0), 1440 - SNAP_MINUTES);
      drag.day = column.dataset.date;
      drag.startMinutes = start;
      if (drag.element.parentElement !== column) column.appendChild(drag.element);
      drag.element.style.top = (start / 60) * HOUR_HEIGHT + "px";
      drag.element.style.left = "1px";
      drag.element.style.width = "calc(100% - 4px)";
      setDragLabel(drag.element, timeOf(start), timeOf(Math.min(start + length, 1439)));
    } else if (drag.kind === "move-day") {
      const cell = dayUnder(pointerEvent.clientX, pointerEvent.clientY, ".gm-cell");
      for (const old of document.querySelectorAll(".gm-drop")) old.classList.remove("gm-drop");
      if (cell) {
        cell.classList.add("gm-drop");
        drag.day = cell.dataset.date;
      }
    } else if (drag.kind === "create") {
      const at = minutesAt(drag.column, pointerEvent.clientY);
      drag.startMinutes = Math.min(drag.from, at);
      drag.endMinutes = Math.max(drag.from, at) + (at >= drag.from ? SNAP_MINUTES : 0);
      drawGhost(drag.column, drag.startMinutes, drag.endMinutes);
    }
  }

  function setDragLabel(element, start, end) {
    const label = element.querySelector(".gt-event-time");
    if (label) label.textContent = shortTime(start) + " – " + shortTime(end);
  }

  function drawGhost(column, startMinutes, endMinutes) {
    if (ghost === null) {
      ghost = document.createElement("div");
      ghost.className = "gt-event gt-ghost";
    }
    if (ghost.parentElement !== column) column.appendChild(ghost);
    ghost.style.top = (startMinutes / 60) * HOUR_HEIGHT + "px";
    ghost.style.height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT - 2, 10) + "px";
    ghost.innerHTML = '<span class="gt-event-title">(No title)</span><span class="gt-event-time">' + shortTime(timeOf(startMinutes)) + " – " + shortTime(timeOf(Math.min(endMinutes, 1439))) + "</span>";
  }

  function endDrag() {
    if (drag === null) return;
    const finished = drag;
    drag = null;
    root.classList.remove("gcal-dragging");
    for (const old of document.querySelectorAll(".gm-drop")) old.classList.remove("gm-drop");
    if (!finished.started) return; // just a click; the click handler deals with it

    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    const event = finished.event;

    if (finished.kind === "resize") {
      const endsAt = event.start.slice(0, 10) + "T" + timeOf(Math.min(finished.endMinutes, 1439));
      moveEvent(event, event.starts_at, finished.endMinutes >= 1440 ? addDays(event.start.slice(0, 10), 1) + "T00:00" : endsAt, "Event updated");
    } else if (finished.kind === "move" && finished.day) {
      const startsAt = finished.day + "T" + timeOf(finished.startMinutes);
      if (startsAt === event.starts_at) return render();
      // Keep the same length (and keep "no end time" if it had none).
      const endsAt = event.ends_at ? addMinutes(startsAt, minutesBetween(event.starts_at, event.ends_at)) : "";
      moveEvent(event, startsAt, endsAt, "Event moved");
    } else if (finished.kind === "move-day" && finished.day) {
      const shift = daysBetween(event.start.slice(0, 10), finished.day);
      if (shift === 0) return render();
      const startsAt = addDays(event.starts_at.slice(0, 10), shift) + event.starts_at.slice(10);
      const endsAt = event.ends_at ? addDays(event.ends_at.slice(0, 10), shift) + event.ends_at.slice(10) : "";
      moveEvent(event, startsAt, endsAt, "Event moved");
    } else if (finished.kind === "create") {
      const day = finished.column.dataset.date;
      const end = finished.endMinutes >= 1440 ? addDays(day, 1) + "T00:00" : day + "T" + timeOf(finished.endMinutes);
      showQuickCreate(day + "T" + timeOf(finished.startMinutes), end, ghost);
    } else {
      render();
    }
  }

  // =========================================================================
  // Clicks
  // =========================================================================

  function handleClick(clickEvent) {
    if (justDragged) return;
    const target = clickEvent.target;
    const inPopover = popover.contains(target);

    const close = target.closest("[data-close]");
    if (close) return closePopover();

    const goto = target.closest("[data-goto]");
    if (goto) {
      closePopover();
      state.view = "day";
      save("calendarView", "day");
      return goTo(goto.dataset.goto);
    }

    const eventElement = target.closest("[data-event]");
    if (eventElement) return showEventDetails(eventElement.dataset.event, eventElement);

    const more = target.closest("[data-more]");
    if (more) return showDayEvents(more.dataset.more, more);

    const del = target.closest("[data-delete]");
    if (del) return deleteEventNow(del.dataset.delete);

    if (target.closest("[data-more-options]")) return moreOptions();

    if (inPopover) return;

    // A click on an empty part of the calendar.
    if (!popover.hidden) return closePopover();
    if (!IS_ADMIN) return;

    const column = target.closest(".gt-col");
    if (column) {
      // Day/Week: a one-hour event from the half hour clicked.
      const top = column.getBoundingClientRect().top;
      const start = Math.min(Math.floor(((clickEvent.clientY - top) / HOUR_HEIGHT) * 2) * 30, 1410);
      drawGhost(column, start, start + 60);
      const day = column.dataset.date;
      const end = start + 60 >= 1440 ? addDays(day, 1) + "T00:00" : day + "T" + timeOf(start + 60);
      return showQuickCreate(day + "T" + timeOf(start), end, ghost);
    }
    const cell = target.closest(".gm-cell");
    if (cell) return showQuickCreate(cell.dataset.date + "T10:00", cell.dataset.date + "T11:00", cell);
  }

  /** The "Create" button and the round "+" on phones: a new event for the day being shown. */
  function createButton(anchor) {
    const [from, to] = visibleRange();
    const day = TODAY >= from && TODAY < to ? TODAY : state.date;
    showQuickCreate(day + "T10:00", day + "T11:00", anchor);
  }

  // ---- The view menu ("Month ▾") ----

  function closeMenus() {
    $("gcal-view-list").hidden = true;
    $("gcal-view-button").setAttribute("aria-expanded", "false");
    const options = document.querySelector(".gcal-options-menu");
    if (options) options.remove();
  }

  /** The "⋮" menu next to a calendar: "Display this only", and its colour. */
  function showCalendarOptions(key, anchor) {
    closeMenus();
    const menu = document.createElement("div");
    menu.className = "gcal-options-menu";
    let html = '<button type="button" class="gcal-menu-item" data-only="' + key + '">Display this only</button>';
    html += '<div class="gcal-swatches">';
    for (const colour of COLOURS) {
      const chosen = colourOf(key) === colour.value;
      html += '<button type="button" data-colour="' + colour.value + '" data-for="' + key + '" title="' + colour.name + '" aria-label="' + colour.name + '" style="background:' + colour.value + '"' + (chosen ? ' class="chosen"' : "") + "></button>";
    }
    html += "</div>";
    menu.innerHTML = html;
    document.body.appendChild(menu);
    const box = anchor.getBoundingClientRect();
    menu.style.left = Math.min(box.left, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = Math.min(box.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + "px";
    menu.addEventListener("click", (clickEvent) => {
      const only = clickEvent.target.closest("[data-only]");
      const swatch = clickEvent.target.closest("[data-colour]");
      if (only) {
        state.hidden = new Set(CALENDARS.map((calendar) => calendar.key).filter((other) => other !== key));
        save("calendarHidden", Array.from(state.hidden));
      } else if (swatch) {
        state.colours[swatch.dataset.for] = swatch.dataset.colour;
        save("calendarColours", state.colours);
      } else {
        return;
      }
      menu.remove();
      render();
    });
  }

  // ---- Side panel (a drawer on phones) ----

  function toggleSidePanel() {
    if (PHONE.matches) {
      const open = !root.classList.contains("gcal-side-open");
      root.classList.toggle("gcal-side-open", open);
      $("gcal-scrim").hidden = !open;
    } else {
      root.classList.toggle("gcal-side-closed");
      save("calendarSideClosed", root.classList.contains("gcal-side-closed"));
      if (state.view === "month") render(); // the grid gets wider, so more events fit
    }
  }

  // =========================================================================
  // Wiring it all up
  // =========================================================================

  function setUp() {
    // The calendar fills the window under the site's menu bar.
    const fitToWindow = () => {
      const header = document.querySelector(".site-header");
      root.style.setProperty("--gcal-top", (header ? header.offsetHeight : 0) + "px");
    };
    fitToWindow();

    // Saved choices from last time.
    state.colours = readSaved("calendarColours", {});
    state.hidden = new Set(readSaved("calendarHidden", []));
    if (readSaved("calendarSideClosed", false)) root.classList.add("gcal-side-closed");

    // ?parish=3 in the address: show that parish only (just this once).
    const parish = root.dataset.parish;
    if (parish) state.hidden = new Set(CALENDARS.map((calendar) => calendar.key).filter((key) => key !== "p" + parish));

    // Which view: from the address, or the last one used, or Month (Schedule on phones).
    const savedView = readSaved("calendarView", "");
    state.view = root.dataset.view || (VIEW_NAMES[savedView] ? savedView : PHONE.matches ? "schedule" : "month");
    state.date = root.dataset.date || TODAY;
    state.miniMonth = state.date.slice(0, 7);

    $("gcal-today").addEventListener("click", () => goTo(TODAY));
    $("gcal-prev").addEventListener("click", () => step(-1));
    $("gcal-next").addEventListener("click", () => step(1));
    $("gcal-menu").addEventListener("click", toggleSidePanel);
    $("gcal-scrim").addEventListener("click", () => {
      root.classList.remove("gcal-side-open");
      closePopover();
      $("gcal-scrim").hidden = true;
    });

    $("gcal-view-button").addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation();
      const list = $("gcal-view-list");
      list.hidden = !list.hidden;
      $("gcal-view-button").setAttribute("aria-expanded", String(!list.hidden));
    });
    $("gcal-view-list").addEventListener("click", (clickEvent) => {
      const item = clickEvent.target.closest("[data-view]");
      if (item) setView(item.dataset.view);
    });

    $("gcal-mini").addEventListener("click", (clickEvent) => {
      const pick = clickEvent.target.closest("[data-pick]");
      const turn = clickEvent.target.closest("[data-mini]");
      if (pick) {
        goTo(pick.dataset.pick);
        if (PHONE.matches) toggleSidePanel();
      } else if (turn) {
        state.miniMonth = addMonths(state.miniMonth + "-01", Number(turn.dataset.mini)).slice(0, 7);
        drawMiniMonth();
      }
    });

    $("gcal-calendar-list").addEventListener("change", (changeEvent) => {
      const key = changeEvent.target.dataset.calendar;
      if (!key) return;
      if (changeEvent.target.checked) state.hidden.delete(key);
      else state.hidden.add(key);
      save("calendarHidden", Array.from(state.hidden));
      render();
    });
    $("gcal-calendar-list").addEventListener("click", (clickEvent) => {
      const options = clickEvent.target.closest("[data-options]");
      if (options) {
        clickEvent.stopPropagation();
        showCalendarOptions(options.dataset.options, options);
      }
    });

    if (IS_ADMIN) {
      $("gcal-create").addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        createButton($("gcal-create"));
      });
      $("gcal-fab").addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        createButton($("gcal-fab"));
      });
    }

    const main = $("gcal-main");
    main.addEventListener("click", handleClick);
    popover.addEventListener("click", handleClick);
    popover.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      saveQuickCreate();
    });
    main.addEventListener("click", (clickEvent) => {
      if (clickEvent.target.closest("#gs-more")) {
        state.scheduleDays += 62;
        load();
      }
    });
    main.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter" && keyEvent.target.matches("[data-event]")) showEventDetails(keyEvent.target.dataset.event, keyEvent.target);
    });

    main.addEventListener("pointerdown", startDrag);
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", () => {
      drag = null;
      root.classList.remove("gcal-dragging");
      render();
    });

    // Clicking anywhere else closes menus and pop-ups.
    document.addEventListener("click", (clickEvent) => {
      if (!clickEvent.target.closest(".gcal-view-menu, .gcal-options-menu")) closeMenus();
      if (!popover.hidden && !popover.contains(clickEvent.target) && !main.contains(clickEvent.target) && !clickEvent.target.closest(".gcal-create, .gcal-fab")) {
        closePopover();
      }
    });

    // Swipe left or right on a phone for the next or previous day, week or month.
    let touchStart = null;
    main.addEventListener("touchstart", (touchEvent) => {
      touchStart = touchEvent.touches.length === 1 ? { x: touchEvent.touches[0].clientX, y: touchEvent.touches[0].clientY } : null;
    }, { passive: true });
    main.addEventListener("touchend", (touchEvent) => {
      if (touchStart === null || state.view === "schedule") return;
      const dx = touchEvent.changedTouches[0].clientX - touchStart.x;
      const dy = touchEvent.changedTouches[0].clientY - touchStart.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
      touchStart = null;
    }, { passive: true });

    // Keyboard shortcuts, the same as Google Calendar's.
    document.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.target.closest("input, textarea, select") || keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey) return;
      const key = keyEvent.key.toLowerCase();
      if (key === "escape") return closePopover(), closeMenus();
      if (key === "t") goTo(TODAY);
      else if (key === "d") setView("day");
      else if (key === "w") setView("week");
      else if (key === "m") setView("month");
      else if (key === "a") setView("schedule");
      else if (key === "j" || key === "n") step(1);
      else if (key === "k" || key === "p") step(-1);
      else if (key === "c" && IS_ADMIN) createButton($("gcal-create"));
      else return;
      keyEvent.preventDefault();
    });

    // Redraw when the window changes size (the month grid fits a different number of events).
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitToWindow();
        if (!PHONE.matches) root.classList.remove("gcal-side-open");
        if (state.view === "month") render();
      }, 150);
    });

    load();
  }

  setUp();
})();
