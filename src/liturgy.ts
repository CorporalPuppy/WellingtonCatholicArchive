// ===========================================================================
// Occasions: the Sundays, feasts and other days a PowerPoint is made for,
// such as "15th Sunday in Ordinary Time" or "Easter Sunday".
//
// A PowerPoint is filed under its occasion and Year (A, B or C) instead of
// a date, so it shows up again on the right Sunday every three years. The
// names here must match the ones tools/import_slides.py writes (it builds
// the same list in OCCASIONS).
//
// The calendar is the one kept in New Zealand: the Epiphany and the
// Ascension are on Sundays (the Ascension on the 7th Sunday of Easter), and
// the Body and Blood of Christ is on the Sunday after Trinity Sunday.
// ===========================================================================

import { addDays, easterSunday, firstSundayOfAdvent, liturgicalYear } from "./helpers";

/** "1st", "2nd", "3rd", "4th", ... "21st", "22nd". */
export function ordinal(number: number): string {
  const lastTwo = number % 100;
  const last = number % 10;
  if (lastTwo >= 11 && lastTwo <= 13) return number + "th";
  if (last === 1) return number + "st";
  if (last === 2) return number + "nd";
  if (last === 3) return number + "rd";
  return number + "th";
}

/** The groups on the PowerPoints page, in order. */
export const OCCASION_GROUPS = ["Advent", "Christmas", "Lent", "Easter", "Ordinary Time", "Feasts and saints"] as const;
export type OccasionGroup = (typeof OCCASION_GROUPS)[number];

function numbered(count: number, from: number, name: (n: string) => string): string[] {
  const names: string[] = [];
  for (let n = from; n <= count; n++) names.push(name(ordinal(n)));
  return names;
}

/** Every occasion, in the Church's order, by group. */
export const OCCASIONS: Record<OccasionGroup, string[]> = {
  Advent: [
    ...numbered(4, 1, (n) => n + " Sunday of Advent"),
    ...numbered(9, 1, (n) => n + " Day of Simbang Gabi"),
    ...numbered(9, 1, (n) => n + " Day of the Christmas Novena"),
  ],
  Christmas: ["Christmas Day", "Holy Family", "Mary, Mother of God", "Epiphany of the Lord", "Baptism of the Lord"],
  Lent: [
    "Ash Wednesday",
    ...numbered(5, 1, (n) => n + " Sunday of Lent"),
    "Palm Sunday",
    "Holy Thursday",
    "Good Friday",
  ],
  Easter: ["Easter Vigil", "Easter Sunday", ...numbered(6, 2, (n) => n + " Sunday of Easter"), "Ascension of the Lord", "Pentecost Sunday"],
  "Ordinary Time": [
    "Trinity Sunday",
    "Body and Blood of Christ",
    "Sacred Heart of Jesus",
    ...numbered(33, 2, (n) => n + " Sunday in Ordinary Time"),
    "Christ the King",
  ],
  "Feasts and saints": [
    "St Pedro Calungsod",
    "Saints Peter and Paul",
    "Assumption of Mary",
    "Exaltation of the Holy Cross",
    "St Therese of Lisieux",
    "All Saints",
    "All Souls",
    "Dedication of the Lateran Basilica",
  ],
};

/** The group an occasion belongs to, or null if it isn't one of OCCASIONS. */
export function occasionGroup(occasion: string): OccasionGroup | null {
  for (const group of OCCASION_GROUPS) {
    if (OCCASIONS[group].includes(occasion)) return group;
  }
  return null;
}

/** Where an occasion comes in the Church's year, for sorting (unknown ones last). */
export function occasionOrder(occasion: string): number {
  let position = 0;
  for (const group of OCCASION_GROUPS) {
    const index = OCCASIONS[group].indexOf(occasion);
    if (index >= 0) return position + index;
    position += OCCASIONS[group].length;
  }
  return position;
}

// Feasts on a set day each year, "MM-DD".
const SET_DAYS: Record<string, string> = {
  "01-01": "Mary, Mother of God",
  "04-02": "St Pedro Calungsod",
  "06-29": "Saints Peter and Paul",
  "08-15": "Assumption of Mary",
  "09-14": "Exaltation of the Holy Cross",
  "10-01": "St Therese of Lisieux",
  "11-01": "All Saints",
  "11-02": "All Souls",
  "11-09": "Dedication of the Lateran Basilica",
  "12-25": "Christmas Day",
};

/**
 * The occasions that fall on a date ("YYYY-MM-DD"), most important first.
 * Usually one (a Sunday), sometimes two (a feast on a Sunday, or Simbang
 * Gabi and the Christmas novena), or none (an ordinary weekday).
 */
