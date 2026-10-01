export type NamedThing = { n: string; c: string; k: string };
export type NameEntry = { name: string; owners: { c: string; k: string }[] };
export type Judgement =
  | { kind: "correct"; key: string; entry: NameEntry }
  | { kind: "repeat"; entry: NameEntry }
  | { kind: "wrong" }
  | { kind: "empty" };

/** What two spellings of a name are compared by: letters and digits only, full-width folded, lower case. */
export function normalizeName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

export function buildNameIndex(things: NamedThing[]): Map<string, NameEntry> {
  const index = new Map<string, NameEntry>();
  for (const t of things) {
    const key = normalizeName(t.n);
    if (!key) continue;
    const entry = index.get(key);
    if (entry) entry.owners.push({ c: t.c, k: t.k });
    else index.set(key, { name: t.n, owners: [{ c: t.c, k: t.k }] });
  }
  return index;
}

export function judgeName(index: Map<string, NameEntry>, used: Set<string>, input: string): Judgement {
  const key = normalizeName(input);
  if (!key) return { kind: "empty" };
  const entry = index.get(key);
  if (!entry) return { kind: "wrong" };
  return used.has(key) ? { kind: "repeat", entry } : { kind: "correct", key, entry };
}
