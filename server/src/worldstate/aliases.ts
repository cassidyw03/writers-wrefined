// Claude names the same subject differently from chapter to chapter ("Wren Ashby", then "Wren"; "Lord Aldous
// Haskett", then "Haskett"). Without this, the world state shows them as separate subjects, each with its own
// stale details. This groups the names that clearly mean the same subject.
//
// Two names are merged when they are the same kind (character, place...) and either:
// - an "also known as" fact links them, and both are used as subjects, or
// - every word of the shorter name is in the longer one ("Haskett" -> "Lord Aldous Haskett"), and the longer
//   name is the only possible match. "Ashby" is left alone when both "Wren Ashby" and "Mira Ashby" exist.
// The longer name must add more than a family title: "Heathcliff" and "Mrs. Heathcliff" are different people.
// When in doubt, names stay apart: a split subject is untidy, but a wrong merge mixes two characters' details.

export type SubjectName = { name: string; kind: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Titles that a family shares, so a name that only adds one of these may be a different person.
const FAMILY_TITLES = new Set(["mr", "mrs", "miss", "ms", "master", "mistress", "madam", "young", "old", "little", "elder"]);

const words = (name: string) =>
  norm(name)
    .replace(/^the /, "")
    .split(" ")
    .map((w) => w.replace(/[.,]/g, ""))
    .filter(Boolean);

// Returns a function from any subject name to its group's key, plus each group's display name and other names.
export function groupAliases(names: SubjectName[], alsoKnownAs: { subject: string; alias: string }[]) {
  const byKey = new Map<string, SubjectName>();
  for (const n of names) if (!byKey.has(norm(n.name))) byKey.set(norm(n.name), n);

  const parent = new Map([...byKey.keys()].map((k) => [k, k]));
  const find = (k: string): string => (parent.get(k) === k ? k : find(parent.get(k)!));
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  for (const { subject, alias } of alsoKnownAs) {
    const a = byKey.get(norm(subject));
    const b = byKey.get(norm(alias));
    if (a && b && a.kind === b.kind) union(norm(subject), norm(alias));
  }

  const entries = [...byKey].map(([key, n]) => ({ key, kind: n.kind, words: words(n.name) }));
  for (const short of entries) {
    if (short.words.length === 0) continue;
    const longer = entries.filter(
      (e) =>
        e.key !== short.key &&
        e.kind === short.kind &&
        e.words.length >= short.words.length &&
        short.words.every((w) => e.words.includes(w)) &&
        // Same words except "the" ("crown" and "the crown"), or at least one added word that is not a family title.
        (e.words.length === short.words.length || e.words.some((w) => !short.words.includes(w) && !FAMILY_TITLES.has(w))),
    );
    if (longer.length === 0) continue;
    // Several matches are fine only if they are one name growing longer ("Haskett", "Aldous Haskett",
    // "Lord Aldous Haskett"); otherwise the short name is ambiguous.
    const longest = longer.reduce((a, b) => (b.words.length > a.words.length ? b : a));
    if (longer.every((e) => e.words.every((w) => longest.words.includes(w)))) {
      for (const e of longer) union(short.key, e.key);
    }
  }

  // The fullest name in each group is the one shown.
  const groups = new Map<string, string[]>();
  for (const key of byKey.keys()) groups.set(find(key), [...(groups.get(find(key)) ?? []), key]);
  const display = new Map<string, { name: string; aliases: string[] }>();
  for (const [root, keys] of groups) {
    const ranked = keys
      .map((k) => byKey.get(k)!.name)
      .sort((a, b) => words(b).length - words(a).length || b.length - a.length || a.localeCompare(b));
    display.set(root, { name: ranked[0], aliases: ranked.slice(1) });
  }

  return {
    keyOf: (name: string) => (parent.has(norm(name)) ? find(norm(name)) : norm(name)),
    displayOf: (key: string) => display.get(key),
  };
}
