import type { StoredEvent } from "../events/store.js";

// World state as of chapter N (FR12): what is true about every subject after chapters 1 to N, built by replaying
// the book's events in story order. Nothing here reads the facts table; the events are the source of truth.
//
// How each fact type replays:
// - attribute: one value per subject + attribute; a later chapter replaces it and the old value goes into history.
//   "also known as" is the exception: a character can have several names, so each one is kept.
// - relationship: each one is kept (Hindley can be brother of more than one person).
// - knowledge: one entry per piece of information, so "suspects X" then "knows X" updates the same entry.
// - event: left out. Events are what happened, not what is true; they belong to the timeline (FR13).
// - StateChanged: the new fact is an explained change. It replaces the earlier fact even when the attributes are
//   named differently ("hair" vs "hair color").
// - FlagRaised / FlagResolved: the flag is attached to the newer fact, with its latest status.

export type FactType = "attribute" | "relationship" | "event" | "knowledge";
export type SubjectKind = "character" | "place" | "object" | "group";
export type FlagStatus = "open" | "accepted" | "dismissed";

export type WorldDetail = {
  factId: string;
  type: Exclude<FactType, "event">;
  attribute: string;
  value: string;
  quote: string;
  chapterNumber: number;
  // Earlier values this one replaced, oldest first.
  history: { value: string; chapterNumber: number }[];
  // Set when the story explains the change (a StateChanged event).
  change: { reason: string; from: string; fromChapter: number } | null;
  flags: { id: string | null; status: FlagStatus; explanation: string; earlierValue: string; earlierChapter: number }[];
};

export type WorldSubject = {
  name: string;
  kind: SubjectKind;
  details: WorldDetail[];
};

export type WorldState = {
  chapterNumber: number;
  // The highest chapter number in the book, so a view can offer chapters 1 to latestChapter.
  latestChapter: number;
  subjects: WorldSubject[];
};

