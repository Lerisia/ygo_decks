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

export type KeyState = "none" | "part" | "full";
export type ChampionProgress = {
  c: string;
  keys: { k: string; state: KeyState }[];
  got: number;
  total: number;
  complete: boolean;
};

/**
 * What was named, by owner: every owner with at least one name given, finished ones first, then by how many.
 * A key that holds two names (a paired skill) is "part" until both are given.
 */
export function championProgress(things: NamedThing[], used: Set<string>): ChampionProgress[] {
  const byOwner = new Map<string, Map<string, { got: number; total: number }>>();
  for (const t of things) {
    let keys = byOwner.get(t.c);
    if (!keys) byOwner.set(t.c, (keys = new Map()));
    let key = keys.get(t.k);
    if (!key) keys.set(t.k, (key = { got: 0, total: 0 }));
    key.total++;
    if (used.has(normalizeName(t.n))) key.got++;
  }
  const out: ChampionProgress[] = [];
  for (const [c, keys] of byOwner) {
    const list = [...keys.entries()];
    const got = list.reduce((n, [, v]) => n + v.got, 0);
    if (got === 0) continue;
    const total = list.reduce((n, [, v]) => n + v.total, 0);
    out.push({
      c,
      keys: list.map(([k, v]) => ({ k, state: v.got === 0 ? "none" : v.got < v.total ? "part" : "full" })),
      got,
      total,
      complete: got === total,
    });
  }
  return out.sort((a, b) => Number(b.complete) - Number(a.complete) || b.got - a.got || a.c.localeCompare(b.c, "ko"));
}
