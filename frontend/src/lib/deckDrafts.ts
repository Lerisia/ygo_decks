/** 덱 구축 (참혈 2026-10-13, first layout): members' deck lists, kept on the server from 2026-10-14 (api/deckListApi).
 *  Here: the rules of a deck as Master Duel's editor keeps them (3 of a name, today's 금제, zone sizes, no side deck),
 *  what a deck is told while it breaks one (deckIssues), a guest's deck kept in the tab while they go to sign in, and
 *  the decks the first layout kept in this browser, moved to the member's account once. */
import type { CardListItem } from "@/api/cardDexApi";
import type { DeckListDoc } from "@/api/deckListApi";

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
  /** The 대표 카드 by slot (참혈 2026-10-16): a slot left empty is null; saved without the gaps (coverIds). */
  covers: (number | null)[];
};

/** Where the first layout kept decks in this browser (before 2026-10-14). */
const KEY = "deck_drafts_v0";
/** A guest's deck, kept in this tab while they go to sign in to save it (guests save nothing: 엘리스 2026-10-14). */
const SESSION_KEY = "deck_draft_tab";
/** The code of a deck not saved yet (/dev/decklists/new). */
export const NEW_CODE = "new";

export const ZONES: DeckZone[] = ["main", "extra"];
export const ZONE_LABEL: Record<DeckZone, string> = { main: "메인 덱", extra: "엑스트라 덱" };
export const ZONE_MAX: Record<DeckZone, number> = { main: 60, extra: 15 };
export const MAIN_MIN = 40;
export const COPIES_MAX = 3;
export const COVERS_MAX = 3;

export const blankDeck = (): DeckDraft => ({ code: NEW_CODE, name: "", description: "", createdAt: "", main: [], extra: [], covers: [] });

/** A deck the server sent, as the pages hold it. */
export const fromDoc = (d: DeckListDoc): DeckDraft => ({
  code: d.code, name: d.name, description: d.description, createdAt: d.created_at, updatedAt: d.updated_at, main: d.main, extra: d.extra,
  covers: d.cover_cards ?? [],
});

/** The decks the first layout kept in this browser, to move to the member's account. */
export function localDrafts(): DeckDraft[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Lets the browser's decks go once moved, keeping those that could not be (a rule since made stricter). */
export function clearLocalDrafts(keep: DeckDraft[] = []) {
  try {
    if (keep.length) localStorage.setItem(KEY, JSON.stringify(keep));
    else localStorage.removeItem(KEY);
  } catch { /* nothing kept */ }
}

export function clearTabDraft() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* nothing kept */ }
}

export function keepTabDraft(deck: DeckDraft) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(deck));
  } catch { /* the deck lasts the page */ }
}

/** The guest's deck kept in this tab, if any: kept until it is saved or given up (signing in reloads the page). */
export function tabDraft(): DeckDraft | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d && Array.isArray(d.main) && Array.isArray(d.extra) ? { ...blankDeck(), ...d, code: NEW_CODE } : null;
  } catch {
    return null;
  }
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

type BanInfo = Pick<CardListItem, "ban">;
const BAN_LIMIT = { forbidden: 0, limited: 1, semi_limited: 2 } as const;
const BAN_WORD = { forbidden: "금지", limited: "제한", semi_limited: "준제한" } as const;

/** How many of a card a deck may hold today: 3, or fewer on Master Duel's list (금지 0, 제한 1, 준제한 2). */
export const copiesAllowed = (card: BanInfo) => (card.ban ? BAN_LIMIT[card.ban] : COPIES_MAX);

/** A card picked in the search: into the extra or main deck by its frame, as many as its name and today's 금제
 *  allow. */
export function addCard<D extends DeckDraft>(deck: D, card: CardListItem, cards: Map<number, CardInfo>):
  { deck: D } | { error: string } {
  if (card.frame === "token") return { error: "토큰은 덱에 넣을 수 없습니다." };
  if (card.ban === "forbidden") return { error: "금지 카드는 넣을 수 없습니다." };
  const most = copiesAllowed(card);
  if (copiesOf(deck, card.name, cards) >= most) {
    return { error: card.ban ? `${BAN_WORD[card.ban]} 카드는 ${most}장까지 넣을 수 있습니다.` : `같은 이름의 카드는 ${COPIES_MAX}장까지 넣을 수 있습니다.` };
  }
  const zone: DeckZone = isExtraCard(card) ? "extra" : "main";
  if (deck[zone].length >= ZONE_MAX[zone]) return { error: `${ZONE_LABEL[zone]}은 ${ZONE_MAX[zone]}장까지입니다.` };
  return { deck: { ...deck, [zone]: [...deck[zone], card.id] } };
}

/** The cards held more often than today's list allows (a 금제 since saving), the forbidden first, each with its line. */
export function overLimit(ids: number[], cards: Map<number, CardListItem>) {
  const n = new Map<number, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n].map(([id, count]) => ({ card: cards.get(id), count }))
    .filter((x): x is { card: CardListItem; count: number } => !!x.card?.ban && x.count > BAN_LIMIT[x.card.ban])
    .sort((a, b) => BAN_LIMIT[a.card.ban as keyof typeof BAN_LIMIT] - BAN_LIMIT[b.card.ban as keyof typeof BAN_LIMIT] || a.card.name.localeCompare(b.card.name))
    .map(({ card, count }) => {
      const ban = card.ban as keyof typeof BAN_LIMIT;
      const line = ban === "forbidden" ? `${card.name}: 금지 카드입니다.` : `${card.name}: ${BAN_WORD[ban]} 카드는 ${BAN_LIMIT[ban]}장까지입니다 (${count}장).`;
      return { card, count, line };
    });
}

/** What keeps the deck from being played today, as the server says it (decklists/rules.py): too few in the main,
 *  then each card over today's list, the forbidden first. */
export function deckIssues(deck: Pick<DeckDraft, DeckZone>, cards: Map<number, CardListItem>): string[] {
  const out: string[] = [];
  if (deck.main.length < MAIN_MIN) out.push(`메인 덱이 ${MAIN_MIN}장보다 적습니다 (${deck.main.length}/${MAIN_MIN}).`);
  return [...out, ...overLimit([...deck.main, ...deck.extra], cards).map((o) => o.line)];
}

/** Takes one copy of a card out of a zone; with its last copy gone it is no longer a 대표 카드 either. */
export function removeCard<D extends DeckDraft>(deck: D, zone: DeckZone, id: number): D {
  const at = deck[zone].indexOf(id);
  if (at < 0) return deck;
  const left = deck[zone].filter((_, i) => i !== at);
  return { ...deck, [zone]: left, covers: left.includes(id) ? deck.covers : deck.covers.map((c) => (c === id ? null : c)) };
}

/** Puts a card in a 대표 카드 slot (null empties it); a card already in another slot trades places with what the slot
 *  held, so no card stands there twice. */
export function setCover<D extends DeckDraft>(deck: D, slot: number, id: number | null): D {
  const covers = Array.from({ length: COVERS_MAX }, (_, i) => deck.covers[i] ?? null);
  const was = id === null ? -1 : covers.indexOf(id);
  if (was >= 0) covers[was] = covers[slot];
  covers[slot] = id;
  return { ...deck, covers };
}

/** The 대표 카드 as saved: in slot order without the empty ones, only cards still in the deck. */
export const coverIds = (deck: Pick<DeckDraft, DeckZone | "covers">) =>
  deck.covers.filter((c): c is number => c !== null && (deck.main.includes(c) || deck.extra.includes(c)));