type FactData = {
  fact: { type: FactType; subject: string; subject_kind: SubjectKind; attribute: string; value: string; quote: string };
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Which entry a fact lands in. Facts with the same key replace each other; different keys sit side by side.
function detailKey(type: FactType, attribute: string, value: string) {
  if (type === "attribute" && norm(attribute) !== "also known as") return `attribute|${norm(attribute)}`;
  if (type === "knowledge") return `knowledge|${norm(value)}`;
  return `${type}|${norm(attribute)}|${norm(value)}`;
}

const KIND_ORDER: SubjectKind[] = ["character", "place", "object", "group"];
const TYPE_ORDER: WorldDetail["type"][] = ["attribute", "relationship", "knowledge"];

// events: one book's events, as readEvents returns them.
// flagEventIds: flag id -> id of the FlagRaised event that created it. FlagResolved events name the flag by its id
// in the flags table, so this is needed to connect a resolution to the flag it resolves.
export function replayWorldState(
  events: StoredEvent[],
  chapterNumber: number,
  flagEventIds: Map<string, string> = new Map(),
): WorldState {
  // Pass 1: chapter numbers, and chapters a revision has replaced (their events no longer count).
  const chapterNumbers = new Map<string, number>();
  const replaced = new Set<string>();
  for (const e of events) {
    if (e.type === "ChapterAdded" && e.chapterId) {
      chapterNumbers.set(e.chapterId, (e.data as { chapterNumber: number }).chapterNumber);
    } else if (e.type === "ChapterReplaced") {
      replaced.add((e.data as { oldChapterId: string }).oldChapterId);
    }
  }
  const latestChapter = Math.max(
    0,
    ...[...chapterNumbers].filter(([id]) => !replaced.has(id)).map(([, n]) => n),
  );

  // Story order: by chapter, then by the order events were written. A revised chapter added later still slots
  // into its own chapter's place.
  const inStory = events
    .filter((e) => e.chapterId && !replaced.has(e.chapterId) && (chapterNumbers.get(e.chapterId) ?? Infinity) <= chapterNumber)
    .sort((a, b) => chapterNumbers.get(a.chapterId!)! - chapterNumbers.get(b.chapterId!)! || a.sequence - b.sequence);

  const subjects = new Map<string, { name: string; kind: SubjectKind; details: Map<string, WorldDetail> }>();
  // Where each fact currently lives, so StateChanged and FlagRaised can find it.
  const factHome = new Map<string, { subject: string; key: string }>();
  const facts = new Map<string, { value: string; chapterNumber: number }>();
  const flagsByEvent = new Map<string, WorldDetail["flags"][number]>();

  const detailOf = (factId: string) => {
    const home = factHome.get(factId);
    const detail = home && subjects.get(home.subject)?.details.get(home.key);
    return detail?.factId === factId ? detail : undefined;
  };

  for (const e of inStory) {
    const n = chapterNumbers.get(e.chapterId!)!;
    if (e.type === "FactExtracted") {
      const { fact } = e.data as FactData;
      facts.set(e.id, { value: fact.value, chapterNumber: n });
      if (fact.type === "event") continue;

      const subjectKey = norm(fact.subject);
      const subject = subjects.get(subjectKey) ?? { name: fact.subject, kind: fact.subject_kind, details: new Map() };
      subject.name = fact.subject;
      subjects.set(subjectKey, subject);

      const key = detailKey(fact.type, fact.attribute, fact.value);
      const earlier = subject.details.get(key);
      const history = earlier
        ? norm(earlier.value) === norm(fact.value)
          ? earlier.history
          : [...earlier.history, { value: earlier.value, chapterNumber: earlier.chapterNumber }]
        : [];
      subject.details.set(key, {
        factId: e.id,
        type: fact.type,
        attribute: fact.attribute,
        value: fact.value,
        quote: fact.quote,
        chapterNumber: n,
        history,
        change: null,
        flags: [],
      });
      factHome.set(e.id, { subject: subjectKey, key });
    } else if (e.type === "StateChanged") {
      const { earlierFactId, newFactId, reason } = e.data as { earlierFactId: string; newFactId: string; reason: string };
      const detail = detailOf(newFactId);
      const before = facts.get(earlierFactId);
      if (!detail || !before) continue;
      detail.change = { reason, from: before.value, fromChapter: before.chapterNumber };
      // The new value supersedes the earlier one, even if it was filed under a different attribute name.
      const old = detailOf(earlierFactId);
      if (old && old !== detail) {
        const home = factHome.get(earlierFactId)!;
        subjects.get(home.subject)?.details.delete(home.key);
        detail.history = [...old.history, { value: old.value, chapterNumber: old.chapterNumber }, ...detail.history];
      }
    } else if (e.type === "FlagRaised") {
      const { earlierFactId, newFactId, explanation } = e.data as {
        earlierFactId: string;
        newFactId: string;
        explanation: string;
      };
      const detail = detailOf(newFactId);
      const before = facts.get(earlierFactId);
      if (!detail || !before) continue;
      const flag = { id: null, status: "open" as FlagStatus, explanation, earlierValue: before.value, earlierChapter: before.chapterNumber };
      detail.flags.push(flag);
      flagsByEvent.set(e.id, flag);
    }
  }

  // A writer's decision on a flag is not part of the story's order, so the latest one counts whatever N is.
  for (const [flagId, eventId] of flagEventIds) {
    const flag = flagsByEvent.get(eventId);
    if (flag) flag.id = flagId;
  }
  for (const e of events) {
    if (e.type !== "FlagResolved") continue;
    const { flagId, resolution } = e.data as { flagId: string; resolution: FlagStatus };
    const flag = flagsByEvent.get(flagEventIds.get(flagId) ?? "");
    if (flag) flag.status = resolution;
  }

  return {
    chapterNumber,
    latestChapter,
    subjects: [...subjects.values()]
      .filter((s) => s.details.size > 0)
      .map((s) => ({
        name: s.name,
        kind: s.kind,
        details: [...s.details.values()].sort(
          (a, b) =>
            TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
            a.attribute.localeCompare(b.attribute) ||
            a.value.localeCompare(b.value),
        ),
      }))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)),
  };
}
