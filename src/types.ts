import type { Auth, SessionUser } from "./auth";

export type Env = {
  DB: D1Database;
  MUSIC: R2Bucket;
  ASSETS: Fetcher;
  CHOIR_NAME: string;
  EVERYTHING_PUBLIC: "yes" | "no";
  TIMEZONE: string;
  UNIVERSALIS_CALENDAR: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  SETUP_TOKEN?: string;
  IMPORT_TOKEN?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    auth: Auth;
    user: SessionUser | null;
  };
};

export type ParishRow = {
  id: number;
  name: string;
  address: string;
  notes: string;
};

export type EventRow = {
  id: number;
  title: string;
  description: string;
  parish_id: number | null;
  parish_name: string | null; //    filled in from the parishes table
  parish_address: string | null; // filled in from the parishes table
  location: string;
  starts_at: string;
  ends_at: string | null;
  is_public: number;
};

export type SongRow = {
  id: number;
  title: string;
  author: string;
  song_key: string;
  ccli_number: string;
  notes: string;
  youtube_url: string;
  sheet_music_url: string;
  section: "music" | "prayers"; // "prayers" = Prayers and services
};

export type SongFileRow = {
  id: number;
  song_id: number;
  kind: "sheet" | "chords" | "musescore" | "lyrics" | "slides" | "recording" | "other";
  music_key: string; // e.g. "D" or "Am" ("" = not known)
  version: string; //   e.g. "with intro", "Page 2", "Sacred Heart style" ("" = none)
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
  source_path: string; // where the bulk import found it ("" = uploaded on the website)
  source_hash: string; // fingerprint of the imported file, to spot edits ("" = not known)
  uploaded_at: string;
};

export type RosterRow = {
  id: number;
  event_id: number;
  role: string;
  person_name: string;
  notes: string;
};

export type SetlistRow = {
  id: number;
  event_id: number;
  song_id: number;
  position: number;
  notes: string;
  title: string;
  author: string;
  song_key: string;
  youtube_url: string;
  sheet_music_url: string;
  section: "music" | "prayers";
};

export type PowerpointRow = {
  id: number;
  title: string;
  service_date: string;
  notes: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_at: string;
  event_id: number | null; // the event it was made for (null = matched by date only)
  event_title: string | null; // filled in from the events table
  source_path: string; // where the bulk import found it ("" if uploaded by hand)
  source_hash: string; // its fingerprint when imported
  church: string; // the church it was made for ("" if not known)
  text_hash: string; // fingerprint of the words on its slides (the words themselves aren't loaded)
  snippet?: string; // search results only: words from the slides around the match
};

export type ReadingsRow = {
  reading_date: string;
  day_name: string;
  lectionary_number: string;
  first_reading: string;
  first_reading_text: string;
  psalm: string;
  psalm_text: string;
  second_reading: string;
  second_reading_text: string;
  alleluia: string;
  alleluia_text: string;
  gospel: string;
  gospel_text: string;
  notes: string;
};
