import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";

// Works with node-postgres in the app and PGlite in tests.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export function connect(databaseUrl: string) {
  // Render's external URLs need SSL; the internal URL used in production does not.
  const ssl = new URL(databaseUrl).hostname.endsWith(".render.com") ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl });
  return { db: drizzle(pool, { schema }), pool };
}

export async function runMigrations(databaseUrl: string) {
  const { db, pool } = connect(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
