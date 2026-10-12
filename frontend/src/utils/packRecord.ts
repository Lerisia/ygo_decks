/** What a viewer has opened in the pack simulator, kept in this browser only: per pack the gems spent, the URs and SRs
 *  pulled and whether the next ten owe a UR; and every print pulled, for the NEW mark. */
import type { Pity } from "./packDraw";

export type PackTally = { gems: number; packs: number; ur: number; sr: number; pity: Pity };
const KEY = "pack_sim";
const SEEN = "pack_sim_seen";

const read = <T,>(key: string, empty: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? empty;
  } catch {
    return empty;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full: the tally lives for this page only */
  }
};

export const emptyTally = (): PackTally => ({ gems: 0, packs: 0, ur: 0, sr: 0, pity: { owed: false } });

export function tallyOf(packId: number): PackTally {
  return { ...emptyTally(), ...read<Record<string, PackTally>>(KEY, {})[packId] };
}

export function saveTally(packId: number, tally: PackTally) {
  const all = read<Record<string, PackTally>>(KEY, {});
  all[packId] = tally;
  write(KEY, all);
}

export function clearTally(packId: number) {
  const all = read<Record<string, PackTally>>(KEY, {});
  delete all[packId];
  write(KEY, all);
}

/** The prints among these never pulled before (they get NEW), recording them as pulled. */
export function markSeen(prints: number[]): Set<number> {
  const seen = new Set(read<number[]>(SEEN, []));
  const fresh = new Set(prints.filter((p) => !seen.has(p)));
  fresh.forEach((p) => seen.add(p));
  write(SEEN, [...seen]);
  return fresh;
}
