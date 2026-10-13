/** 덱 구축 (참혈 2026-10-13, first layout): members' deck lists. The server keeps none yet, so the decks live in this
 *  browser's localStorage, and everything the /decklists pages save or read goes through this file — a deck API takes
 *  its place here alone. The rules of a deck (3 of a name, zone sizes) are here too. No side deck for now. */
import type { CardListItem } from "@/api/cardDexApi";

export type DeckZone = "main" | "extra";

export type DeckDraft = {
  code: string;
  name: string;
  description: string;
  /** When it was first saved (ISO). */
  createdAt: string;
  /** When it was last saved (ISO); decks saved before 10-14 have none, so read it through deckUpdated. */
  updatedAt?: string;
  /** Card ids, an id once per copy. */
  main: number[];
  extra: number[];
};

const KEY = "deck_drafts_v0";
/** The code of a deck not saved yet (/decklists/new). */
export const NEW_CODE = "new";

export const ZONES: DeckZone[] = ["main", "extra"];
export const ZONE_LABEL: Record<DeckZone, string> = { main: "메인 덱", extra: "엑스트라 덱" };
export const ZONE_MAX: Record<DeckZone, number> = { main: 60, extra: 15 };
export const MAIN_MIN = 40;
export const COPIES_MAX = 3;

export const blankDeck = (): DeckDraft => ({ code: NEW_CODE, name: "", description: "", createdAt: "", main: [], extra: [] });

function stored(): DeckDraft[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** The saved decks, the newest first. */
export function listDecks(): DeckDraft[] {
  return stored().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDeck(code: string): DeckDraft | null {
  return stored().find((d) => d.code === code) ?? null;
}

function newCode(taken: Set<string>) {
  let code;
  do {
    code = Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  } while (taken.has(code) || code === NEW_CODE);
  return code;
}

/** Saves a deck: a new one gets its code and its day here, and every save its last-saved time. Throws when the
 *  browser won't store it (private mode, full storage). */
export function saveDeck(deck: DeckDraft): DeckDraft {
  const list = stored();
  const now = new Date().toISOString();
  const saved = deck.code === NEW_CODE
    ? { ...deck, code: newCode(new Set(list.map((d) => d.code))), createdAt: now, updatedAt: now }
    : { ...deck, updatedAt: now };
  localStorage.setItem(KEY, JSON.stringify([...list.filter((d) => d.code !== saved.code), saved]));
  return saved;
}

export const deckUpdated = (deck: Pick<DeckDraft, "createdAt" | "updatedAt">) => deck.updatedAt || deck.createdAt;

/** 2026.10.13 */
export function deckDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

type CardInfo = Pick<CardListItem, "name" | "category" | "frame">;

const EXTRA_KINDS = [["fusion", "융합"], ["synchro", "싱크로"], ["xyz", "엑시즈"], ["link", "링크"]] as const;

/** Fusion, synchro, xyz and link monsters (their pendulums too) go in the extra deck. */
export const isExtraCard = (c: CardInfo) => EXTRA_KINDS.some(([frame]) => c.frame.startsWith(frame));

function kindOf(c: CardInfo) {
  if (c.category === "spell") return "마법";
  if (c.category === "trap") return "함정";
  return EXTRA_KINDS.find(([frame]) => c.frame.startsWith(frame))?.[1] ?? "몬스터";
}

const KINDS = ["몬스터", "마법", "함정", ...EXTRA_KINDS.map(([, label]) => label)];

/** A zone's header: how many of each kind, in this order, those with none left out (몬스터 : 18장 / 마법 : 12장). */
export function kindCounts(ids: number[], cards: Map<number, CardInfo>) {
  const n = new Map<string, number>();
  for (const id of ids) {
    const c = cards.get(id);
    if (c) n.set(kindOf(c), (n.get(kindOf(c)) ?? 0) + 1);
  }
  return KINDS.filter((k) => n.get(k)).map((label) => ({ label, count: n.get(label)! }));
}

/** A zone's cards in the 디폴트 순 the server gave (order: id → place), copies side by side; ids it hasn't placed
 *  yet come last, in the order they were put in. */
export function sortedZone(ids: number[], order: Map<number, number>) {
  const first = new Map<number, number>();
  ids.forEach((id, i) => first.has(id) || first.set(id, i));
  const key = (id: number) => [order.get(id) ?? Infinity, first.get(id)!];
  return [...ids].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
}

/** How many cards of this name the deck holds, main and extra together (another print of a name is the same card). */
export function copiesOf(deck: Pick<DeckDraft, DeckZone>, name: string, cards: Map<number, CardInfo>) {
  return ZONES.reduce((n, z) => n + deck[z].filter((id) => cards.get(id)?.name === name).length, 0);
}

/** A card picked in the search: into the extra or main deck by its frame. */
export function addCard<D extends DeckDraft>(deck: D, card: CardListItem, cards: Map<number, CardInfo>):
  { deck: D } | { error: string } {
  if (card.frame === "token") return { error: "토큰은 덱에 넣을 수 없습니다." };
  if (copiesOf(deck, card.name, cards) >= COPIES_MAX) return { error: `같은 이름의 카드는 ${COPIES_MAX}장까지 넣을 수 있습니다.` };
  const zone: DeckZone = isExtraCard(card) ? "extra" : "main";
  if (deck[zone].length >= ZONE_MAX[zone]) return { error: `${ZONE_LABEL[zone]}은 ${ZONE_MAX[zone]}장까지입니다.` };
  return { deck: { ...deck, [zone]: [...deck[zone], card.id] } };
}

/** Takes one copy of a card out of a zone. */
export function removeCard<D extends DeckDraft>(deck: D, zone: DeckZone, id: number): D {
  const at = deck[zone].indexOf(id);
  return at < 0 ? deck : { ...deck, [zone]: deck[zone].filter((_, i) => i !== at) };
}
