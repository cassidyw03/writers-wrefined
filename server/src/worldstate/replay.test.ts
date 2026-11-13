import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../events/store.js";
import { replayWorldState, type WorldState } from "./replay.js";

// A scripted five-chapter book (FR12's automated test). Mara dyes her hair in chapter 4, so the world state at
// chapter 3 must show the old color and at chapter 5 the new one.
const BOOK = randomUUID();
const CHAPTERS = [1, 2, 3, 4, 5].map(() => randomUUID());

function script() {
  const events: StoredEvent[] = [];
  const add = (chapter: number | null, type: StoredEvent["type"], data: unknown) => {
    const event: StoredEvent = {
      id: randomUUID(),
      bookId: BOOK,
      chapterId: chapter === null ? null : CHAPTERS[chapter - 1],
      sequence: events.length + 1,
      type,
      data,
      createdAt: new Date(),
    };
    events.push(event);
    return event.id;
  };
  const chapter = (n: number) => add(n, "ChapterAdded", { chapterNumber: n, text: `Chapter ${n}`, sourceFormat: "md" });
  const fact = (n: number, type: string, subject: string, attribute: string, value: string) =>
    add(n, "FactExtracted", {
      fact: { type, subject, subject_kind: "character", attribute, value, quote: `${subject} ${attribute} ${value}.` },
      model: "scripted",
    });

  chapter(1);
  const black = fact(1, "attribute", "Mara", "hair color", "black");
  fact(1, "relationship", "Mara", "sister of", "Tomas");
  fact(1, "attribute", "Mara", "also known as", "the Ash Queen");
  fact(1, "event", "Mara", "event", "flees the palace");
  chapter(2);
  fact(2, "knowledge", "Mara", "suspects", "the king is dead");
  const grey = fact(2, "attribute", "Tomas", "eye color", "grey");
  chapter(3);
  fact(3, "attribute", "Mara", "also known as", "Lady Vey");
  chapter(4);
  // Filed under a different attribute name than chapter 1; the state change still replaces the old value.
  const red = fact(4, "attribute", "Mara", "hair", "red");
  add(4, "StateChanged", { earlierFactId: black, newFactId: red, reason: "Mara dyes her hair to hide." });
  fact(4, "knowledge", "mara", "knows", "The king is dead");
  const blue = fact(4, "attribute", "Tomas", "eye color", "blue");
  const raised = add(4, "FlagRaised", { earlierFactId: grey, newFactId: blue, explanation: "Grey in chapter 2, blue in chapter 4." });
  chapter(5);
  fact(5, "attribute", "Mara", "status", "queen");

  const flagId = randomUUID();
  add(4, "FlagResolved", { flagId, resolution: "dismissed" });
  return { events, flagEventIds: new Map([[flagId, raised]]), flagId };
}

const subject = (state: WorldState, name: string) => state.subjects.find((s) => s.name.toLowerCase() === name.toLowerCase());
const detail = (state: WorldState, name: string, attribute: string) =>
  subject(state, name)?.details.find((d) => d.attribute === attribute);

describe("replayWorldState", () => {
  it("shows the old value before the change and nothing from later chapters", () => {
    const { events, flagEventIds } = script();

    const state = replayWorldState(events, 3, flagEventIds);

    expect(state).toMatchObject({ chapterNumber: 3, latestChapter: 5 });
    expect(detail(state, "Mara", "hair color")).toMatchObject({ value: "black", chapterNumber: 1, change: null });
    expect(detail(state, "Mara", "hair")).toBeUndefined();
    expect(detail(state, "Mara", "status")).toBeUndefined();
    expect(detail(state, "Mara", "suspects")?.value).toBe("the king is dead");
    expect(detail(state, "Tomas", "eye color")).toMatchObject({ value: "grey", flags: [] });
  });

  it("shows the new value after the change, with where it came from", () => {
    const { events, flagEventIds } = script();

    const state = replayWorldState(events, 5, flagEventIds);

    expect(detail(state, "Mara", "hair")).toMatchObject({
      value: "red",
      chapterNumber: 4,
      change: { reason: "Mara dyes her hair to hide.", from: "black", fromChapter: 1 },
      history: [{ value: "black", chapterNumber: 1 }],
    });
    expect(detail(state, "Mara", "hair color")).toBeUndefined();
    expect(detail(state, "Mara", "status")?.value).toBe("queen");
  });

  it("keeps every name and relationship, and updates knowledge in place", () => {
    const { events, flagEventIds } = script();

    const mara = subject(replayWorldState(events, 5, flagEventIds), "Mara")!;

    const aliases = mara.details.filter((d) => d.attribute === "also known as").map((d) => d.value);
    expect(aliases).toEqual(["Lady Vey", "the Ash Queen"]);
    expect(mara.details.find((d) => d.type === "relationship")).toMatchObject({ attribute: "sister of", value: "Tomas" });
    const knowledge = mara.details.filter((d) => d.type === "knowledge");
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]).toMatchObject({ attribute: "knows", chapterNumber: 4 });
  });

  it("leaves events out of the world state", () => {
    const { events, flagEventIds } = script();

    const state = replayWorldState(events, 5, flagEventIds);

    expect(state.subjects.flatMap((s) => s.details).some((d) => d.attribute === "event")).toBe(false);
  });

  it("attaches a flag to the newer value with the writer's latest decision", () => {
    const { events, flagEventIds, flagId } = script();

    const eyes = detail(replayWorldState(events, 5, flagEventIds), "Tomas", "eye color")!;

    expect(eyes).toMatchObject({ value: "blue", history: [{ value: "grey", chapterNumber: 2 }] });
    expect(eyes.flags).toEqual([
      { id: flagId, status: "dismissed", explanation: "Grey in chapter 2, blue in chapter 4.", earlierValue: "grey", earlierChapter: 2 },
    ]);
  });

  it("ignores a chapter that a revision replaced", () => {
    const { events, flagEventIds } = script();
    const revised = randomUUID();
    const next = (type: StoredEvent["type"], data: unknown, chapterId: string): StoredEvent => ({
      id: randomUUID(),
      bookId: BOOK,
      chapterId,
      sequence: events.length + 1,
      type,
      data,
      createdAt: new Date(),
    });
    events.push(next("ChapterAdded", { chapterNumber: 5, text: "Chapter 5, revised", sourceFormat: "md" }, revised));
    events.push(next("ChapterReplaced", { oldChapterId: CHAPTERS[4], newChapterId: revised }, revised));
    events.push(
      next(
        "FactExtracted",
        { fact: { type: "attribute", subject: "Mara", subject_kind: "character", attribute: "status", value: "exile", quote: "q" }, model: "m" },
        revised,
      ),
    );

    expect(detail(replayWorldState(events, 5, flagEventIds), "Mara", "status")?.value).toBe("exile");
  });

  it("is empty for a book with no chapters", () => {
    expect(replayWorldState([], 3)).toEqual({ chapterNumber: 3, latestChapter: 0, subjects: [] });
  });
});
