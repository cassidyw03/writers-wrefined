import { describe, expect, it } from "vitest";
import { buildTimeline } from "./timeline.js";

const TEXT =
  "Mara fled the palace at dawn. By noon she had reached the river. There she met Tomas. " +
  "That night the king's guards burned the bridge.";

let nextId = 0;
const event = (subject: string, value: string, quote: string) => ({ id: `f${++nextId}`, type: "event", subject, value, quote });

describe("buildTimeline", () => {
  it("orders events by where their quotes appear in the chapter", () => {
    const facts = [
      event("Guards", "burn the bridge", "That night the king's guards burned the bridge."),
      event("Mara", "flees the palace", "Mara fled the palace at dawn."),
      event("Mara", "meets Tomas", "There she met Tomas."),
    ];

    const timeline = buildTimeline(TEXT, facts);

    expect(timeline.map((e) => e.value)).toEqual(["flees the palace", "meets Tomas", "burn the bridge"]);
    expect(timeline.every((e) => e.quoteFound)).toBe(true);
  });

  it("leaves out facts that are not events", () => {
    const facts = [
      { id: "a", type: "attribute", subject: "Mara", value: "black", quote: "Mara fled the palace at dawn." },
      event("Mara", "meets Tomas", "There she met Tomas."),
    ];

    expect(buildTimeline(TEXT, facts).map((e) => e.value)).toEqual(["meets Tomas"]);
  });

  it("keeps an unfound quote right after the event extracted before it, and marks it", () => {
    const facts = [
      event("Mara", "meets Tomas", "There she met Tomas."),
      event("Mara", "swears revenge", "Mara swore she would return."),
      event("Mara", "flees the palace", "Mara fled the palace at dawn."),
    ];

    const timeline = buildTimeline(TEXT, facts);

    expect(timeline.map((e) => [e.value, e.quoteFound])).toEqual([
      ["flees the palace", true],
      ["meets Tomas", true],
      ["swears revenge", false],
    ]);
  });

  it("matches quotes despite curly quotes, line breaks, and a trailing period", () => {
    const text = "He said, “Go.”\nThen the  door\nslammed shut, and she was gone";
    const facts = [
      event("She", "leaves", "she was gone."),
      event("Door", "slams", "Then the door slammed shut"),
    ];

    expect(buildTimeline(text, facts).map((e) => e.value)).toEqual(["slams", "leaves"]);
  });

  it("is empty when the chapter has no events", () => {
    expect(buildTimeline(TEXT, [])).toEqual([]);
  });
});
