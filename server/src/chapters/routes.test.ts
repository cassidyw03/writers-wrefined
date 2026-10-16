import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { MIGRATIONS_FOLDER, type Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { readEvents } from "../events/store.js";
import { ExtractionError, type Extractor } from "../extraction/extract.js";

const CHAPTER =
  "1801.—I have just returned from a visit to my landlord. He is a dark-skinned gipsy in aspect, in dress and manners a gentleman.";

let client: PGlite;
let db: Db;
let extract: Extractor;

// Stands in for Claude: returns one real fact and one with an invented quote.
const fakeExtractor: Extractor = async () => ({
  model: "fake-model",
  inputTokens: 100,
  outputTokens: 50,
  facts: [
    {
      type: "attribute",
      subject: "Heathcliff",
      subject_kind: "character",
      attribute: "skin",
      value: "dark-skinned",
      quote: "He is a dark-skinned gipsy in aspect, in dress and manners a gentleman.",
    },
    {
      type: "attribute",
      subject: "Heathcliff",
      subject_kind: "character",
      attribute: "eye color",
      value: "black",
      quote: "His black eyes withdrew suspiciously.",
    },
  ],
});

beforeAll(async () => {
  client = new PGlite({ extensions: { vector } });
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder: MIGRATIONS_FOLDER });
  db = pgliteDb;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.delete(schema.users);
  extract = fakeExtractor;
});

const app = () => createApp({ db, extract: (text) => extract(text) });

describe("POST /api/chapters", () => {
  it("saves the chapter, extracts its facts, and records each as an event", async () => {
    const res = await request(app()).post("/api/chapters").send({ title: "Chapter 1", text: CHAPTER });

    expect(res.status).toBe(201);
    expect(res.body.chapter).toMatchObject({ number: 1, title: "Chapter 1" });
    expect(res.body.facts).toHaveLength(2);
    expect(res.body.facts[0]).toMatchObject({ subject: "Heathcliff", attribute: "skin", quoteFound: true });
    expect(res.body.facts[1]).toMatchObject({ attribute: "eye color", quoteFound: false });

    const book = await request(app()).get("/api/book");
    const events = await readEvents(db, book.body.id);
    expect(events.map((e) => e.type)).toEqual(["ChapterAdded", "FactExtracted", "FactExtracted"]);
  });

  it("numbers chapters in the order they are added", async () => {
    await request(app()).post("/api/chapters").send({ text: CHAPTER });
    const second = await request(app()).post("/api/chapters").send({ text: CHAPTER });

    expect(second.body.chapter.number).toBe(2);
    const book = await request(app()).get("/api/book");
    expect(book.body.chapters.map((c: { number: number }) => c.number)).toEqual([1, 2]);
    expect(book.body.chapters[0].factCount).toBe(2);
  });

  it("rejects an empty chapter", async () => {
    const res = await request(app()).post("/api/chapters").send({ text: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Chapter text is empty");
  });

  it("reports an extraction failure without crashing", async () => {
    extract = async () => {
      throw new ExtractionError("The output was cut off. Try a shorter chapter.");
    };

    const res = await request(app()).post("/api/chapters").send({ text: CHAPTER });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/cut off/);
  });
});

describe("GET /api/chapters/:id", () => {
  it("returns a saved chapter's facts", async () => {
    const created = await request(app()).post("/api/chapters").send({ text: CHAPTER });

    const res = await request(app()).get(`/api/chapters/${created.body.chapter.id}`);

    expect(res.status).toBe(200);
    expect(res.body.facts).toHaveLength(2);
  });

  it("returns 404 for an unknown chapter", async () => {
    const res = await request(app()).get("/api/chapters/not-a-real-id");

    expect(res.status).toBe(404);
  });
});