export function occasionsOn(date: string): string[] {
  const year = Number(date.slice(0, 4));
  const found: string[] = [];
  const isSunday = new Date(date + "T00:00:00Z").getUTCDay() === 0;
  const easter = easterSunday(year);
  const daysFromEaster = Math.round((Date.parse(date) - Date.parse(easter)) / 86_400_000);

  // Moveable days, counted from Easter.
  const fromEaster: Record<number, string> = {
    [-46]: "Ash Wednesday",
    [-7]: "Palm Sunday",
    [-3]: "Holy Thursday",
    [-2]: "Good Friday",
    [-1]: "Easter Vigil",
    0: "Easter Sunday",
    42: "Ascension of the Lord",
    49: "Pentecost Sunday",
    56: "Trinity Sunday",
    63: "Body and Blood of Christ",
    68: "Sacred Heart of Jesus",
  };
  if (fromEaster[daysFromEaster] !== undefined) found.push(fromEaster[daysFromEaster]);
  if (isSunday && daysFromEaster >= -42 && daysFromEaster <= -14) found.push(ordinal(7 + daysFromEaster / 7) + " Sunday of Lent");
  if (isSunday && daysFromEaster >= 7 && daysFromEaster <= 35) found.push(ordinal(1 + daysFromEaster / 7) + " Sunday of Easter");

  // Advent, Christmas and the start of the year.
  const advent = firstSundayOfAdvent(year);
  if (isSunday && date >= advent && date < year + "-12-25") {
    const weeks = Math.round((Date.parse(date) - Date.parse(advent)) / (7 * 86_400_000));
    found.push(ordinal(weeks + 1) + " Sunday of Advent");
  }
  const day = Number(date.slice(8, 10));
  if (date.slice(5, 7) === "12" && day >= 16 && day <= 24) {
    found.push(ordinal(day - 15) + " Day of Simbang Gabi", ordinal(day - 15) + " Day of the Christmas Novena");
  }
  if (date === holyFamily(year)) found.push("Holy Family");
  const epiphany = epiphanyOf(year);
  const baptism = baptismOf(year);
  if (date === epiphany) found.push("Epiphany of the Lord");
  if (date === baptism) found.push("Baptism of the Lord");

  // Ordinary Time Sundays: counted on from the Baptism of the Lord until
  // Lent, and back from Christ the King (the 34th) after Pentecost.
  const christTheKing = addDays(firstSundayOfAdvent(year), -7);
  if (isSunday && date === christTheKing) {
    found.push("Christ the King");
  } else if (isSunday && found.length === 0) {
    if (date > baptism && daysFromEaster < -46) {
      const firstSunday = addDays(baptism, 7 - new Date(baptism + "T00:00:00Z").getUTCDay());
      const weeks = Math.round((Date.parse(date) - Date.parse(firstSunday)) / (7 * 86_400_000));
      found.push(ordinal(weeks + 2) + " Sunday in Ordinary Time");
    } else if (daysFromEaster > 63 && date < christTheKing) {
      const weeks = Math.round((Date.parse(christTheKing) - Date.parse(date)) / (7 * 86_400_000));
      found.push(ordinal(34 - weeks) + " Sunday in Ordinary Time");
    }
  }

  // Feasts on a set day.
  const setDay = SET_DAYS[date.slice(5)];
  if (setDay !== undefined && !found.includes(setDay)) found.push(setDay);
  return found;
}

/** The Year (A, B or C) and occasions of a date, for matching PowerPoints to an event. */
export function cycleAndOccasionsOn(date: string): { cycle: "A" | "B" | "C"; occasions: string[] } {
  return { cycle: liturgicalYear(date).cycle, occasions: occasionsOn(date) };
}

/** In New Zealand, the Epiphany is the Sunday between 2 and 8 January. */
function epiphanyOf(year: number): string {
  const weekday = new Date(Date.UTC(year, 0, 2)).getUTCDay();
  return addDays(year + "-01-02", (7 - weekday) % 7);
}

/** The Sunday after the Epiphany, or the Monday if the Epiphany is on 7 or 8 January. */
function baptismOf(year: number): string {
  const epiphany = epiphanyOf(year);
  return Number(epiphany.slice(8, 10)) >= 7 ? addDays(epiphany, 1) : addDays(epiphany, 7);
}

/** The Sunday between Christmas and New Year, or 30 December if there isn't one. */
function holyFamily(year: number): string {
  for (let day = 26; day <= 31; day++) {
    const date = year + "-12-" + day;
    if (new Date(date + "T00:00:00Z").getUTCDay() === 0) return date;
  }
  return year + "-12-30";
}
