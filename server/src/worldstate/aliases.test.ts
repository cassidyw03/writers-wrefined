import { describe, expect, it } from "vitest";
import { groupAliases } from "./aliases.js";

const people = (...names: string[]) => names.map((name) => ({ name, kind: "character" }));

const sameGroup = (g: ReturnType<typeof groupAliases>, a: string, b: string) => g.keyOf(a) === g.keyOf(b);

describe("groupAliases", () => {
  it("merges a short name into the one longer name that contains it", () => {
    const g = groupAliases(people("Wren Ashby", "Wren", "Orrin Vael", "Orrin"), []);
    expect(sameGroup(g, "Wren", "Wren Ashby")).toBe(true);
    expect(sameGroup(g, "Orrin", "Orrin Vael")).toBe(true);
    expect(sameGroup(g, "Wren", "Orrin")).toBe(false);
  });

  it("shows the fullest name, with the others as aliases", () => {
    const g = groupAliases(people("Haskett", "Lord Aldous Haskett", "Aldous Haskett"), []);
    expect(g.displayOf(g.keyOf("haskett"))).toEqual({ name: "Lord Aldous Haskett", aliases: ["Aldous Haskett", "Haskett"] });
  });

  it("keeps titles that are part of a name, like Lady and Brother", () => {
    const g = groupAliases(people("Lady Seraphine", "Lady Seraphine Dorr", "Edric", "Brother Edric"), []);
    expect(sameGroup(g, "Lady Seraphine", "Lady Seraphine Dorr")).toBe(true);
    expect(sameGroup(g, "Edric", "Brother Edric")).toBe(true);
  });

  it("leaves a name alone when it could mean two people", () => {
    const g = groupAliases(people("Wren Ashby", "Mira Ashby", "Ashby"), []);
    expect(sameGroup(g, "Ashby", "Wren Ashby")).toBe(false);
    expect(sameGroup(g, "Ashby", "Mira Ashby")).toBe(false);
    expect(sameGroup(g, "Wren Ashby", "Mira Ashby")).toBe(false);
  });

  it("does not merge across a family title", () => {
    const g = groupAliases(people("Heathcliff", "Mrs. Heathcliff", "Earnshaw", "Mr. Earnshaw"), []);
    expect(sameGroup(g, "Heathcliff", "Mrs. Heathcliff")).toBe(false);
    expect(sameGroup(g, "Earnshaw", "Mr. Earnshaw")).toBe(false);
  });

  it("does not merge Catherine into either Catherine", () => {
    const g = groupAliases(people("Catherine", "Catherine Earnshaw", "Catherine Linton"), []);
    expect(sameGroup(g, "Catherine", "Catherine Earnshaw")).toBe(false);
    expect(sameGroup(g, "Catherine", "Catherine Linton")).toBe(false);
  });

  it("ignores a leading 'the' and needs the same kind", () => {
    const g = groupAliases(
      [
        { name: "Salt Crown", kind: "object" },
        { name: "the crown", kind: "object" },
        { name: "Wren", kind: "character" },
        { name: "Wren's dagger", kind: "object" },
        { name: "Veyle", kind: "place" },
        { name: "Veyle", kind: "group" },
      ],
      [],
    );
    expect(sameGroup(g, "the crown", "Salt Crown")).toBe(true);
    expect(sameGroup(g, "Wren", "Wren's dagger")).toBe(false);
  });

  it("merges names linked by an also known as fact", () => {
    const g = groupAliases(people("Mara", "the Ash Queen"), [{ subject: "Mara", alias: "the Ash Queen" }]);
    expect(sameGroup(g, "Mara", "the Ash Queen")).toBe(true);
  });

  it("ignores an also known as value that is never used as a subject", () => {
    const g = groupAliases(people("Mara"), [{ subject: "Mara", alias: "Lady Vey" }]);
    expect(g.keyOf("Lady Vey")).not.toBe(g.keyOf("Mara"));
  });
});
