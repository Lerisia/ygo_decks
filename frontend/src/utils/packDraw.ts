/** Master Duel's pack odds (엘리스 2026-10-12, the pack simulator). The rules are the game's own 제공 확률 text: eight
 *  cards a pack, the eighth R or higher; in ten bought at once the tenth pack's eighth card is SR or higher, and ten
 *  without a UR make the next ten of that pack give one there. A secret pack's first four come from the master pack,
 *  the rest from its pickup cards. The rates are the ones the game shows (the client leaves them to its server; 엘리스
 *  confirmed them). Each card's finish is drawn apart; royal comes to SR and UR only. */

export type Rarity = "N" | "R" | "SR" | "UR";
export type Finish = "basic" | "shine" | "royal";
export type Pool<T> = Record<Rarity, T[]>;
/** main: the pack's own cards (a secret pack's pickup); master: the master pack's, for a secret pack's first four. */
export type Pools<T> = { main: Pool<T>; master?: Pool<T> };
export type Pulled<T> = { card: T; rarity: Rarity; finish: Finish };
export type Pity = { owed: boolean };
type Odds = Partial<Record<Rarity, number>>;

export const RATES = {
  slot: { UR: 0.025, SR: 0.075, R: 0.35, N: 0.55 } as Odds,          // cards 1–7
  eighth: { UR: 0.025, SR: 0.075, R: 0.9 } as Odds,                    // card 8: R or higher
  tenth: { UR: 0.2, SR: 0.8 } as Odds,                                 // card 8 of the tenth of ten: SR or higher
  owed: { UR: 1 } as Odds,                                             // after ten without a UR
  finish: { high: { royal: 0.01, shine: 0.09 }, low: { royal: 0, shine: 0.1 } }, // SR / UR, and R / N
};
export const PACK_SIZE = 8;
export const GEMS_PER_PACK = 100;
const ORDER: Rarity[] = ["UR", "SR", "R", "N"];

export const newPity = (): Pity => ({ owed: false });

/** A rarity by the slot's odds, over the rarities the pool holds (a pack without N, say, spreads N's share). */
function rarityOf<T>(odds: Odds, pool: Pool<T>, x: number): Rarity {
  const have = ORDER.filter((r) => odds[r] && pool[r].length);
  const shown = have.length ? have : ORDER.filter((r) => pool[r].length);
  const total = shown.reduce((s, r) => s + (odds[r] ?? 1), 0);
  let at = 0;
  for (const r of shown) {
    at += (odds[r] ?? 1) / total;
    if (x < at) return r;
  }
  return shown[shown.length - 1];
}

function finishOf(rarity: Rarity, x: number): Finish {
  const f = rarity === "SR" || rarity === "UR" ? RATES.finish.high : RATES.finish.low;
  if (x < f.royal) return "royal";
  return x < f.royal + f.shine ? "shine" : "basic";
}

function pull<T>(pool: Pool<T>, odds: Odds, rng: () => number): Pulled<T> {
  const rarity = rarityOf(odds, pool, rng());
  const finish = finishOf(rarity, rng());
  const cards = pool[rarity];
  return { card: cards[Math.min(cards.length - 1, Math.floor(rng() * cards.length))], rarity, finish };
}

/** One pack; `last` sets the eighth card's odds (the tenth of ten, or the one owed a UR). */
export function drawPack<T>(pools: Pools<T>, { rng = Math.random, last = RATES.eighth }: { rng?: () => number; last?: Odds } = {}): Pulled<T>[] {
  const out: Pulled<T>[] = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const pool = pools.master && i < 4 ? pools.master : pools.main;
    out.push(pull(pool, i === PACK_SIZE - 1 ? last : RATES.slot, rng));
  }
  return out;
}

/** Ten bought at once, and what the next ten of this pack are owed. */
export function drawTen<T>(pools: Pools<T>, pity: Pity, { rng = Math.random }: { rng?: () => number } = {}) {
  const packs = Array.from({ length: 10 }, (_, i) =>
    drawPack(pools, { rng, last: i < 9 ? RATES.eighth : pity.owed ? RATES.owed : RATES.tenth }));
  const ur = packs.some((p) => p.some((c) => c.rarity === "UR"));
  return { packs, pity: { owed: !ur } };
}
