import { describe, expect, it } from "vitest";
import { FactSchema } from "./prompt.js";

const validFact = {
  type: "attribute",
  subject: "Heathcliff",
  subject_kind: "character",
  attribute: "skin",
  value: "dark-skinned",
  quote: "He is a dark-skinned gipsy in aspect, in dress and manners a gentleman.",
};

describe("FactSchema", () => {
  it("accepts a complete fact", () => {
    expect(FactSchema.safeParse(validFact).success).toBe(true);
  });

  it("rejects a fact with no quote", () => {
    const { quote: _quote, ...noQuote } = validFact;
    expect(FactSchema.safeParse(noQuote).success).toBe(false);
  });

  it("rejects an unknown fact type", () => {
    expect(FactSchema.safeParse({ ...validFact, type: "opinion" }).success).toBe(false);
  });
});
