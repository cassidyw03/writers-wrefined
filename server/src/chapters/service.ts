import { and, asc, cosineDistance, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Checker, FactPair } from "../checking/check.js";
import type { Db } from "../db/client.js";
import { books, chapters, events, facts, flags } from "../db/schema.js";
import { appendEvent } from "../events/store.js";
import { factText, type Embedder } from "../embeddings/embed.js";
import { quoteFound, type Extractor } from "../extraction/extract.js";

const FIRST_BOOK_TITLE = "My book";

// How many earlier facts each new fact is checked against, and how similar they must be to count.
// With Voyage, two facts about the same subject and attribute score about 0.9; unrelated facts about 0.4.
const NEIGHBORS_PER_FACT = 3;
const MIN_SIMILARITY = 0.7;
// Keeps one chapter's check to a single Claude call of a sensible size.
const MAX_PAIRS = 150;

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
// With a checker as well, the new facts are checked against earlier chapters for contradictions.
export async function addChapter(
  db: Db,
  extract: Extractor,
  bookId: string,
  input: NewChapter,
  embed?: Embedder,
  check?: Checker,
) {
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

  const saved: SavedFact[] = [];
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
    const { subject, attribute, value, quote } = fact;
    saved.push({ id: event.id, chapterNumber, subject, attribute, value, quote });
  }

  const vectors = embed && saved.length > 0 ? await embedFacts(db, embed, saved) : null;
  const checkStats =
    check && vectors
      ? await checkFacts(db, check, { bookId, chapterId: chapter.id, chapterNumber, text: input.text }, saved, vectors)
      : null;

  return {
    chapter: { id: chapter.id, number: chapter.number, title: chapter.title },
    facts: await getChapterFacts(db, chapter.id),
    flags: await listFlags(db, bookId, chapter.id),
    check: checkStats,
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
    .select({ id: chapters.id, bookId: chapters.bookId, number: chapters.number, title: chapters.title, text: chapters.text })
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

type SavedFact = {
  id: string;
  chapterNumber: number;
  subject: string;
  attribute: string;
  value: string;
  quote: string;
};

// Saves a vector for each fact and returns them. A Voyage failure is logged, not thrown: the chapter and its
// facts are already saved, and facts without a vector are simply skipped by the search and the check.
async function embedFacts(db: Db, embed: Embedder, saved: SavedFact[]) {
  let vectors: number[][];
  try {
    vectors = await embed(saved.map(factText), "document");
  } catch (error) {
    console.error("Embedding failed; facts were saved without vectors", error);
    return null;
  }
  await db.transaction(async (tx) => {
    for (const [i, fact] of saved.entries()) {
      await tx.update(facts).set({ embedding: vectors[i] }).where(eq(facts.eventId, fact.id));
    }
  });
  return vectors;
}

// Pairs each new fact with its closest earlier facts, asks the checker about every pair in one call, and records
// each contradiction as a FlagRaised event plus a flag, and each explained change as a StateChanged event.
// A failed check is logged, not thrown, so the chapter is still saved; it returns null in that case.
async function checkFacts(
  db: Db,
  check: Checker,
  chapter: { bookId: string; chapterId: string; chapterNumber: number; text: string },
  saved: SavedFact[],
  vectors: number[][],
) {
  const candidates: { pair: FactPair; newFactId: string; earlierFactId: string; similarity: number }[] = [];
  for (const [i, fact] of saved.entries()) {
    const nearest = await nearestEarlierFacts(db, chapter.bookId, chapter.chapterNumber, vectors[i], NEIGHBORS_PER_FACT);
    for (const earlier of nearest) {
      // Identical facts cannot contradict, so there is no need to ask about them.
      if (earlier.similarity < MIN_SIMILARITY || sameFact(fact, earlier)) continue;
      const { id: _id, similarity, ...earlierFact } = earlier;
      const { id: _newId, ...newFact } = fact;
      candidates.push({ pair: { newFact, earlierFact }, newFactId: fact.id, earlierFactId: earlier.id, similarity });
    }
  }
  candidates.sort((a, b) => b.similarity - a.similarity).splice(MAX_PAIRS);

  const stats = { pairsChecked: candidates.length, flagsRaised: 0, stateChanges: 0 };
  if (candidates.length === 0) return stats;

  let result;
  try {
    result = await check({ number: chapter.chapterNumber, text: chapter.text }, candidates.map((c) => c.pair));
  } catch (error) {
    console.error("Continuity check failed; the chapter was saved without it", error);
    return null;
  }

  const seen = new Set<number>();
  for (const { pair: index, verdict, reason } of result.verdicts) {
    const candidate = candidates[index];
    if (!candidate || seen.has(index) || verdict === "consistent") continue;
    seen.add(index);
    const ids = { newFactId: candidate.newFactId, earlierFactId: candidate.earlierFactId };
    const envelope = { bookId: chapter.bookId, chapterId: chapter.chapterId };

    if (verdict === "contradiction") {
      const explanation = reason.trim() || "These two facts disagree.";
      const event = await appendEvent(db, { ...envelope, type: "FlagRaised", data: { ...ids, explanation } });
      await db.insert(flags).values({ bookId: chapter.bookId, raisedByEventId: event.id, ...ids, explanation });
      stats.flagsRaised++;
    } else {
      const data = { ...ids, reason: reason.trim() || "The story explains this change." };
      await appendEvent(db, { ...envelope, type: "StateChanged", data });
      stats.stateChanges++;
    }
  }
  return stats;
}

const normalizeValue = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function sameFact(a: { subject: string; attribute: string; value: string }, b: typeof a) {
  return (["subject", "attribute", "value"] as const).every((k) => normalizeValue(a[k]) === normalizeValue(b[k]));
}

// The facts from earlier chapters that sit closest to this one in vector space, nearest first.
// Only finds the fact if userId owns its book.
export async function findRelatedFacts(db: Db, factId: string, userId: string, limit = 5) {
  const [fact] = await db
    .select({ bookId: facts.bookId, chapterNumber: facts.chapterNumber, embedding: facts.embedding })
    .from(facts)
    .innerJoin(books, eq(books.id, facts.bookId))
    .where(and(eq(facts.eventId, factId), eq(books.userId, userId)));
  if (!fact?.embedding) return [];
  return nearestEarlierFacts(db, fact.bookId, fact.chapterNumber, fact.embedding, limit);
}

// The facts from chapters before chapterNumber whose vectors sit closest to embedding, nearest first.
// This is what the continuity checker compares a new fact against.
async function nearestEarlierFacts(db: Db, bookId: string, chapterNumber: number, embedding: number[], limit: number) {
  const distance = cosineDistance(facts.embedding, embedding);
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
    .where(and(eq(facts.bookId, bookId), lt(facts.chapterNumber, chapterNumber), isNotNull(facts.embedding)))
    .orderBy(distance)
    .limit(limit);

  // Cosine similarity is 1 - distance: 1 means pointing the same way, 0 means unrelated.
  return rows.map(({ distance, ...row }) => ({ ...row, similarity: Number((1 - Number(distance)).toFixed(3)) }));
}

const newFact = alias(facts, "new_fact");
const earlierFact = alias(facts, "earlier_fact");

const flagFact = (f: typeof newFact | typeof earlierFact) => ({
  id: f.eventId,
  chapterNumber: f.chapterNumber,
  subject: f.subject,
  attribute: f.attribute,
  value: f.value,
  quote: f.quote,
});

// A book's flags, oldest first, each with both facts so they can be shown side by side.
// Pass chapterId for only the flags raised by that chapter's facts.
export async function listFlags(db: Db, bookId: string, chapterId?: string) {
  return db
    .select({
      id: flags.id,
      status: flags.status,
      explanation: flags.explanation,
      newFact: flagFact(newFact),
      earlierFact: flagFact(earlierFact),
    })
    .from(flags)
    .innerJoin(newFact, eq(newFact.eventId, flags.newFactId))
    .innerJoin(earlierFact, eq(earlierFact.eventId, flags.earlierFactId))
    .where(and(eq(flags.bookId, bookId), chapterId ? eq(newFact.chapterId, chapterId) : undefined))
    .orderBy(asc(newFact.chapterNumber), asc(flags.createdAt));
}
