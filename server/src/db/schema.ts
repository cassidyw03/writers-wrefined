import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// Write side: `events` is an append-only log (see migration 0002 for the trigger that blocks UPDATE).
// Read side: `chapters`, `facts`, and `flags` are projections rebuilt from events.

export const EMBEDDING_DIMENSIONS = 1024;

export const eventType = pgEnum("event_type", [
  "ChapterAdded",
  "FactExtracted",
  "StateChanged",
  "FlagRaised",
  "FlagResolved",
  "ChapterReplaced",
]);

export const factType = pgEnum("fact_type", ["attribute", "relationship", "event", "knowledge"]);

export const subjectKind = pgEnum("subject_kind", ["character", "place", "object", "group"]);

export const sourceFormat = pgEnum("source_format", ["paste", "docx", "md"]);

export const flagStatus = pgEnum("flag_status", ["open", "accepted", "dismissed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// Auth tables, managed by Better Auth (src/auth.ts). Column names follow Better Auth's core schema.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().default(""),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// One row per way a user can sign in. For email and password, providerId is "credential"
// and `password` holds the hash.
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

// Short-lived tokens (email verification, password reset). Unused until those features are added.
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("books_user_idx").on(t.userId)],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title"),
    text: text("text").notNull(),
    sourceFormat: sourceFormat("source_format").notNull(),
    // Set when a revised chapter replaces this one (FR15); only one current chapter per number.
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chapters_current_number_idx")
      .on(t.bookId, t.number)
      .where(sql`${t.supersededAt} is null`),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    // No cascade: a chapter cannot be deleted while events point to it, so the log stays intact.
    chapterId: uuid("chapter_id").references(() => chapters.id),
    // Order of events within a book, starting at 1. Replaying in this order rebuilds the world.
    sequence: integer("sequence").notNull(),
    type: eventType("type").notNull(),
    data: jsonb("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("events_book_sequence_idx").on(t.bookId, t.sequence)],
);

export const facts = pgTable(
  "facts",
  {
    // Same id as the FactExtracted event that produced this fact.
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    type: factType("type").notNull(),
    subject: text("subject").notNull(),
    subjectKind: subjectKind("subject_kind").notNull(),
    attribute: text("attribute").notNull(),
    value: text("value").notNull(),
    quote: text("quote").notNull(),
    // Voyage embedding of factText(fact). Null if embedding failed or no Voyage key was set.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
  },
  (t) => [
    index("facts_book_subject_attribute_idx").on(t.bookId, t.subject, t.attribute),
    // Approximate nearest-neighbor index for cosine similarity search (findRelatedFacts).
    index("facts_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const flags = pgTable(
  "flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    raisedByEventId: uuid("raised_by_event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    newFactId: uuid("new_fact_id")
      .notNull()
      .references(() => facts.eventId, { onDelete: "cascade" }),
    earlierFactId: uuid("earlier_fact_id")
      .notNull()
      .references(() => facts.eventId, { onDelete: "cascade" }),
    explanation: text("explanation").notNull(),
    status: flagStatus("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("flags_book_status_idx").on(t.bookId, t.status)],
);
