import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { flags } from "../db/schema.js";
import { readEvents } from "../events/store.js";
import { replayWorldState } from "./replay.js";

// Replays a book's events up to chapterNumber (or to the latest chapter when it is left out).
export async function getWorldState(db: Db, bookId: string, chapterNumber?: number) {
  const [events, flagRows] = await Promise.all([
    readEvents(db, bookId),
    db.select({ id: flags.id, eventId: flags.raisedByEventId }).from(flags).where(eq(flags.bookId, bookId)),
  ]);
  const flagEventIds = new Map(flagRows.map((f) => [f.id, f.eventId]));
  return replayWorldState(events, chapterNumber ?? Number.MAX_SAFE_INTEGER, flagEventIds);
}
