import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { ZodError } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, type Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { appendEvent, BookNotFoundError, readEvents } from "./store.js";

let client: PGlite;
let db: Db;
let bookId: string;
let chapterId: string;

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
  const [user] = await db.insert(schema.users).values({ email: "writer@example.com" }).returning();
  const [book] = await db.insert(schema.books).values({ userId: user.id, title: "Wuthering Heights" }).returning();
  const [chapter] = await db
    .insert(schema.chapters)
    .values({ bookId: book.id, number: 1, text: "1801.—I have just returned...", sourceFormat: "md" })
    .returning();
  bookId = book.id;
  chapterId = chapter.id;
});

const chapterAdded = () => ({
  type: "ChapterAdded" as const,
  bookId,
  chapterId,
  data: { chapterNumber: 1, text: "1801.—I have just returned...", sourceFormat: "md" as const },
});

const factExtracted = () => ({
  type: "FactExtracted" as const,
  bookId,
  chapterId,
  data: {
    model: "claude-sonnet-5",
    fact: {
      type: "attribute" as const,
      subject: "Heathcliff",
      subject_kind: "character" as const,
      attribute: "skin",
      value: "dark-skinned",
      quote: "He is a dark-skinned gipsy in aspect, in dress and manners a gentleman.",
    },
  },
});

describe("appendEvent", () => {
  it("numbers a book's events 1, 2, 3 in the order they are appended", async () => {
    await appendEvent(db, chapterAdded());
    await appendEvent(db, factExtracted());
    await appendEvent(db, factExtracted());

    const stored = await readEvents(db, bookId);
    expect(stored.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(stored.map((e) => e.type)).toEqual(["ChapterAdded", "FactExtracted", "FactExtracted"]);
  });

  it("gives every event a unique sequence number when appends run at the same time", async () => {
    await Promise.all(Array.from({ length: 5 }, () => appendEvent(db, factExtracted())));

    const stored = await readEvents(db, bookId);
    expect(stored.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects an invalid event and writes nothing", async () => {
    const bad = factExtracted();
    bad.data.fact.quote = "";

    await expect(appendEvent(db, bad)).rejects.toBeInstanceOf(ZodError);
    expect(await readEvents(db, bookId)).toHaveLength(0);
  });

  it("rejects an event for a book that does not exist", async () => {
    const event = { ...chapterAdded(), bookId: "00000000-0000-4000-8000-000000000000" };

    await expect(appendEvent(db, event)).rejects.toBeInstanceOf(BookNotFoundError);
  });
});

describe("events table", () => {
  it("refuses updates, so stored events can never change", async () => {
    const stored = await appendEvent(db, factExtracted());

    await expect(
      db.update(schema.events).set({ data: { tampered: true } }).where(eq(schema.events.id, stored.id)),
    ).rejects.toThrow();

    const [unchanged] = await readEvents(db, bookId);
    expect(unchanged.data).toEqual(stored.data);
  });

  it("removes a book's events when the book is deleted", async () => {
    await appendEvent(db, chapterAdded());
    await appendEvent(db, factExtracted());

    await db.delete(schema.books).where(eq(schema.books.id, bookId));

    expect(await readEvents(db, bookId)).toHaveLength(0);
  });

  it("does not let a chapter be deleted while events point to it", async () => {
    await appendEvent(db, chapterAdded());

    await expect(db.delete(schema.chapters).where(eq(schema.chapters.id, chapterId))).rejects.toThrow();
  });
});
