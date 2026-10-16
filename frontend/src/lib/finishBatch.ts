/** The bookkeeping of the deck's small cards in 샤인 / 로얄 (참혈 2026-10-16), apart from WebGL: which tiles a tick
 *  draws, where each goes in the shared canvas, how often a tick comes, and the textures they share. */

export type BatchTile = { id: number; pixels: number; visible: boolean; ready: boolean };

/** The tiles one tick draws: the visible, ready ones from `cursor` on, round and round, until their pixels would pass
 *  the budget (one at least) — a deck too big for a tick is drawn over a few, each copy a little less often. */
export function pickBatch(tiles: BatchTile[], cursor: number, budget: number): { ids: number[]; next: number } {
  const n = tiles.length;
  const ids: number[] = [];
  let used = 0;
  for (let k = 0; k < n; k++) {
    const i = (cursor + k) % n;
    const t = tiles[i];
    if (!t.visible || !t.ready) continue;
    if (ids.length && used + t.pixels > budget) return { ids, next: i };
    ids.push(t.id);
    used += t.pixels;
  }
  return { ids, next: n ? cursor % n : 0 };
}

/** Each cell's corner in a canvas `maxWidth` wide, row after row (the shared canvas the tiles are drawn in). */
export function packCells(sizes: { w: number; h: number }[], maxWidth: number) {
  const cells: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  let width = 0;
  for (const s of sizes) {
    if (x && x + s.w > maxWidth) {
      y += row;
      x = 0;
      row = 0;
    }
    cells.push({ x, y });
    x += s.w;
    row = Math.max(row, s.h);
    width = Math.max(width, x);
  }
  return { cells, width, height: y + row };
}

/** Whether a frame at `now` is drawn, at `fps` at most: one a little (4 ms) early still is, so a 60 Hz display draws
 *  every other frame, a 120 Hz one every fourth and a 30 Hz one every frame. */
export const due = (now: number, last: number, fps: number) => now - last >= 1000 / fps - 4;

type Entry<T> = { refs: number; made: Promise<T>; value?: T; gone: boolean };

/** Textures by key (a face's or a name's address), made once for every tile using them; one no tile uses is kept
 *  while `keep` such are (a copy taken out and put back, a look switched back), the oldest dropped beyond. */
export class TextureCache<T> {
  private entries = new Map<string, Entry<T>>();
  private idle: string[] = [];

  constructor(private keep: number, private drop: (value: T) => void) {}

  acquire(key: string, make: (key: string) => Promise<T>): Promise<T> {
    let e = this.entries.get(key);
    if (!e) {
      const entry: Entry<T> = { refs: 0, gone: false, made: null! };
      entry.made = make(key).then(
        (v) => {
          entry.value = v;
          if (entry.gone) this.drop(v);
          return v;
        },
        (err) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw err;
        },
      );
      this.entries.set(key, entry);
      e = entry;
    }
    e.refs++;
    this.idle = this.idle.filter((k) => k !== key);
    return e.made;
  }

  release(key: string) {
    const e = this.entries.get(key);
    if (!e || e.refs === 0) return;
    if (--e.refs > 0) return;
    this.idle.push(key);
    while (this.idle.length > this.keep) this.forget(this.idle.shift()!);
  }

  /** Every texture dropped (the context is going). */
  clear() {
    [...this.entries.keys()].forEach((k) => this.forget(k));
    this.idle = [];
  }

  private forget(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    e.gone = true;
    if (e.value !== undefined) this.drop(e.value);
  }
}
