import { describe, expect, it } from "vitest";
import { type Pools, type Rarity, drawTen, drawPack, newPity, RATES } from "./packDraw";

const pool = (tag: string): Pools<string>["main"] => ({
  N: [`${tag}-N`], R: [`${tag}-R`], SR: [`${tag}-SR`], UR: [`${tag}-UR`],
});
const normal: Pools<string> = { main: pool("m") };
const secret: Pools<string> = { main: pool("pick"), master: pool("master") };

/** Each card asks the random source three times: its rarity, its finish, then which card. This one lands every card
 *  on one rarity band of its slot's table, a basic finish and the first card. */
const BAND: Record<Rarity, number> = { UR: 0.001, SR: 0.05, R: 0.3, N: 0.99 };
const cycle = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};
const always = (r: Rarity) => cycle(BAND[r], 0.99, 0);
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("drawPack", () => {
  it("gives eight cards, the eighth R or higher", () => {
    const cards = drawPack(normal, { rng: always("N") });
    expect(cards).toHaveLength(8);
    expect(cards.slice(0, 7).every((c) => c.rarity === "N")).toBe(true);
    expect(cards[7].rarity).toBe("R");
  });

  it("draws a secret pack's first four from the master pack and the rest from its pickup", () => {
    const cards = drawPack(secret, { rng: always("SR") });
    expect(cards.map((c) => c.card)).toEqual([...Array(4).fill("master-SR"), ...Array(4).fill("pick-SR")]);
  });

  it("skips a rarity the pack does not hold", () => {
    const thin: Pools<string> = { main: { N: [], R: ["r"], SR: ["sr"], UR: [] } };
    const cards = drawPack(thin, { rng: always("N") });
    expect(cards.every((c) => c.rarity !== "N" && c.rarity !== "UR")).toBe(true);
  });

  it("matches the published odds", () => {
    const rng = mulberry32(42);
    const count = { N: 0, R: 0, SR: 0, UR: 0 } as Record<Rarity, number>;
    const finish = { basic: 0, shine: 0, royal: 0 };
    const packs = 40000;
    for (let i = 0; i < packs; i++) {
      for (const c of drawPack(normal, { rng }).slice(0, 7)) {
        count[c.rarity]++;
        finish[c.finish]++;
      }
    }
    const n = packs * 7;
    for (const r of ["N", "R", "SR", "UR"] as Rarity[]) expect(count[r] / n).toBeCloseTo(RATES.slot[r], 2);
    expect(finish.shine / n).toBeCloseTo(0.9 * 0.1 + 0.1 * 0.09, 2);
    expect(finish.royal / n).toBeCloseTo(0.1 * 0.01, 3);
  });

  it("gives royal to SR and UR only", () => {
    // the rarest finish every time
    expect(drawPack(normal, { rng: cycle(BAND.N, 0.0001, 0) }).map((c) => c.finish)).toEqual(Array(8).fill("shine"));
    expect(drawPack(normal, { rng: cycle(BAND.UR, 0.0001, 0) }).map((c) => c.finish)).toEqual(Array(8).fill("royal"));
  });
});

describe("drawTen", () => {
  it("makes the tenth pack's eighth card SR or higher", () => {
    const { packs } = drawTen(normal, newPity(), { rng: always("N") });
    expect(packs).toHaveLength(10);
    expect(packs.slice(0, 9).every((p) => p[7].rarity === "R")).toBe(true);
    expect(packs[9][7].rarity).toBe("SR");
  });

  it("gives a UR in the next ten after ten without one", () => {
    const first = drawTen(normal, newPity(), { rng: always("N") });
    expect(first.pity.owed).toBe(true);
    const second = drawTen(normal, first.pity, { rng: always("N") });
    expect(second.packs[9][7].rarity).toBe("UR");
    expect(second.pity.owed).toBe(false);
  });

  it("owes nothing after ten with a UR", () => {
    expect(drawTen(normal, newPity(), { rng: always("UR") }).pity.owed).toBe(false);
  });

  it("gives a secret pack's guaranteed cards from its pickup", () => {
    const { packs } = drawTen(secret, { owed: true }, { rng: always("N") });
    expect(packs[9][7].card).toBe("pick-UR");
  });
});
