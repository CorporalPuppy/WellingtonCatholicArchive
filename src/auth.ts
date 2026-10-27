// ===========================================================================
// Logins, using the Better Auth library.
//
// Better Auth looks after the hard parts of logging in: checking passwords,
// creating sessions (the "you are logged in" cookie) and storing users.
// It keeps its data in four tables in our D1 database: user, session,
// account and verification (see migrations/0001_auth.sql).
// ===========================================================================

import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { hashPassword, verifyPassword } from "./password";
import type { Env } from "./types";

/**
 * Sets up Better Auth for one request.
 * (On Workers the database connection comes with each request, so we
 * build this each time. It is quick.)
 */
export function createAuth(env: Env) {
  return betterAuth({
    // Our D1 database. Better Auth knows how to talk to it directly.
    database: env.DB,

    // A long random secret used to sign the login cookies.
    // It is set with `npx wrangler secret put BETTER_AUTH_SECRET`.
    secret: env.BETTER_AUTH_SECRET,

    // The site's address, e.g. https://example.org
    baseURL: env.BETTER_AUTH_URL,

    emailAndPassword: {
      enabled: true,
      // Nobody can make their own account: an admin creates every account.
      disableSignUp: true,
      minPasswordLength: 10,
      // Use our own password hashing (see password.ts for why).
      password: { hash: hashPassword, verify: verifyPassword },
    },

    session: {
      // Stay logged in for 30 days.
      expiresIn: 60 * 60 * 24 * 30,
    },

    // The admin plugin adds a "role" to each user: "admin" or "user"
    // ("user" is shown on the site as "Member"),
    // and gives admins the power to create and remove users.
    plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
  });
}

// Handy type names, used elsewhere in the code.
export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth["$Infer"]["Session"]["user"];
