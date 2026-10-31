import { readFile, writeFile } from "node:fs/promises";
import { createClaudeExtractor, quoteFound } from "./extract.js";

// Runs extraction on one chapter file outside the app, for checking prompt changes:
// npm run extract -w server "--" <chapter.md> [output.json]
// Calls the real Claude API, so each run costs a little.

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error("Usage: npm run extract -w server -- <chapter.md> [output.json]");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to the .env file at the repo root.");
  process.exit(1);
}

const text = await readFile(inputPath, "utf8");
const started = Date.now();
const result = await createClaudeExtractor()(text);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const counts = new Map<string, number>();
for (const fact of result.facts) counts.set(fact.subject, (counts.get(fact.subject) ?? 0) + 1);
const missingQuotes = result.facts.filter((f) => !quoteFound(text, f.quote)).length;

console.log(`${result.facts.length} facts from ${result.model} in ${seconds}s (${result.inputTokens} in / ${result.outputTokens} out tokens)`);
console.log(`Quotes not found in the chapter: ${missingQuotes}\n`);
console.log("Facts per subject:");
for (const [subject, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${subject}: ${n}`);

if (outputPath) {
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nSaved to ${outputPath}`);
}
