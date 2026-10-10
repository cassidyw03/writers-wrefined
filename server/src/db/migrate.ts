import { runMigrations } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to the .env file at the repo root.");
  process.exit(1);
}

await runMigrations(databaseUrl);
console.log("Migrations applied.");
