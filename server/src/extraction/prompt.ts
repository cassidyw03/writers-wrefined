import { z } from "zod";

// Copied from the extraction spike (writers-wrefined-spike/extract.ts, v3 prompt).
// Wired into the API in the LLM extraction milestone (Oct 31).

export const FACT_TYPES = ["attribute", "relationship", "event", "knowledge"] as const;

export const FactSchema = z.object({
  type: z.enum(FACT_TYPES).describe("The kind of fact, as defined in the glossary"),
  subject: z.string().describe("The entity the fact is about, by name, e.g. 'Heathcliff'"),
  subject_kind: z
    .enum(["character", "place", "object", "group"])
    .describe("Animals with names or personalities count as characters"),
  attribute: z
    .string()
    .describe("What aspect of the subject this is, in lowercase, e.g. 'eye color', 'brother of', 'event', 'knows'"),
  value: z
    .string()
    .describe("The value of that aspect. For relationships, the other entity's name only, e.g. 'Catherine Earnshaw'"),
  quote: z.string().describe("The exact sentence from the chapter that states this fact, copied word for word"),
});

export const ExtractionSchema = z.object({
  facts: z.array(FactSchema),
});

export type Fact = z.infer<typeof FactSchema>;

export const SYSTEM_PROMPT = `You extract story facts from fiction chapters for a continuity checker.
A fact is something a later chapter could contradict. The checker compares facts that share the same subject and attribute, so record every fact as subject + attribute + value, and name attributes consistently.

Fact types:

attribute
- A lasting property of one entity: physical appearance, age, personality, occupation, status (such as alive or dead), other names it goes by, or where it is.
- Excludes: temporary moods, feelings, or physical states ("he was pale", "she could not sleep"). Excludes anything that links two named entities; that is a relationship.
- attribute: the property name. Use these when they fit: "eye color", "hair color", "skin", "build", "age", "occupation", "personality", "status", "appearance", "also known as", "setting".
- Example: "a dark-skinned gipsy in aspect" -> subject "Heathcliff", attribute "skin", value "dark-skinned".
- Example: "it lies in a hollow, between two hills" -> subject "Gimmerden Sough chapel", attribute "setting", value "a hollow between two hills, near a swamp".

relationship
- A lasting connection between two named entities: family, marriage, employment, ownership, love, rivalry, friendship, or how two places sit relative to each other.
- Excludes: one-time interactions. Those are events.
- attribute: the relationship, phrased from the subject's side. Use these when they fit: "brother of", "sister of", "son of", "daughter of", "parent of", "wife of", "husband of", "daughter-in-law of", "servant of", "master of", "landlord of", "owner of", "loves", "enemy of", "friend of", "located in", "located near", "distance from".
- value: only the other entity's name. Put any distance or detail in the attribute ("four miles from").
- Example: subject "Hindley", attribute "brother of", value "Catherine Earnshaw".
- Example: subject "Wuthering Heights", attribute "four miles from", value "Thrushcross Grange".

event
- A plot-significant happening: something that changes the story, a character's situation, or a relationship, or that a later chapter is likely to refer back to.
- Excludes: ongoing states (attributes or relationships) and minor actions such as walking into a room, noticing a detail, or finishing a meal.
- attribute: "event". value: what happened, in one short phrase.
- Example: subject "Lockwood", attribute "event", value "sees the ghost of Catherine at the window".

knowledge
- A character learns, knows, suspects, or is clearly unaware of something important: a secret, a hidden identity, a death, a betrayal, a prophecy, a crime, or a revelation that would change how they act.
- Excludes: ordinary knowledge such as someone's name, what a place looks like, household routines, or facts that everyone in the scene already knows. Ask: if this character were later shown acting on this information too early, would a reader call it a mistake? If not, skip it.
- attribute: "knows", "learns", "suspects", or "does not know". value: the information itself, in one short phrase.
- Example: "Only Mara had seen the king's body." -> subject "Mara", attribute "knows", value "the king is dead".
- NOT knowledge: "Heathcliff knows Catherine's name", "Hindley knows his father was buried", "Zillah does not know why the room is unused". These are ordinary or shared information.

Rules:
- Only record facts the text actually states. Do not infer or guess.
- Capture every fact about characters that a later chapter could contradict, including small physical details.
- For objects and places, only record facts likely to matter again in the story. Skip incidental scenery and furniture details.
- Use each entity's name as the subject when the text makes clear who is meant, not "my landlord" or "the narrator".
- Every fact must include the exact quote it came from, copied word for word, including the original punctuation. Do not shorten or join sentences with "...".`;
