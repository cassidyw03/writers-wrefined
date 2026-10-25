import { VoyageAIClient } from "voyageai";
import { EMBEDDING_DIMENSIONS } from "../db/schema.js";

export const DEFAULT_EMBEDDING_MODEL = "voyage-4";

// Voyage accepts at most 128 texts per request.
const BATCH_SIZE = 128;

// "document" for facts being stored, "query" for the text being searched with.
export type InputType = "document" | "query";

// Takes texts and returns one vector per text, in the same order. Routes receive one of these so tests can swap in a fake.
export type Embedder = (texts: string[], inputType: InputType) => Promise<number[][]>;

type FactFields = { subject: string; attribute: string; value: string };

// The text that represents a fact in vector space. Subject and attribute come first so
// "Mara: eye color: grey" lands next to "Mara: eye color: blue", which is the pair the continuity check needs.
export function factText(fact: FactFields) {
  return `${fact.subject}: ${fact.attribute}: ${fact.value}`;
}

export function createVoyageEmbedder(model = process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL): Embedder {
  const client = new VoyageAIClient();

  return async (texts, inputType) => {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const response = await client.embed({
        input: texts.slice(start, start + BATCH_SIZE),
        model,
        inputType,
        outputDimension: EMBEDDING_DIMENSIONS,
      });
      const data = [...(response.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const item of data) {
        if (item.embedding?.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`Voyage returned a vector of length ${item.embedding?.length}, expected ${EMBEDDING_DIMENSIONS}`);
        }
        vectors.push(item.embedding);
      }
    }
    if (vectors.length !== texts.length) {
      throw new Error(`Voyage returned ${vectors.length} vectors for ${texts.length} texts`);
    }
    return vectors;
  };
}
