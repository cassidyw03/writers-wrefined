import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { ExtractionError, type Extractor } from "../extraction/extract.js";
import { addChapter, getChapter, getChapterFacts, getDemoBook, listChapters } from "./service.js";

const NewChapterBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  text: z.string().trim().min(1, "Chapter text is empty").max(200_000, "Chapter is too long"),
  sourceFormat: z.enum(["paste", "docx", "md"]).default("paste"),
});

export function chapterRoutes(db: Db, extract: Extractor) {
  const router = Router();

  router.get("/book", async (_req, res) => {
    const book = await getDemoBook(db);
    res.json({ id: book.id, title: book.title, chapters: await listChapters(db, book.id) });
  });

  router.post("/chapters", async (req, res) => {
    const body = NewChapterBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid chapter" });
      return;
    }

    const book = await getDemoBook(db);
    try {
      res.status(201).json(await addChapter(db, extract, book.id, body.data));
    } catch (error) {
      if (error instanceof ExtractionError) {
        res.status(502).json({ error: error.message });
      } else if (error instanceof Anthropic.RateLimitError) {
        res.status(503).json({ error: "Claude is rate limited right now. Wait a minute and try again." });
      } else if (error instanceof Anthropic.APIError) {
        res.status(502).json({ error: `Claude API error ${error.status ?? ""}: ${error.message}` });
      } else {
        throw error;
      }
    }
  });

  router.get("/chapters/:id", async (req, res) => {
    const parsed = z.uuid().safeParse(req.params.id);
    const chapter = parsed.success ? await getChapter(db, parsed.data) : undefined;
    if (!chapter) {
      res.status(404).json({ error: "Chapter not found" });
      return;
    }
    res.json({
      chapter: { id: chapter.id, number: chapter.number, title: chapter.title },
      facts: await getChapterFacts(db, chapter.id),
    });
  });

  return router;
}
