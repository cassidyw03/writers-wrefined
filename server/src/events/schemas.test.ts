import { describe, expect, it } from "vitest";
import { NewEventSchema } from "./schemas.js";

const bookId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const chapterId = "16fd2706-8baf-433b-82eb-8c7fada847da";

const factExtracted = {
  type: "FactExtracted",
  bookId,
  chapterId,
  data: {
    model: "claude-sonnet-5",
    fact: {
      type: "attribute",
      subject: "Heathcliff",
      subject_kind: "character",
      attribute: "skin",
      value: "dark-skinned",
      quote: "He is a dark-skinned gipsy in aspect, in dress and manners a gentleman.",
    },
  },
};

describe("NewEventSchema", () => {
  it("accepts a valid FactExtracted event", () => {
    expect(NewEventSchema.safeParse(factExtracted).success).toBe(true);
  });

  it("rejects a fact with an empty quote", () => {
    const event = { ...factExtracted, data: { ...factExtracted.data, fact: { ...factExtracted.data.fact, quote: "  " } } };
    expect(NewEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects an unknown event type", () => {
    expect(NewEventSchema.safeParse({ ...factExtracted, type: "FactEdited" }).success).toBe(false);
  });

  it("requires a chapter for chapter events", () => {
    const { chapterId: _chapterId, ...noChapter } = factExtracted;
    expect(NewEventSchema.safeParse(noChapter).success).toBe(false);
  });

  it("allows FlagResolved without a chapter", () => {
    const event = {
      type: "FlagResolved",
      bookId,
      data: { flagId: "a3bb189e-8bf9-3888-9912-ace4e6543002", resolution: "dismissed" },
    };
    const result = NewEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    expect(result.data?.chapterId).toBeNull();
  });

  it("rejects a chapter number below 1", () => {
    const event = {
      type: "ChapterAdded",
      bookId,
      chapterId,
      data: { chapterNumber: 0, text: "It was a dark and stormy night.", sourceFormat: "paste" },
    };
    expect(NewEventSchema.safeParse(event).success).toBe(false);
  });
});
