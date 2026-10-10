import { z } from "zod";
import { FactSchema } from "../extraction/prompt.js";

// Every event is validated against these schemas before it is written (NFR4).

const id = z.uuid();
const nonEmpty = z.string().trim().min(1);

export const ChapterAddedData = z.object({
  chapterNumber: z.int().min(1),
  title: nonEmpty.optional(),
  text: nonEmpty,
  sourceFormat: z.enum(["paste", "docx", "md"]),
});

export const FactExtractedData = z.object({
  fact: FactSchema.extend({
    subject: nonEmpty,
    attribute: nonEmpty,
    value: nonEmpty,
    quote: nonEmpty,
  }),
  model: nonEmpty,
});

export const StateChangedData = z.object({
  earlierFactId: id,
  newFactId: id,
  reason: nonEmpty,
});

export const FlagRaisedData = z.object({
  newFactId: id,
  earlierFactId: id,
  explanation: nonEmpty,
});

export const FlagResolvedData = z.object({
  flagId: id,
  resolution: z.enum(["accepted", "dismissed"]),
});

export const ChapterReplacedData = z.object({
  oldChapterId: id,
  newChapterId: id,
});

const envelope = {
  bookId: id,
  chapterId: id.nullable().default(null),
};

export const NewEventSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, chapterId: id, type: z.literal("ChapterAdded"), data: ChapterAddedData }),
  z.object({ ...envelope, chapterId: id, type: z.literal("FactExtracted"), data: FactExtractedData }),
  z.object({ ...envelope, chapterId: id, type: z.literal("StateChanged"), data: StateChangedData }),
  z.object({ ...envelope, chapterId: id, type: z.literal("FlagRaised"), data: FlagRaisedData }),
  z.object({ ...envelope, type: z.literal("FlagResolved"), data: FlagResolvedData }),
  z.object({ ...envelope, chapterId: id, type: z.literal("ChapterReplaced"), data: ChapterReplacedData }),
]);

export type NewEvent = z.input<typeof NewEventSchema>;
export type ValidEvent = z.output<typeof NewEventSchema>;
export type EventType = ValidEvent["type"];
