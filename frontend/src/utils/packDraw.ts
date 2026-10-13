/** Master Duel's pack odds as the game's 제공 확률 shows them (엘리스 2026-10-12, confirmed by her). The draw itself runs on
 *  the server (backend carddb/pack_draw.py) since packs cost gems and the cards go to the account (10-13); these are
 *  for the page's 제공 확률 table. */

export type Rarity = "N" | "R" | "SR" | "UR";
export type Finish = "basic" | "shine" | "royal";
export type Pool<T> = Record<Rarity, T[]>;
export type Pulled<T> = { card: T; rarity: Rarity; finish: Finish };
type Odds = Partial<Record<Rarity, number>>;

export const RATES = {
  slot: { UR: 0.025, SR: 0.075, R: 0.35, N: 0.55 } as Odds,          // cards 1–7
  eighth: { UR: 0.025, SR: 0.075, R: 0.9 } as Odds,                    // card 8: R or higher
  tenth: { UR: 0.2, SR: 0.8 } as Odds,                                 // card 8 of the tenth of ten: SR or higher
};
export const GEMS_PER_PACK = 0;   // 100 in the game; free while the beta is for the thrill alone (엘리스 10/13)
