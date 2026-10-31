import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import request, { type Agent } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Checker, FactPair, Verdict } from "../checking/check.js";
import { MIGRATIONS_FOLDER, type Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { Embedder } from "../embeddings/embed.js";
import { readEvents } from "../events/store.js";
import { ExtractionError, type Extractor } from "../extraction/extract.js";

const CHAPTER =
  "1801.—I have just returned from a visit to my landlord. He is a dark-skinned gipsy in aspect, in dress and manners a gentleman.";

let client: PGlite;
let db: Db;
let extract: Extractor;
let embed: Embedder;
let check: Checker;
// The pairs each continuity check was asked about, one entry per call.
let checkCalls: FactPair[][];
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
  app = createApp({
    db,
    extract: (text) => extract(text),
    embed: (texts, type) => embed(texts, type),
    check: (chapter, pairs) => check(chapter, pairs),
  });
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

// Stands in for Voyage: "subject: attribute" sets one strong dimension and the value a weaker one,
// so facts about the same thing come out similar even when their values differ.
const fakeEmbedder: Embedder = async (texts) =>
  texts.map((text) => {
    const [subject, attribute, value] = text.split(": ");
    const v = new Array<number>(schema.EMBEDDING_DIMENSIONS).fill(0);
    v[hash(`${subject}: ${attribute}`)] += 1;
    v[hash(value)] += 0.5;
    return v;
  });

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % schema.EMBEDDING_DIMENSIONS;
  return h;
}

// Stands in for Claude's continuity check: gives every pair the same verdict and records what it was asked.
function fakeChecker(verdict: Verdict["verdict"]): Checker {
  return async (_chapter, pairs) => {
    checkCalls.push(pairs);
    return {
      model: "fake-model",
      inputTokens: 100,
      outputTokens: 20,
      verdicts: pairs.map((p, i) => ({
        pair: i,
        verdict,
        reason: `Chapter ${p.earlierFact.chapterNumber} says ${p.earlierFact.value}, chapter ${p.newFact.chapterNumber} says ${p.newFact.value}.`,
      })),
    };
  };
}

// The same facts as fakeExtractor, except the eyes are blue.
const blueEyesExtractor: Extractor = async (text) => {
  const result = await fakeExtractor(text);
  const facts = result.facts.map((f) =>
    f.attribute === "eye color" ? { ...f, value: "blue", quote: "His blue eyes withdrew suspiciously." } : f,
  );
  return { ...result, facts };
};

beforeEach(async () => {
  await db.delete(schema.users);
  extract = fakeExtractor;
  embed = fakeEmbedder;
  check = fakeChecker("consistent");
  checkCalls = [];
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

describe("embeddings", () => {
  it("saves a vector for every fact", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });

    const rows = await db.select({ embedding: schema.facts.embedding }).from(schema.facts);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.embedding?.length === schema.EMBEDDING_DIMENSIONS)).toBe(true);
  });

  it("still saves the chapter and facts when embedding fails", async () => {
    embed = async () => {
      throw new Error("Voyage is down");
    };

    const res = await author.post("/api/chapters").send({ text: CHAPTER });

    expect(res.status).toBe(201);
    expect(res.body.facts).toHaveLength(2);
    const rows = await db.select({ embedding: schema.facts.embedding }).from(schema.facts);
    expect(rows.every((r) => r.embedding === null)).toBe(true);
  });

  it("finds the closest facts from earlier chapters only", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });
    const second = await author.post("/api/chapters").send({ text: CHAPTER });
    const skin = second.body.facts.find((f: { attribute: string }) => f.attribute === "skin");

    const res = await author.get(`/api/facts/${skin.id}/related`);

    expect(res.status).toBe(200);
    expect(res.body.related).toHaveLength(2);
    expect(res.body.related.every((f: { chapterNumber: number }) => f.chapterNumber === 1)).toBe(true);
    expect(res.body.related[0]).toMatchObject({ subject: "Heathcliff", attribute: "skin", similarity: 1 });
    expect(res.body.related[1].similarity).toBeLessThan(1);
  });

  it("does not search another author's facts", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });
    const second = await author.post("/api/chapters").send({ text: CHAPTER });
    const other = await signUp("other@example.com");

    const res = await other.get(`/api/facts/${second.body.facts[0].id}/related`);

    expect(res.body.related).toEqual([]);
  });
});

describe("continuity check", () => {
  it("does not run on the first chapter", async () => {
    const res = await author.post("/api/chapters").send({ text: CHAPTER });

    expect(checkCalls).toEqual([]);
    expect(res.body.flags).toEqual([]);
  });

  it("only asks about similar facts that differ", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });
    extract = blueEyesExtractor;

    const res = await author.post("/api/chapters").send({ text: CHAPTER });

    // The skin fact is identical in both chapters, so only the eye colors are compared.
    expect(checkCalls).toHaveLength(1);
    expect(checkCalls[0]).toHaveLength(1);
    expect(checkCalls[0][0].earlierFact).toMatchObject({ chapterNumber: 1, attribute: "eye color", value: "black" });
    expect(checkCalls[0][0].newFact).toMatchObject({ chapterNumber: 2, attribute: "eye color", value: "blue" });
    expect(res.body.check).toEqual({ pairsChecked: 1, flagsRaised: 0, stateChanges: 0 });
  });

  it("flags a contradiction with both facts side by side", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });
    extract = blueEyesExtractor;
    check = fakeChecker("contradiction");

    const res = await author.post("/api/chapters").send({ text: CHAPTER });

    expect(res.status).toBe(201);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0]).toMatchObject({
      status: "open",
      explanation: "Chapter 1 says black, chapter 2 says blue.",
      earlierFact: { chapterNumber: 1, value: "black", quote: "His black eyes withdrew suspiciously." },
      newFact: { chapterNumber: 2, value: "blue", quote: "His blue eyes withdrew suspiciously." },
    });

    const events = await readEvents(db, (await author.get("/api/book")).body.id);
    expect(events.filter((e) => e.type === "FlagRaised")).toHaveLength(1);

    const all = await author.get("/api/flags");
    expect(all.body.flags.map((f: { id: string }) => f.id)).toEqual([res.body.flags[0].id]);
    const chapter = await author.get(`/api/chapters/${res.body.chapter.id}`);
    expect(chapter.body.flags).toHaveLength(1);
  });

  it("records an explained change as a state change, not a flag", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });
    extract = blueEyesExtractor;
    check = fakeChecker("state_change");

    const res = await author.post("/api/chapters").send({ text: CHAPTER });

    expect(res.body.flags).toEqual([]);
    expect(res.body.check).toMatchObject({ flagsRaised: 0, stateChanges: 1 });
    const events = await readEvents(db, (await author.get("/api/book")).body.id);
    const changed = events.find((e) => e.type === "StateChanged");
    expect(changed?.data).toMatchObject({ reason: "Chapter 1 says black, chapter 2 says blue." });
  });

  it("still saves the chapter when the check fails", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });
    extract = blueEyesExtractor;
    check = async () => {
      throw new Error("Claude is down");
    };

    const res = await author.post("/api/chapters").send({ text: CHAPTER });

    expect(res.status).toBe(201);
    expect(res.body.facts).toHaveLength(2);
    expect(res.body.check).toBeNull();
  });

  it("does not show another author's flags", async () => {
    await author.post("/api/chapters").send({ text: CHAPTER });
    extract = blueEyesExtractor;
    check = fakeChecker("contradiction");
    await author.post("/api/chapters").send({ text: CHAPTER });
    const other = await signUp("other@example.com");

    const res = await other.get("/api/flags");

    expect(res.body.flags).toEqual([]);
  });
});
