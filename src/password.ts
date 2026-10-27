// Password hashing with the Workers' built-in Web Crypto (PBKDF2).
// Better Auth's default (scrypt in plain JavaScript) goes over the
// free plan's 10 ms CPU limit per request, so we swap it for this.
//
// ITERATIONS is how many times the password is scrambled. More is safer
// but slower: 100,000 took about 50 ms, far over the free plan's 10 ms,
// so logging in could fail with Cloudflare "error 1102". 10,000 takes
// about 5 ms. Each saved password remembers its own count, so passwords
// made with the old count still work (see verifyPassword).

const ITERATIONS = 10_000;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [scheme, iter, salt, expected] = hash.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !expected) return false;
  const actual = await derive(password, fromB64(salt), Number(iter));
  const want = fromB64(expected);
  if (actual.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ want[i];
  return diff === 0;
}
