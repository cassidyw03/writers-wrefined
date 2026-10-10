import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile("../.env");
} catch {
  // No .env file; use the environment as is (CI, Render).
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
