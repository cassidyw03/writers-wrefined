import { eq, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { books, chapters, events, facts, users } from "./schema.js";

// The user the technology prototype stored every chapter under, before logins existed.
export const DEMO_EMAIL = "demo@writerswrefined.local";

export type TestDataSummary = {
  demoUser: boolean;
  books: { owner: string; title: string; chapters: number; facts: number; events: number }[];
};

export async function summarizeTestData(db: Db): Promise<TestDataSummary> {
  const [demo] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL));
  const rows = await db
    .select({
      owner: users.email,
      title: books.title,
      chapters: sql<number>`(select count(*)::int from ${chapters} where ${chapters.bookId} = ${books.id})`,
      facts: sql<number>`(select count(*)::int from ${facts} where ${facts.bookId} = ${books.id})`,
      events: sql<number>`(select count(*)::int from ${events} where ${events.bookId} = ${books.id})`,
    })
    .from(books)
    .innerJoin(users, eq(users.id, books.userId))
    .orderBy(users.email);
  return { demoUser: Boolean(demo), books: rows };
}

// Deletes every book (cascading to its chapters, events, facts, and flags) and the old demo user.
// Login accounts are kept; each author gets a new empty book the next time they open the site.
export async function clearTestData(db: Db) {
  await db.transaction(async (tx) => {
    await tx.delete(books);
    await tx.delete(users).where(eq(users.email, DEMO_EMAIL));
  });
}
