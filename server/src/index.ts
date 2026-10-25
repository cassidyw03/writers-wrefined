import { createApp } from "./app.js";
import { connect, runMigrations } from "./db/client.js";
import { createClaudeExtractor } from "./extraction/extract.js";

const port = Number(process.env.PORT ?? 3000);

// Bring the database schema up to date before taking requests (Render's free tier has no pre-deploy step).
let db;
if (process.env.DATABASE_URL) {
  await runMigrations(process.env.DATABASE_URL);
  console.log("Database migrations applied");
  db = connect(process.env.DATABASE_URL).db;
} else {
  console.warn("DATABASE_URL is not set; skipping migrations and chapter routes");
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY is not set; chapter extraction will fail until it is");
}

const app = createApp({ db, extract: createClaudeExtractor() });

// Extraction can take a minute or more, so allow long requests.
const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
server.requestTimeout = 5 * 60 * 1000;
