import { describe, expect, it } from "vitest";
import { quoteFound } from "./extract.js";

const chapter = `Hareton Earnshaw was performing his orison _sotto voce_, in a series of
curses directed against every object he touched, while he rummaged a corner.`;

describe("quoteFound", () => {
  it("finds a quote across line breaks, italics, and curly quotes", () => {
    expect(quoteFound(chapter, "performing his orison sotto voce, in a series of curses")).toBe(true);
  });

  it("finds a partial sentence that Claude ended with a period", () => {
    expect(quoteFound(chapter, "in a series of curses directed against every object he touched.")).toBe(true);
  });

  it("rejects a quote with words that are not in the chapter", () => {
    expect(quoteFound(chapter, "in a series of curses directed against everyone he met.")).toBe(false);
  });
});
