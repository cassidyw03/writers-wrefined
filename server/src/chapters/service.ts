import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { books, chapters, events, facts, users } from "../db/schema.js";
import { appendEvent } from "../events/store.js";
import { quoteFound, type Extractor } from "../extraction/extract.js";

// Until auth is added, every chapter goes into one demo book owned by one demo user.
const DEMO_EMAIL = "demo@writerswrefined.local";
const DEMO_BOOK_TITLE = "Demo book";

export async function getDemoBook(db: Db) {
  const [existingUser] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  const user = existingUser ?? (await db.insert(users).values({ email: DEMO_EMAIL }).returning())[0];

  const [existingBook] = await db.select().from(books).where(eq(books.userId, user.id)).limit(1);
  return existingBook ?? (await db.insert(books).values({ userId: user.id, title: DEMO_BOOK_TITLE }).returning())[0];
}

export async function listChapters(db: Db, bookId: string) {
  return db
    .select({
      id: chapters.id,
      number: chapters.number,
      title: chapters.title,
      createdAt: chapters.createdAt,
      factCount: sql<number>`(select count(*)::int from ${facts} where ${facts.chapterId} = ${chapters.id})`,
    })
    .from(chapters)
    .where(and(eq(chapters.bookId, bookId), isNull(chapters.supersededAt)))
    .orderBy(asc(chapters.number));
}

export type NewChapter = {
  title?: string;
  text: string;
  sourceFormat: "paste" | "docx" | "md";
};

// Saves the chapter, asks Claude for its facts, and records each one as a FactExtracted event.
// The chapter is saved before extraction runs, so a failed extraction still leaves the chapter on record.
export async function addChapter(db: Db, extract: Extractor, bookId: string, input: NewChapter) {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${chapters.number}), 0) + 1` })
    .from(chapters)
    .where(eq(chapters.bookId, bookId));
  const chapterNumber = Number(next);

  const [chapter] = await db
    .insert(chapters)
    .values({ bookId, number: chapterNumber, title: input.title, text: input.text, sourceFormat: input.sourceFormat })
    .returning();

  await appendEvent(db, {
    type: "ChapterAdded",
    bookId,
    chapterId: chapter.id,
    data: { chapterNumber, title: input.title, text: input.text, sourceFormat: input.sourceFormat },
  });

  const started = Date.now();
  const result = await extract(input.text);
  const seconds = (Date.now() - started) / 1000;

  for (const fact of result.facts) {
    // Skip facts with a blank field rather than failing the whole chapter on one bad fact.
    if (![fact.subject, fact.attribute, fact.value, fact.quote].every((s) => s.trim())) continue;

    const event = await appendEvent(db, {
      type: "FactExtracted",
      bookId,
      chapterId: chapter.id,
      data: { fact, model: result.model },
    });

    // Read-side projection. The embedding is filled in by the embeddings milestone.
    await db.insert(facts).values({
      eventId: event.id,
      bookId,
      chapterId: chapter.id,
      chapterNumber,
      type: fact.type,
      subject: fact.subject,
      subjectKind: fact.subject_kind,
      attribute: fact.attribute,
      value: fact.value,
      quote: fact.quote,
    });
  }

  return {
    chapter: { id: chapter.id, number: chapter.number, title: chapter.title },
    facts: await getChapterFacts(db, chapter.id),
    stats: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      seconds: Number(seconds.toFixed(1)),
    },
  };
}

export async function getChapter(db: Db, chapterId: string) {
  const [chapter] = await db
    .select({ id: chapters.id, number: chapters.number, title: chapters.title, text: chapters.text })
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  return chapter;
}

// A chapter's facts in the order they were extracted, each marked with whether its quote is really in the text.
export async function getChapterFacts(db: Db, chapterId: string) {
  const chapter = await getChapter(db, chapterId);
  if (!chapter) return [];

  const rows = await db
    .select({ fact: facts })
    .from(facts)
    .innerJoin(events, eq(events.id, facts.eventId))
    .where(eq(facts.chapterId, chapterId))
    .orderBy(asc(events.sequence));

  return rows.map(({ fact: f }) => ({
    id: f.eventId,
    type: f.type,
    subject: f.subject,
    subjectKind: f.subjectKind,
    attribute: f.attribute,
    value: f.value,
    quote: f.quote,
    quoteFound: quoteFound(chapter.text, f.quote),
  }));
}
