import Anthropic from "@anthropic-ai/sdk";
import { Router, type Response } from "express";
import { z } from "zod";
import type { Checker } from "../checking/check.js";
import type { Db } from "../db/client.js";
import type { Embedder } from "../embeddings/embed.js";
import { ExtractionError, type Extractor } from "../extraction/extract.js";
import {
  addChapter,
  createBook,
  findRelatedFacts,
  getChapter,
  getChapterFacts,
  getOwnedBook,
  getUserBook,
  listBooks,
  listChapters,
  listFlags,
  resolveFlag,
} from "./service.js";

const NewBookBody = z.object({
  title: z.string().trim().min(1, "Give the book a title").max(200, "Title is too long"),
});

const NewChapterBody = z.object({
  bookId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  text: z.string().trim().min(1, "Chapter text is empty").max(200_000, "Chapter is too long"),
  sourceFormat: z.enum(["paste", "docx", "md"]).default("paste"),
});

const FlagUpdateBody = z.object({
  status: z.enum(["accepted", "dismissed", "open"]),
});

export function chapterRoutes(db: Db, extract: Extractor, embed?: Embedder, check?: Checker) {
  const router = Router();

  // The book a request is about: the one named by bookId if the author owns it, or their first book when none is named.
  // Sends a 404 and returns undefined when the author does not own that book.
  async function bookFor(bookId: unknown, res: Response) {
    if (bookId === undefined) return getUserBook(db, res.locals.user.id);
    const parsed = z.uuid().safeParse(bookId);
    const book = parsed.success ? await getOwnedBook(db, parsed.data, res.locals.user.id) : undefined;
    if (!book) res.status(404).json({ error: "Book not found" });
    return book;
  }

  const bookView = async (book: { id: string; title: string }) => ({
    id: book.id,
    title: book.title,
    chapters: await listChapters(db, book.id),
  });

  router.get("/books", async (_req, res) => {
    res.json({ books: await listBooks(db, res.locals.user.id) });
  });

  router.post("/books", async (req, res) => {
    const body = NewBookBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid book" });
      return;
    }
    res.status(201).json(await bookView(await createBook(db, res.locals.user.id, body.data.title)));
  });

  router.get("/books/:id", async (req, res) => {
    const book = await bookFor(req.params.id, res);
    if (book) res.json(await bookView(book));
  });

  // The author's first book. Kept for older clients; new code uses /books/:id.
  router.get("/book", async (_req, res) => {
    res.json(await bookView(await getUserBook(db, res.locals.user.id)));
  });

  router.post("/chapters", async (req, res) => {
    const body = NewChapterBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid chapter" });
      return;
    }

    const { bookId, ...chapter } = body.data;
    const book = await bookFor(bookId, res);
    if (!book) return;
    try {
      res.status(201).json(await addChapter(db, extract, book.id, chapter, embed, check));
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
    const chapter = parsed.success ? await getChapter(db, parsed.data, res.locals.user.id) : undefined;
    if (!chapter) {
      res.status(404).json({ error: "Chapter not found" });
      return;
    }
    res.json({
      chapter: { id: chapter.id, number: chapter.number, title: chapter.title },
      facts: await getChapterFacts(db, chapter.id),
      flags: await listFlags(db, chapter.bookId, chapter.id),
    });
  });

  // Every flag in one of the author's books (?bookId=, or their first book), with both facts side by side.
  router.get("/flags", async (req, res) => {
    const book = await bookFor(req.query.bookId, res);
    if (book) res.json({ flags: await listFlags(db, book.id) });
  });

  // The author accepts a flag as a real problem, dismisses it, or reopens it (FR11).
  router.patch("/flags/:id", async (req, res) => {
    const body = FlagUpdateBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Status must be accepted, dismissed, or open" });
      return;
    }
    const parsed = z.uuid().safeParse(req.params.id);
    const flag = parsed.success ? await resolveFlag(db, parsed.data, res.locals.user.id, body.data.status) : undefined;
    if (!flag) {
      res.status(404).json({ error: "Flag not found" });
      return;
    }
    res.json({ flag });
  });

  // Earlier facts most similar to this one. Groundwork for the continuity checker; empty until facts have vectors.
  router.get("/facts/:id/related", async (req, res) => {
    const parsed = z.uuid().safeParse(req.params.id);
    res.json({ related: parsed.success ? await findRelatedFacts(db, parsed.data, res.locals.user.id) : [] });
  });

  return router;
}
