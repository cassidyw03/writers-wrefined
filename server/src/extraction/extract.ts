import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractionSchema, SYSTEM_PROMPT, type Fact } from "./prompt.js";

// Sonnet 5 was the best fit in the spike; set EXTRACTION_MODEL to compare others (e.g. claude-opus-5-5).
export const DEFAULT_MODEL = "claude-sonnet-5";

export type ExtractionResult = {
  facts: Fact[];
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// Takes chapter text and returns its facts. Routes receive one of these so tests can swap in a fake.
export type Extractor = (chapterText: string) => Promise<ExtractionResult>;

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export function createClaudeExtractor(model = process.env.EXTRACTION_MODEL ?? DEFAULT_MODEL): Extractor {
  const client = new Anthropic();

  return async (chapterText) => {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: chapterText }],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });

    if (response.stop_reason === "refusal") {
      throw new ExtractionError(`The model declined: ${response.stop_details?.explanation ?? "no reason given"}`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new ExtractionError("The output was cut off. Try a shorter chapter.");
    }
    if (!response.parsed_output) {
      throw new ExtractionError("The model's response did not match the fact schema.");
    }

    return {
      facts: response.parsed_output.facts,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  };
}

// Quote marks and _italics_ underscores are ignored so curly vs straight quotes don't count as a mismatch.
const normalize = (s: string) => s.replace(/[“”"‘’'_]/g, "").replace(/\s+/g, " ").trim();

// True when the fact's quote really appears in the chapter (catches invented quotes).
export function quoteFound(chapterText: string, quote: string): boolean {
  return normalize(chapterText).includes(normalize(quote));
}
