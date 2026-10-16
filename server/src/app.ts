import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { chapterRoutes } from "./chapters/routes.js";
import type { Db } from "./db/client.js";
import type { Extractor } from "./extraction/extract.js";

export type AppDeps = {
  db?: Db;
  extract?: Extractor;
};

export function createApp({ db, extract }: AppDeps = {}) {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  if (db && extract) {
    app.use("/api", chapterRoutes(db, extract));
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Something went wrong on the server." });
  };
  app.use(onError);

  return app;
}
