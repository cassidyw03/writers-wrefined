import { and, asc, cosineDistance, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { books, chapters, events, facts } from "../db/schema.js";
import { appendEvent } from "../events/store.js";
import { factText, type Embedder } from "../embeddings/embed.js";
import { quoteFound, type Extractor } from "../extraction/extract.js";

const FIRST_BOOK_TITLE = "My book";

// Each author gets their own book, created the first time they need one.
// Choosing between several books (FR2) comes later.
export async function getUserBook(db: Db, userId: string) {
  const [existing] = await db.select().from(books).where(eq(books.userId, userId)).orderBy(asc(books.createdAt)).limit(1);
  return existing ?? (await db.insert(books).values({ userId, title: FIRST_BOOK_TITLE }).returning())[0];
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
// With an embedder, each fact's vector is saved too, so later chapters can be checked against it.
export async function addChapter(db: Db, extract: Extractor, bookId: string, input: NewChapter, embed?: Embedder) {
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

  const saved: { id: string; text: string }[] = [];
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
    saved.push({ id: event.id, text: factText(fact) });
  }

  if (embed && saved.length > 0) await embedFacts(db, embed, saved);

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

// Pass userId to only find the chapter if it belongs to one of that user's books.
export async function getChapter(db: Db, chapterId: string, userId?: string) {
  const [chapter] = await db
    .select({ id: chapters.id, number: chapters.number, title: chapters.title, text: chapters.text })
    .from(chapters)
    .innerJoin(books, eq(books.id, chapters.bookId))
    .where(and(eq(chapters.id, chapterId), userId ? eq(books.userId, userId) : undefined));
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

// Saves a vector for each fact. A Voyage failure is logged, not thrown: the chapter and its facts are
// already saved, and facts without a vector are simply skipped by findRelatedFacts.
async function embedFacts(db: Db, embed: Embedder, saved: { id: string; text: string }[]) {
  let vectors: number[][];
  try {
    vectors = await embed(saved.map((f) => f.text), "document");
  } catch (error) {
    console.error("Embedding failed; facts were saved without vectors", error);
    return;
  }
  await db.transaction(async (tx) => {
    for (const [i, fact] of saved.entries()) {
      await tx.update(facts).set({ embedding: vectors[i] }).where(eq(facts.eventId, fact.id));
    }
  });
}

// The facts from earlier chapters that sit closest to this one in vector space, nearest first.
// This is what the continuity checker will compare a new fact against. Only finds the fact if userId owns its book.
export async function findRelatedFacts(db: Db, factId: string, userId: string, limit = 5) {
  const [fact] = await db
    .select({ bookId: facts.bookId, chapterNumber: facts.chapterNumber, embedding: facts.embedding })
    .from(facts)
    .innerJoin(books, eq(books.id, facts.bookId))
    .where(and(eq(facts.eventId, factId), eq(books.userId, userId)));
  if (!fact?.embedding) return [];

  const distance = cosineDistance(facts.embedding, fact.embedding);
  const rows = await db
    .select({
      id: facts.eventId,
      chapterNumber: facts.chapterNumber,
      subject: facts.subject,
      attribute: facts.attribute,
      value: facts.value,
      quote: facts.quote,
      distance,
    })
    .from(facts)
    .where(and(eq(facts.bookId, fact.bookId), lt(facts.chapterNumber, fact.chapterNumber), isNotNull(facts.embedding)))
    .orderBy(distance)
    .limit(limit);

  // Cosine similarity is 1 - distance: 1 means pointing the same way, 0 means unrelated.
  return rows.map(({ distance, ...row }) => ({ ...row, similarity: Number((1 - Number(distance)).toFixed(3)) }));
}
