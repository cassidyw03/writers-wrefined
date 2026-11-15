import { quotePosition } from "../extraction/extract.js";

// A chapter's timeline (FR13): its event facts in the order they happen in the text.
// The order comes from where each event's quote sits in the chapter, so it needs no extra Claude call.
// An event whose quote is not in the text keeps its place in extraction order, right after the event
// extracted before it, and is marked so the writer knows its position is a guess.

type EventFact = { id: string; type: string; subject: string; value: string; quote: string };

export type TimelineEntry = {
  id: string;
  subject: string;
  value: string;
  quote: string;
  quoteFound: boolean;
};

// facts: the chapter's facts in extraction order. Only the "event" facts are used.
export function buildTimeline(chapterText: string, facts: EventFact[]): TimelineEntry[] {
  let lastPosition = -1;
  const placed = facts
    .filter((f) => f.type === "event")
    .map((f, order) => {
      const found = quotePosition(chapterText, f.quote);
      if (found >= 0) lastPosition = found;
      // Unfound quotes borrow the position of the event before them; `order` breaks the tie.
      return { fact: f, found: found >= 0, position: found >= 0 ? found : lastPosition, order };
    });

  return placed
    .sort((a, b) => a.position - b.position || a.order - b.order)
    .map(({ fact, found }) => ({ id: fact.id, subject: fact.subject, value: fact.value, quote: fact.quote, quoteFound: found }));
}
