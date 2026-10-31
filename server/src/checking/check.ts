import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_MODEL } from "../extraction/extract.js";

// The continuity checker: Claude reads the new chapter and decides, for each new fact paired with a similar
// earlier fact, whether the two contradict, whether the story explains the change, or whether they agree.

export type CheckedFact = {
  chapterNumber: number;
  subject: string;
  attribute: string;
  value: string;
  quote: string;
};

export type FactPair = { newFact: CheckedFact; earlierFact: CheckedFact };

export const VERDICTS = ["contradiction", "state_change", "consistent"] as const;

const VerdictSchema = z.object({
  pair: z.int().describe("The pair number from the list"),
  verdict: z.enum(VERDICTS),
  reason: z.string().describe("One sentence for the writer that names both chapter numbers"),
});

export const CheckSchema = z.object({ verdicts: z.array(VerdictSchema) });

export type Verdict = z.infer<typeof VerdictSchema>;

export type CheckResult = {
  verdicts: Verdict[];
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// Takes the new chapter and its fact pairs and returns one verdict per pair, where `pair` is the index into `pairs`.
// Routes receive one of these so tests can swap in a fake.
export type Checker = (chapter: { number: number; text: string }, pairs: FactPair[]) => Promise<CheckResult>;

export const CHECK_PROMPT = `You check a novel for continuity errors.
You get the newest chapter and a numbered list of fact pairs. Each pair is a fact from the newest chapter and a similar fact from an earlier chapter. Give each pair one verdict:

contradiction
- Both facts cannot be true, and the newest chapter gives no in-story reason for the change. This is the author's mistake.
- Example: grey eyes in chapter 1, blue eyes in chapter 4, with nothing said about it.

state_change
- The fact changed, and the newest chapter shows or explains why: she dyed her hair, he was promoted, the ship sank, the character died.
- Also changes that time explains on its own, such as age.

consistent
- The facts agree, add detail to each other, or are about different things, people, or times, so both can be true.

Rules:
- Judge only from the two facts, their quotes, and the newest chapter. Do not use outside knowledge of the book.
- When unsure, choose consistent. A false alarm costs the writer time.
- A character lying, guessing, or being wrong is not a contradiction.
- Return exactly one verdict for every pair, using its pair number.`;

export function createClaudeChecker(model = process.env.CHECK_MODEL ?? DEFAULT_MODEL): Checker {
  const client = new Anthropic();

  return async (chapter, pairs) => {
    const list = pairs.map((p, i) => ({ pair: i + 1, new: p.newFact, earlier: p.earlierFact }));
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      system: CHECK_PROMPT,
      messages: [
        {
          role: "user",
          content: `<chapter number="${chapter.number}">\n${chapter.text}\n</chapter>\n\n<pairs>\n${JSON.stringify(list, null, 1)}\n</pairs>`,
        },
      ],
      output_config: { format: zodOutputFormat(CheckSchema) },
    });

    if (!response.parsed_output) {
      throw new Error(`The continuity check returned no verdicts (stop reason: ${response.stop_reason})`);
    }

    return {
      // Pair numbers in the prompt start at 1; callers index pairs from 0.
      verdicts: response.parsed_output.verdicts.map((v) => ({ ...v, pair: v.pair - 1 })),
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  };
}
