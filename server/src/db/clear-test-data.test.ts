import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendEvent } from "../events/store.js";
import { clearTestData, DEMO_EMAIL, summarizeTestData } from "./clear-test-data.js";
import { MIGRATIONS_FOLDER, type Db } from "./client.js";
import * as schema from "./schema.js";

let client: PGlite;
let db: Db;

beforeAll(async () => {
  client = new PGlite({ extensions: { vector } });
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder: MIGRATIONS_FOLDER });
  db = pgliteDb;
});

afterAll(async () => {
  await client.close();
});

// A book with one chapter and one extracted fact, stored the same way addChapter stores them.
async function seedBook(email: string) {
  const [user] = await db.insert(schema.users).values({ email }).returning();
  const [book] = await db.insert(schema.books).values({ userId: user.id, title: "Test book" }).returning();
  const [chapter] = await db
    .insert(schema.chapters)
    .values({ bookId: book.id, number: 1, text: "Mara's eyes were grey.", sourceFormat: "paste" })
    .returning();
  await appendEvent(db, {
    type: "ChapterAdded",
    bookId: book.id,
    chapterId: chapter.id,
    data: { chapterNumber: 1, text: "Mara's eyes were grey.", sourceFormat: "paste" },
  });
  const fact = {
    type: "attribute" as const,
    subject: "Mara",
    subject_kind: "character" as const,
    attribute: "eye color",
    value: "grey",
    quote: "Mara's eyes were grey.",
  };
  const event = await appendEvent(db, { type: "FactExtracted", bookId: book.id, chapterId: chapter.id, data: { fact, model: "fake" } });
  await db.insert(schema.facts).values({
    eventId: event.id,
    bookId: book.id,
    chapterId: chapter.id,
    chapterNumber: 1,
    type: "attribute",
    subject: "Mara",
    subjectKind: "character",
    attribute: "eye color",
    value: "grey",
    quote: fact.quote,
  });
  return user;
}

beforeEach(async () => {
  await db.delete(schema.users);
  await seedBook(DEMO_EMAIL);
  await seedBook("author@example.com");
});

describe("clearTestData", () => {
  it("lists every book and the demo user before anything is deleted", async () => {
    const summary = await summarizeTestData(db);

    expect(summary.demoUser).toBe(true);
    expect(summary.books).toEqual([
      { owner: "author@example.com", title: "Test book", chapters: 1, facts: 1, events: 2 },
      { owner: DEMO_EMAIL, title: "Test book", chapters: 1, facts: 1, events: 2 },
    ]);
  });

  it("deletes all books and the demo user but keeps other accounts", async () => {
    await clearTestData(db);

    const remaining = await db.select({ email: schema.users.email }).from(schema.users);
    expect(remaining).toEqual([{ email: "author@example.com" }]);
    expect(await db.select().from(schema.books)).toEqual([]);
    expect(await db.select().from(schema.chapters)).toEqual([]);
    expect(await db.select().from(schema.events)).toEqual([]);
    expect(await db.select().from(schema.facts)).toEqual([]);
  });
});
