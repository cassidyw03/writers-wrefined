import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { books, events } from "../db/schema.js";
import { NewEventSchema, type NewEvent } from "./schemas.js";

export type StoredEvent = typeof events.$inferSelect;

export class BookNotFoundError extends Error {
  constructor(bookId: string) {
    super(`Book ${bookId} does not exist`);
    this.name = "BookNotFoundError";
  }
}

// The only way events are written. Validates the event, then appends it with the book's next sequence number.
// Throws a ZodError for invalid events and BookNotFoundError for an unknown book.
export async function appendEvent(db: Db, input: NewEvent): Promise<StoredEvent> {
  const event = NewEventSchema.parse(input);

  return db.transaction(async (tx) => {
    // Lock the book row so two appends to the same book cannot get the same sequence number.
    const [book] = await tx.select({ id: books.id }).from(books).where(eq(books.id, event.bookId)).for("update");
    if (!book) throw new BookNotFoundError(event.bookId);

    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${events.sequence}), 0) + 1` })
      .from(events)
      .where(eq(events.bookId, event.bookId));

    const [stored] = await tx
      .insert(events)
      .values({
        bookId: event.bookId,
        chapterId: event.chapterId,
        sequence: Number(next),
        type: event.type,
        data: event.data,
      })
      .returning();

    return stored;
  });
}

// All of a book's events in the order they happened.
export async function readEvents(db: Db, bookId: string): Promise<StoredEvent[]> {
  return db.select().from(events).where(eq(events.bookId, bookId)).orderBy(asc(events.sequence));
}
