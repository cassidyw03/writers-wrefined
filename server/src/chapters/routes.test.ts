import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import request, { type Agent } from "supertest";
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
// A signed-in browser: supertest's agent keeps the session cookie between requests.
let author: Agent;
let app: ReturnType<typeof createApp>;

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
  app = createApp({ db, extract: (text) => extract(text) });
});

afterAll(async () => {
  await client.close();
});


async function signUp(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/sign-up/email").send({ name: "Test Author", email, password: "correct horse battery" });
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(async () => {
  await db.delete(schema.users);
  extract = fakeExtractor;
  author = await signUp("author@example.com");
});

describe("POST /api/chapters", () => {
  it("saves the chapter, extracts its facts, and records each as an event", async () => {
    const res = await author.post("/api/chapters").send({ title: "Chapter 1", text: CHAPTER });

    expect(res.status).toBe(201);
    expect(res.body.chapter).toMatchObject({ number: 1, title: "Chapter 1" });
    expect(res.body.facts).toHaveLength(2);
    expect(res.body.facts[0]).toMatchObject({ subject: "Heathcliff", attribute: "skin", quoteFound: true });
    expect(res.body.facts[1]).toMatchObject({ attribute: "eye color", quoteFound: false });

    const book = await author.get("/api/book");
    const events = await readEvents(db, book.body.id);
    expect(events.map((e) => e.type)).toEqual(["ChapterAdded", "FactExtracted", "FactExtracted"]);
  });

  it("numbers chapters in the order they are added", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });
    const second = await author.post("/api/chapters").send({ text: CHAPTER });

    expect(second.body.chapter.number).toBe(2);
    const book = await author.get("/api/book");
    expect(book.body.chapters.map((c: { number: number }) => c.number)).toEqual([1, 2]);
    expect(book.body.chapters[0].factCount).toBe(2);
  });

  it("rejects an empty chapter", async () => {
    const res = await author.post("/api/chapters").send({ text: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Chapter text is empty");
  });

  it("reports an extraction failure without crashing", async () => {
    extract = async () => {
      throw new ExtractionError("The output was cut off. Try a shorter chapter.");
    };

    const res = await author.post("/api/chapters").send({ text: CHAPTER });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/cut off/);
  });
});

describe("GET /api/chapters/:id", () => {
  it("returns a saved chapter's facts", async () => {
    const created = await author.post("/api/chapters").send({ text: CHAPTER });

    const res = await author.get(`/api/chapters/${created.body.chapter.id}`);

    expect(res.status).toBe(200);
    expect(res.body.facts).toHaveLength(2);
  });

  it("returns 404 for an unknown chapter", async () => {
    const res = await author.get("/api/chapters/not-a-real-id");

    expect(res.status).toBe(404);
  });
});

describe("logins", () => {
  it("rejects chapter requests without a session", async () => {
    const res = await request(app).get("/api/book");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please log in.");
  });

  it("gives each author their own book", async () => {
    const created = await author.post("/api/chapters").send({ text: CHAPTER });
    const other = await signUp("other@example.com");

    const otherBook = await other.get("/api/book");
    expect(otherBook.body.chapters).toEqual([]);
    expect(otherBook.body.id).not.toBe((await author.get("/api/book")).body.id);

    const peek = await other.get(`/api/chapters/${created.body.chapter.id}`);
    expect(peek.status).toBe(404);
  });

  it("logs in again with the same password", async () => {
    const res = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "author@example.com", password: "correct horse battery" });

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects a wrong password", async () => {
    const res = await request(app).post("/api/auth/sign-in/email").send({ email: "author@example.com", password: "wrong password" });

    expect(res.status).toBe(401);
  });
});
