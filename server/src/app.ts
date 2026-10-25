import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { createAuth, requireUser } from "./auth.js";
import { chapterRoutes } from "./chapters/routes.js";
import type { Db } from "./db/client.js";
import type { Embedder } from "./embeddings/embed.js";
import type { Extractor } from "./extraction/extract.js";

export type AppDeps = {
  db?: Db;
  extract?: Extractor;
  embed?: Embedder;
};

export function createApp({ db, extract, embed }: AppDeps = {}) {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? true, credentials: true }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  if (db && extract) {
    const auth = createAuth(db);
    // Better Auth reads the raw request body, so it is mounted before express.json().
    app.all("/api/auth/{*any}", toNodeHandler(auth));
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", requireUser(auth), chapterRoutes(db, extract, embed));
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Something went wrong on the server." });
  };
  app.use(onError);

  return app;
}
