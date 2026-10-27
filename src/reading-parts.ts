// The parts of each day's readings, in the order they are read at Mass.
// Both the Readings page and the admin form go through this list, so to
// add, remove or rename a part you only change it here (and in the
// daily_readings table).

import type { ReadingsRow } from "./types";

export type ReadingPart = {
  heading: string; //                          shown above the reading
  referenceField: keyof ReadingsRow; //        column holding e.g. "Luke 13:10-17"
  textField: keyof ReadingsRow; //             column holding the full text
  hint: string; //                             example shown in the admin form
  universalisName: string; //                  this part's name in the Universalis feed
};

export const READING_PARTS: ReadingPart[] = [
  {
    heading: "Reading 1",
    referenceField: "first_reading",
    textField: "first_reading_text",
    hint: "e.g. Ephesians 4:32-5:8",
    universalisName: "Mass_R1",
  },
  {
    heading: "Responsorial Psalm",
    referenceField: "psalm",
    textField: "psalm_text",
    hint: "e.g. Psalm 1:1-2, 3, 4 and 6",
    universalisName: "Mass_Ps",
  },
  {
    heading: "Reading 2",
    referenceField: "second_reading",
    textField: "second_reading_text",
    hint: "Sundays and big feasts only",
    universalisName: "Mass_R2",
  },
  {
    heading: "Alleluia",
    referenceField: "alleluia",
    textField: "alleluia_text",
    hint: "e.g. John 17:17b, 17a",
    universalisName: "Mass_GA",
  },
  {
    heading: "Gospel",
    referenceField: "gospel",
    textField: "gospel_text",
    hint: "e.g. Luke 13:10-17",
    universalisName: "Mass_G",
  },
];
