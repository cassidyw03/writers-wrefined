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
  src/chapters/     Chapter routes and service (save chapter, extract facts, record events)
  src/db/           Drizzle schema and database connection
  src/events/       Event schemas (Zod) and the event store (appendEvent, readEvents)
  src/extraction/   Claude extraction prompt, fact schema, and extractor
```

## API

Until auth is added, every chapter goes into one demo book.

| Route | What it does |
| --- | --- |
| `GET /api/health` | Reports the API is up |
| `GET /api/book` | The demo book and its chapters, with a fact count for each |
| `POST /api/chapters` | Body `{ title?, text, sourceFormat }`. Saves the chapter, extracts its facts with Claude, and returns them. Takes one to two minutes |
| `GET /api/chapters/:id` | A saved chapter's facts |

Each returned fact has `quoteFound`, which is false when its quote does not appear word for word in the chapter.
Set `EXTRACTION_MODEL` to try a model other than `claude-sonnet-5`.

## Data model

Story facts are stored with event sourcing. Every change is appended to the `events` table, which the database
refuses to update. `chapters`, `facts`, and `flags` are projections built from those events.
