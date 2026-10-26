// ===========================================================================
// Sending a file from R2 storage to the browser.
// Used by the music library and the PowerPoint archive.
// ===========================================================================

import type { Context } from "hono";
import type { AppEnv } from "./types";

/**
 * Reads a file from R2 and sends it to the browser.
 *
 * Add ?download=1 to the address to save the file instead of opening it.
 *
 * Audio players ask for small pieces of a file at a time (so you can skip
 * ahead). These are called "range requests", and R2 handles them for us.
 */
export async function sendFileFromStorage(
  c: Context<AppEnv>,
  r2Key: string,
  filename: string,
  contentType: string,
): Promise<Response> {
  // Passing the request headers lets R2 read any "Range" the browser asked for.
  const object = await c.env.MUSIC.get(r2Key, { range: c.req.raw.headers });
  if (object === null) {
    return c.text("File not found in storage", 404);
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");

  // "attachment" = save the file, "inline" = show it in the browser.
  const disposition = c.req.query("download") ? "attachment" : "inline";
  headers.set("Content-Disposition", disposition + "; filename*=UTF-8''" + encodeURIComponent(filename));

  // Members-only files must not be stored by shared caches.
  if (c.env.EVERYTHING_PUBLIC === "yes") {
    headers.set("Cache-Control", "public, max-age=3600");
  } else {
    headers.set("Cache-Control", "private, max-age=3600");
  }

  // If only part of the file was asked for, say which part we're sending.
  const askedForRange = c.req.header("Range") !== undefined;
  if (askedForRange && object.range) {
    const range = object.range as { offset?: number; length?: number; suffix?: number };
    let start = 0;
    let length = object.size;
    if (range.suffix !== undefined) {
      start = object.size - range.suffix;
      length = range.suffix;
    } else {
      start = range.offset ?? 0;
      length = range.length ?? object.size - start;
    }
    const end = start + length - 1;
    headers.set("Content-Range", "bytes " + start + "-" + end + "/" + object.size);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers: headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers: headers });
}

/**
 * Makes a safe, unique name for a new file in R2, like
 * "powerpoints/3f2a...-easter-sunday.pptx".
 * The random part stops two files with the same name clashing.
 */
export function makeStorageKey(folder: string, originalName: string): string {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return folder + "/" + crypto.randomUUID() + "-" + safeName;
}
