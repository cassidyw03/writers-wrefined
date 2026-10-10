import { createApp } from "./app.js";
import { runMigrations } from "./db/client.js";

const port = Number(process.env.PORT ?? 3000);

// Bring the database schema up to date before taking requests (Render's free tier has no pre-deploy step).
if (process.env.DATABASE_URL) {
  await runMigrations(process.env.DATABASE_URL);
  console.log("Database migrations applied");
} else {
  console.warn("DATABASE_URL is not set; skipping migrations");
}

createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
