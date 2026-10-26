import type { Auth, SessionUser } from "./auth";

export type Env = {
  DB: D1Database;
  MUSIC: R2Bucket;
  ASSETS: Fetcher;
  CHURCH_NAME: string;
  EVERYTHING_PUBLIC: "yes" | "no";
  TIMEZONE: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  SETUP_TOKEN?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    auth: Auth;
    user: SessionUser | null;
  };
};

export type EventRow = {
  id: number;
  title: string;
  description: string;
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
};

export type SongFileRow = {
  id: number;
  song_id: number;
  kind: "recording" | "sheet" | "chords" | "other";
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
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
  song_key: string;
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
