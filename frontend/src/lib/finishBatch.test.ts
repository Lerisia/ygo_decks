import { describe, expect, it, vi } from "vitest";
import { TextureCache, due, packCells, pickBatch } from "./finishBatch";

describe("pickBatch", () => {
  const tile = (id: number, pixels = 100, visible = true, ready = true) => ({ id, pixels, visible, ready });

  it("draws every visible ready tile while they fit the budget", () => {
    const { ids, next } = pickBatch([tile(1), tile(2, 100, false), tile(3, 100, true, false), tile(4)], 0, 1000);
    expect(ids).toEqual([1, 4]);
    expect(next).toBe(0);
  });

  it("splits a deck over the budget across ticks, going on where the last stopped", () => {
    const tiles = [1, 2, 3, 4, 5].map((id) => tile(id));
    const first = pickBatch(tiles, 0, 250);
    expect(first.ids).toEqual([1, 2]);
    const second = pickBatch(tiles, first.next, 250);
    expect(second.ids).toEqual([3, 4]);
    const third = pickBatch(tiles, second.next, 250);
    expect(third.ids).toEqual([5, 1]);
  });

  it("always draws one, however big", () => {
    expect(pickBatch([tile(1, 5000), tile(2)], 0, 1000).ids).toEqual([1]);
  });

  it("draws nothing when no tile is due", () => {
    expect(pickBatch([tile(1, 100, false), tile(2, 100, false)], 1, 1000)).toEqual({ ids: [], next: 1 });
  });
});

describe("packCells", () => {
  it("lays cells out in rows no wider than the atlas, none overlapping", () => {
    const sizes = [{ w: 120, h: 174 }, { w: 120, h: 174 }, { w: 168, h: 244 }, { w: 120, h: 174 }];
    const { cells, width, height } = packCells(sizes, 300);
    expect(cells).toHaveLength(4);
    cells.forEach((c, i) => {
      expect(c.x + sizes[i].w).toBeLessThanOrEqual(300);
      cells.forEach((d, j) => {
        if (i === j) return;
        const apart = c.x + sizes[i].w <= d.x || d.x + sizes[j].w <= c.x || c.y + sizes[i].h <= d.y || d.y + sizes[j].h <= c.y;
        expect(apart).toBe(true);
      });
    });
    expect(width).toBeLessThanOrEqual(300);
    expect(height).toBe(174 + 244);   // two of the first size, then the big one and the last
  });

  it("puts what fits in one row side by side", () => {
    const { cells, width, height } = packCells([{ w: 10, h: 20 }, { w: 10, h: 30 }], 100);
    expect(cells).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect([width, height]).toEqual([20, 30]);
  });
});

describe("due", () => {
  it("lets about 30 frames a second through a 60 Hz display", () => {
    let last = 0;
    let drawn = 0;
    for (let k = 1; k <= 60; k++) {
      const now = k * (1000 / 60);
      if (due(now, last, 30)) {
        drawn++;
        last = now;
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(29);
    expect(drawn).toBeLessThanOrEqual(31);
  });

  it("keeps to 30 on a 120 Hz display too", () => {
    let last = 0;
    let drawn = 0;
    for (let k = 1; k <= 120; k++) {
      const now = k * (1000 / 120);
      if (due(now, last, 30)) {
        drawn++;
        last = now;
      }
    }
    expect(drawn).toBe(30);
  });

  it("draws every frame of a 30 Hz display", () => {
    let last = 0;
    let drawn = 0;
    for (let k = 1; k <= 30; k++) {
      const now = k * (1000 / 30) + (k % 2 ? 1 : -1);   // a little jitter
      if (due(now, last, 30)) {
        drawn++;
        last = now;
      }
    }
    expect(drawn).toBe(30);
  });
});

describe("TextureCache", () => {
  const setup = (keep = 2) => {
    const dropped: string[] = [];
    const make = vi.fn(async (key: string) => `tex:${key}`);
    const cache = new TextureCache<string>(keep, (t) => dropped.push(t));
    return { cache, make, dropped };
  };

  it("makes a texture once for every tile asking for it", async () => {
    const { cache, make } = setup();
    const [a, b] = await Promise.all([cache.acquire("face1", make), cache.acquire("face1", make)]);
    expect([a, b]).toEqual(["tex:face1", "tex:face1"]);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("keeps a few no tile uses for a while, dropping the oldest beyond them", async () => {
    const { cache, make, dropped } = setup(2);
    for (const k of ["a", "b", "c"]) await cache.acquire(k, make);
    cache.release("a");
    cache.release("b");
    expect(dropped).toEqual([]);
    cache.release("c");
    expect(dropped).toEqual(["tex:a"]);
    // one kept is taken up again without being made
    await cache.acquire("b", make);
    expect(make).toHaveBeenCalledTimes(3);
  });

  it("never drops one in use", async () => {
    const { cache, make, dropped } = setup(0);
    await cache.acquire("a", make);
    await cache.acquire("a", make);
    cache.release("a");
    expect(dropped).toEqual([]);
    cache.release("a");
    expect(dropped).toEqual(["tex:a"]);
  });

  it("forgets a texture that failed, so it is asked again", async () => {
    const { cache } = setup();
    const bad = vi.fn(async () => { throw new Error("404"); });
    await expect(cache.acquire("a", bad)).rejects.toThrow("404");
    const good = vi.fn(async () => "tex:a");
    await expect(cache.acquire("a", good)).resolves.toBe("tex:a");
  });

  it("drops everything at once when the context goes", async () => {
    const { cache, make, dropped } = setup();
    await cache.acquire("a", make);
    await cache.acquire("b", make);
    cache.release("b");
    cache.clear();
    expect(dropped.sort()).toEqual(["tex:a", "tex:b"]);
  });
});
