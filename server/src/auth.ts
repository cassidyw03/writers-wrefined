import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { fromNodeHeaders } from "better-auth/node";
import type { RequestHandler } from "express";
import type { Db } from "./db/client.js";
import { accounts, sessions, users, verifications } from "./db/schema.js";

// Email and password sign-in through Better Auth. No email verification yet.
// BETTER_AUTH_SECRET signs the session cookies and must be set in production;
// BETTER_AUTH_URL is the public URL of the site (the browser reaches the API through it).
export function createAuth(db: Db) {
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: process.env.CLIENT_ORIGIN ? [process.env.CLIENT_ORIGIN] : [],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    advanced: { database: { generateId: "uuid" } },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export type SessionUser = { id: string; email: string; name: string };

declare module "express-serve-static-core" {
  interface Locals {
    user: SessionUser;
  }
}

// Rejects requests without a valid session and puts the signed-in user on res.locals.user.
export function requireUser(auth: Auth): RequestHandler {
  return async (req, res, next) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      res.status(401).json({ error: "Please log in." });
      return;
    }
    res.locals.user = { id: session.user.id, email: session.user.email, name: session.user.name };
    next();
  };
}
