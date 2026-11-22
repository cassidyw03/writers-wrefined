// Runs the test manuscript through the real pipeline (Claude extraction, Voyage embeddings, Claude checker)
// against a throwaway in-memory database, so the live database is never touched.
// Usage: npm run eval -w server  [-- <manuscript folder>]
// Writes a JSON report next to the manuscript, in results/, for scoring against ANSWER_KEY.md.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { addChapter, createBook, listFlags } from "../chapters/service.js";
import { createClaudeChecker } from "../checking/check.js";
import { MIGRATIONS_FOLDER, type Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { createVoyageEmbedder } from "../embeddings/embed.js";
import { readEvents } from "../events/store.js";
import { createClaudeExtractor } from "../extraction/extract.js";
import { getWorldState } from "../worldstate/service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.resolve(process.argv[2] ?? path.join(here, "../../../eval/test-manuscript"));

const client = new PGlite({ extensions: { vector } });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

const [user] = await db.insert(schema.users).values({ email: "eval@example.invalid", name: "Eval" }).returning();
const book = await createBook(db as unknown as Db, user.id, "The Salt Crown (eval)");

const extract = createClaudeExtractor();
const embed = createVoyageEmbedder();
const check = createClaudeChecker();

const files = (await readdir(folder)).filter((f) => /^ch\d+\.md$/.test(f)).sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)));
const chapters = [];
for (const file of files) {
  const text = await readFile(path.join(folder, file), "utf8");
  const title = text.match(/^#\s+(.+)$/m)?.[1];
  console.log(`Adding ${file}...`);
  const started = Date.now();
  const result = await addChapter(db as unknown as Db, extract, book.id, { title, text, sourceFormat: "md" }, embed, check);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`  ${result.facts.length} facts, check: ${JSON.stringify(result.check)}, ${seconds}s`);
  chapters.push({
    file,
    number: result.chapter.number,
    facts: result.facts.map((f) => ({ type: f.type, subject: f.subject, attribute: f.attribute, value: f.value, quoteFound: f.quoteFound })),
    check: result.check,
    stats: result.stats,
    seconds: Number(seconds),
  });
}

const factById = new Map(
  (await db.select().from(schema.facts)).map((f) => [f.eventId, `ch${f.chapterNumber} ${f.subject} / ${f.attribute} = ${f.value}`]),
);
const events = await readEvents(db as unknown as Db, book.id);
const stateChanges = events
  .filter((e) => e.type === "StateChanged")
  .map((e) => {
    const d = e.data as { newFactId: string; earlierFactId: string; reason: string };
    return { new: factById.get(d.newFactId), earlier: factById.get(d.earlierFactId), reason: d.reason };
  });
const flags = (await listFlags(db as unknown as Db, book.id)).map((f) => ({
  new: `ch${f.newFact.chapterNumber} ${f.newFact.subject} / ${f.newFact.attribute} = ${f.newFact.value}`,
  newQuote: f.newFact.quote,
  earlier: `ch${f.earlierFact.chapterNumber} ${f.earlierFact.subject} / ${f.earlierFact.attribute} = ${f.earlierFact.value}`,
  earlierQuote: f.earlierFact.quote,
  explanation: f.explanation,
}));

const worldState: Record<string, unknown> = {};
for (const n of [2, 3, 5]) {
  const state = await getWorldState(db as unknown as Db, book.id, n);
  worldState[`chapter${n}`] = state.subjects
    .filter((s) => /wren|governor|veyle|seraphine|haskett/i.test(s.name))
    .map((s) => ({ name: s.name, details: s.details.map((d) => `${d.attribute} = ${d.value} (ch${d.chapterNumber})${d.change ? " [changed]" : ""}`) }));
}

const report = { ranAt: new Date().toISOString(), chapters, flags, stateChanges, worldState };
const outDir = path.join(folder, "results");
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `run-${report.ranAt.replace(/[:.]/g, "-")}.json`);
await writeFile(outFile, JSON.stringify(report, null, 2));
console.log(`\n${flags.length} flags, ${stateChanges.length} state changes. Report: ${outFile}`);
await client.close();
