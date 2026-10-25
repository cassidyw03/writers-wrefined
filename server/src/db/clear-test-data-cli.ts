import { connect } from "./client.js";
import { clearTestData, summarizeTestData } from "./clear-test-data.js";

// One-time cleanup before stakeholder testing: npm run db:clear-test-data -w server [-- --confirm]
// Without --confirm it only lists what would be deleted. Do not run it once real authors have books.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to the .env file at the repo root.");
  process.exit(1);
}

const confirm = process.argv.includes("--confirm");
const { db, pool } = connect(databaseUrl);

try {
  console.log(`Database host: ${new URL(databaseUrl).hostname}\n`);
  const summary = await summarizeTestData(db);

  if (summary.books.length === 0 && !summary.demoUser) {
    console.log("Nothing to delete. The database has no books and no demo user.");
  } else {
    console.log("Books to delete (with all their chapters, facts, and events):");
    for (const b of summary.books) {
      console.log(`  ${b.owner}: "${b.title}" - ${b.chapters} chapters, ${b.facts} facts, ${b.events} events`);
    }
    if (summary.books.length === 0) console.log("  (none)");
    console.log(summary.demoUser ? "\nThe old demo user will be deleted." : "\nNo demo user found.");
    console.log("Login accounts are kept.\n");

    if (confirm) {
      await clearTestData(db);
      console.log("Done. Test data cleared.");
    } else {
      console.log("Dry run: nothing was deleted. Run again with --confirm to delete.");
    }
  }
} finally {
  await pool.end();
}
