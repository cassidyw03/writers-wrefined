# Writers Wrefined

A continuity checker for authors. Upload a chapter, and AI pulls out every story fact and saves it as an event tied to that chapter. The app shows how your world has changed and flags anything that contradicts an earlier chapter.

CSE 499 Senior Project, BYU-Idaho, Fall 2026. Cassidy Whitehead Mangum.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite, TypeScript (`client/`) |
| Backend | Node.js, Express, TypeScript (`server/`) |
| Database | PostgreSQL + pgvector, Drizzle ORM |
| Validation | Zod |
| AI | Claude API (Sonnet 5 default, Opus 5.5 for comparison), Voyage AI embeddings |
| Testing / CI | Vitest, GitHub Actions |
| Hosting | Render |

## Getting started

Requires Node.js 22 or later.

```sh
npm install
cp .env.example .env   # then fill in the values
npm run dev            # API on :3000, client on :5173
```

## Scripts (run from the repo root)

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API and the client in watch mode |
| `npm run build` | Builds both workspaces |
| `npm run typecheck` | Type-checks both workspaces |
| `npm test` | Runs the test suites (database tests use in-memory PGlite, no server needed) |
| `npm run db:generate -w server` | Creates a migration from changes to `server/src/db/schema.ts` |
| `npm run db:migrate -w server` | Applies migrations to `DATABASE_URL` (the server also does this on startup) |

## Project layout

```
client/   React frontend
server/   Express API
  drizzle/          SQL migrations (pgvector, tables, append-only trigger on events)
  src/chapters/     Book, chapter, and flag routes and service (save chapter, extract, embed, check, record events)
  src/checking/     Claude continuity check (contradiction, explained change, or consistent)
  src/db/           Drizzle schema, database connection, and the clear-test-data script
  src/embeddings/   Voyage AI embeddings for facts
  src/events/       Event schemas (Zod) and the event store (appendEvent, readEvents)
  src/extraction/   Claude extraction prompt, fact schema, and extractor
```

## API

Every route except health and `/api/auth/*` needs a signed-in author (Better Auth session cookie) and only sees that
author's books.

| Route | What it does |
| --- | --- |
| `GET /api/health` | Reports the API is up |
| `GET /api/books` | The author's books, each with a chapter count. Creates "My book" for an author with none |
| `POST /api/books` | Body `{ title }`. Creates a book |
| `GET /api/books/:id` | A book and its chapters, with a fact count for each |
| `GET /api/book` | The author's first book. Kept for older clients |
| `POST /api/chapters` | Body `{ bookId?, title?, text, sourceFormat }`. Saves the chapter, extracts its facts with Claude, embeds them, and checks them against earlier chapters of the same book. Takes two to three minutes |
| `GET /api/chapters/:id` | A saved chapter's facts and flags |
| `GET /api/flags?bookId=` | Every flag in a book, with the earlier and new fact side by side |
| `PATCH /api/flags/:id` | Body `{ status }`: `accepted`, `dismissed`, or `open` to undo |
| `GET /api/facts/:id/related` | Earlier facts most similar to this one |

Leaving out `bookId` means the author's first book.
Each returned fact has `quoteFound`, which is false when its quote does not appear word for word in the chapter.
Set `EXTRACTION_MODEL` to try a model other than `claude-sonnet-5`.

## Data model

Story facts are stored with event sourcing. Every change is appended to the `events` table, which the database
refuses to update. `chapters`, `facts`, and `flags` are projections built from those events.
