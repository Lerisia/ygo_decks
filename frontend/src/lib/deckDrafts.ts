/** 덱 구축 (참혈 2026-10-13, first layout): members' deck lists, kept on the server from 2026-10-14 (api/deckListApi).
 *  Here: the rules of a deck as Master Duel's editor keeps them (3 of a name, the 금제 it picked — lib/banlists, today's
 *  Master Duel list by default — zone sizes, no side deck),
 *  what a deck is told while it breaks one (deckIssues), a guest's deck kept in the tab while they go to sign in, and
 *  the decks the first layout kept in this browser, moved to the member's account once. */
import type { CardListItem } from "@/api/cardDexApi";
import type { CardLook, DeckListDoc, DeckLooks } from "@/api/deckListApi";
import { type BanRule, DEFAULT_BANLIST, banOf, notOut, parseBanlistKey } from "./banlists";

export type { CardLook, DeckLooks };
export type DeckZone = "main" | "extra";
/** A 대표 카드: the card, and which of its copies in the deck was pressed (0 for the first). */
export type CoverPick = { id: number; copy: number };

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
  /** Each copy's print and finish, lined up with main and extra (참혈 2026-10-16); null its own print in 일반. */
  looks: DeckLooks;
  /** The 대표 카드 by slot (참혈 2026-10-16): a slot left empty is null; saved without the gaps (savedCovers). */
  covers: (CoverPick | null)[];
  /** The 금제 it is checked by, as kept (lib/banlists: "md" Master Duel's newest, "ocg:2020-04-01", …) (참혈 2026-10-16). */
  banlist: string;
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

export const blankDeck = (): DeckDraft => ({
  code: NEW_CODE, name: "", description: "", createdAt: "", main: [], extra: [], looks: { main: [], extra: [] }, covers: [],
  banlist: DEFAULT_BANLIST,
});

/** The looks lined up with the zones' cards: a zone whose looks don't (a deck from before them) is all plain. */
export const fitLooks = (d: Pick<DeckDraft, DeckZone> & { looks?: Partial<DeckLooks> | null }): DeckLooks => {
  const fit = (z: DeckZone) => {
    const got = d.looks?.[z];
    return Array.isArray(got) && got.length === d[z].length ? got.map((l) => l ?? null) : d[z].map(() => null);
  };
  return { main: fit("main"), extra: fit("extra") };
};

/** A deck the server sent, as the pages hold it. */
export const fromDoc = (d: DeckListDoc): DeckDraft => ({
  code: d.code, name: d.name, description: d.description, createdAt: d.created_at, updatedAt: d.updated_at, main: d.main, extra: d.extra,
  looks: fitLooks(d), covers: (d.cover_cards ?? []).map((id, i) => ({ id, copy: d.cover_copies?.[i] ?? 0 })),
  banlist: d.banlist || DEFAULT_BANLIST,
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
    if (!(d && Array.isArray(d.main) && Array.isArray(d.extra))) return null;
    // one kept before looks and copies (10-16): plain, the first copy
    const covers = (Array.isArray(d.covers) ? d.covers : []).map((c: CoverPick | number | null) => (typeof c === "number" ? { id: c, copy: 0 } : c));
    return { ...blankDeck(), ...d, code: NEW_CODE, looks: fitLooks(d), covers, banlist: parseBanlistKey(d.banlist) ? d.banlist : DEFAULT_BANLIST };
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

/** The one day a deck's page shows (참혈 2026-10-16): its last save's, as 갱신일, unless that fell on the day it was first
 *  saved — then 등록일. */
export function deckDayLine(deck: Pick<DeckDraft, "createdAt" | "updatedAt">) {
  const made = deckDay(deck.createdAt);
  const saved = deckDay(deckUpdated(deck));
  return saved === made ? `등록일 ${made}` : `갱신일 ${saved}`;
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

/** A zone's header: how many of each kind, in this order, those with none left out ([몬스터] 18장 [마법] 12장). */
export function kindCounts(ids: number[], cards: Map<number, CardInfo>) {
  const n = new Map<string, number>();
  for (const id of ids) {
    const c = cards.get(id);
    if (c) n.set(kindOf(c), (n.get(kindOf(c)) ?? 0) + 1);
  }
  return KINDS.filter((k) => n.get(k)).map((label) => ({ label, count: n.get(label)! }));
}

/** A zone's places (indices into ids) in the 디폴트 순 the server gave (order: id → place), copies side by side in
 *  the order they went in; ids it hasn't placed yet come last, in the order they were put in. */
export function sortedCopies(ids: number[], order: Map<number, number>) {
  const first = new Map<number, number>();
  ids.forEach((id, i) => first.has(id) || first.set(id, i));
  const key = (i: number) => [order.get(ids[i]) ?? Infinity, first.get(ids[i])!, i];
  return ids.map((_, i) => i).sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

/** A zone's cards in the 디폴트 순 (sortedCopies). */
export const sortedZone = (ids: number[], order: Map<number, number>) => sortedCopies(ids, order).map((i) => ids[i]);

/** Which copy of its card the one at `at` is (0 for the first in the zone). */
export const copyRank = (ids: number[], at: number) => ids.slice(0, at).filter((id) => id === ids[at]).length;

/** Where the `copy`-th copy of a card is in the zone, or -1 with fewer copies. */
export function copyIndex(ids: number[], id: number, copy: number) {
  for (let i = 0, n = 0; i < ids.length; i++) if (ids[i] === id && n++ === copy) return i;
  return -1;
}

/** The zone a card goes in that holds it, or null. */
const zoneHolding = (deck: Pick<DeckDraft, DeckZone>, id: number) => ZONES.find((z) => deck[z].includes(id)) ?? null;

/** A look as kept: none for the card's own print in 일반. */
export const keptLook = (id: number, look: CardLook | null | undefined): CardLook | null =>
  !look || (look.face === id && look.finish === "normal") ? null : { face: look.face, finish: look.finish };

/** How the copy at `at` looks, its own print in 일반 spelled out. */
export const lookAt = (deck: Pick<DeckDraft, DeckZone | "looks">, zone: DeckZone, at: number): CardLook =>
  deck.looks[zone][at] ?? { face: deck[zone][at], finish: "normal" };

/** A copy's small face: its print's (an alternate art the deck's cards came with, alts), else the card's own. */
export const lookThumb = (card: CardListItem, look: CardLook | null | undefined) =>
  (look && look.face !== card.id ? card.alts?.find((a) => a.id === look.face)?.thumb : null)
  || card.face_thumb_url || card.thumb_url || card.image_url || "/default_cover.png";

/** How many cards of this name the deck holds, main and extra together (another print of a name is the same card). */
export function copiesOf(deck: Pick<DeckDraft, DeckZone>, name: string, cards: Map<number, CardInfo>) {
  return ZONES.reduce((n, z) => n + deck[z].filter((id) => cards.get(id)?.name === name).length, 0);
}

type BanInfo = Pick<CardListItem, "id" | "ban">;
const BAN_LIMIT = { forbidden: 0, limited: 1, semi_limited: 2 } as const;
const BAN_WORD = { forbidden: "금지", limited: "제한", semi_limited: "준제한" } as const;

/** How many of a card a deck may hold under its 금제 (rule; today's Master Duel list when none): 3, or fewer on the
 *  list (금지 0, 제한 1, 준제한 2). */
export function copiesAllowed(card: BanInfo, rule?: BanRule) {
  const ban = banOf(card, rule);
  return ban ? BAN_LIMIT[ban] : COPIES_MAX;
}

/** A card picked in the search: into the extra or main deck by its frame, as many as its name and the deck's 금제
 *  allow, in the look picked for it (its own print in 일반 by default). A card not out yet then goes in (미출시 is
 *  only told). */
export function addCard<D extends DeckDraft>(deck: D, card: CardListItem, cards: Map<number, CardInfo>, look?: CardLook | null, rule?: BanRule):
  { deck: D } | { error: string } {
  const ban = banOf(card, rule);
  if (card.frame === "token") return { error: "토큰은 덱에 넣을 수 없습니다." };
  if (ban === "forbidden") return { error: "금지 카드는 넣을 수 없습니다." };
  const most = copiesAllowed(card, rule);
  if (copiesOf(deck, card.name, cards) >= most) {
    return { error: ban ? `${BAN_WORD[ban]} 카드는 ${most}장까지 넣을 수 있습니다.` : `같은 이름의 카드는 ${COPIES_MAX}장까지 넣을 수 있습니다.` };
  }
  const zone: DeckZone = isExtraCard(card) ? "extra" : "main";
  if (deck[zone].length >= ZONE_MAX[zone]) return { error: `${ZONE_LABEL[zone]}은 ${ZONE_MAX[zone]}장까지입니다.` };
  return { deck: { ...deck, [zone]: [...deck[zone], card.id], looks: { ...deck.looks, [zone]: [...deck.looks[zone], keptLook(card.id, look)] } } };
}

const byName = (a: { card: CardListItem }, b: { card: CardListItem }) => (a.card.name < b.card.name ? -1 : a.card.name > b.card.name ? 1 : 0);

/** The cards held more often than the deck's list allows (rule; a 금제 since saving), the forbidden first, then by
 *  name as the server sorts them, each with its line. */
export function overLimit(ids: number[], cards: Map<number, CardListItem>, rule?: BanRule) {
  const n = new Map<number, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n].flatMap(([id, count]) => {
    const card = cards.get(id);
    const ban = card && banOf(card, rule);
    if (!card || !ban || count <= BAN_LIMIT[ban]) return [];
    const line = ban === "forbidden" ? `${card.name}: 금지 카드입니다.` : `${card.name}: ${BAN_WORD[ban]} 카드는 ${BAN_LIMIT[ban]}장까지입니다 (${count}장).`;
    return [{ card, count, ban, line }];
  }).sort((a, b) => BAN_LIMIT[a.ban] - BAN_LIMIT[b.ban] || byName(a, b));
}

/** The cards not out yet in the list's game by its day (미출시, 참혈 2026-10-16), by name, each with its line. */
export function notOutCards(ids: number[], cards: Map<number, CardListItem>, rule?: BanRule) {
  if (!rule) return [];
  return [...new Set(ids)].flatMap((id) => {
    const card = cards.get(id);
    return card && notOut(card, rule) ? [{ card, line: `${card.name}: 미출시 카드입니다.` }] : [];
  }).sort(byName);
}

/** What keeps the deck from being played under its 금제, as the server says it (decklists/rules.py): too few in the
 *  main, then each card over the list, the forbidden first, then each card not out yet then. */
export function deckIssues(deck: Pick<DeckDraft, DeckZone>, cards: Map<number, CardListItem>, rule?: BanRule): string[] {
  const out: string[] = [];
  if (deck.main.length < MAIN_MIN) out.push(`메인 덱이 ${MAIN_MIN}장보다 적습니다 (${deck.main.length}/${MAIN_MIN}).`);
  const all = [...deck.main, ...deck.extra];
  return [...out, ...overLimit(all, cards, rule).map((o) => o.line), ...notOutCards(all, cards, rule).map((o) => o.line)];
}

/** A copy named by which of its card's copies it is, once the `rank`-th copy of card `id` has left (`left` copies of
 *  it remain): an earlier one gone, it counts one less; its own gone, the next takes its place (the one before when
 *  it was the last); none left, it is gone too. */
export function shiftCopy(pick: CoverPick, id: number, rank: number, left: number): CoverPick | null {
  if (pick.id !== id) return pick;
  if (!left) return null;
  return { id, copy: pick.copy > rank ? pick.copy - 1 : Math.min(pick.copy, left - 1) };
}

/** Takes the copy at `at` out of a zone. A 대표 카드 on that card stays with its copy (an earlier copy gone, it
 *  counts one less), the next copy taking its place when its own leaves; with the card's last copy gone it is no
 *  longer a 대표 카드. */
export function removeCard<D extends DeckDraft>(deck: D, zone: DeckZone, at: number): D {
  const id = deck[zone][at];
  if (id === undefined) return deck;
  const rank = copyRank(deck[zone], at);
  const left = deck[zone].filter((_, i) => i !== at);
  const leftCopies = left.filter((x) => x === id).length;
  const covers = deck.covers.map((c) => (c ? shiftCopy(c, id, rank, leftCopies) : c));
  return { ...deck, [zone]: left, looks: { ...deck.looks, [zone]: deck.looks[zone].filter((_, i) => i !== at) }, covers };
}

/** The copy at `at` in a look (its own print in 일반 kept as none). */
export function setLook<D extends DeckDraft>(deck: D, zone: DeckZone, at: number, look: CardLook): D {
  if (deck[zone][at] === undefined) return deck;
  return { ...deck, looks: { ...deck.looks, [zone]: deck.looks[zone].map((l, i) => (i === at ? keptLook(deck[zone][at], look) : l)) } };
}

/** Every copy of a card in the zone in one look. */
export function setLookAll<D extends DeckDraft>(deck: D, zone: DeckZone, id: number, look: CardLook): D {
  return { ...deck, looks: { ...deck.looks, [zone]: deck.looks[zone].map((l, i) => (deck[zone][i] === id ? keptLook(id, look) : l)) } };
}

/** Puts a copy in a 대표 카드 slot (null empties it); a card already in another slot trades places with what the
 *  slot held, so no card stands there twice. */
export function setCover<D extends DeckDraft>(deck: D, slot: number, pick: CoverPick | null): D {
  const covers = Array.from({ length: COVERS_MAX }, (_, i) => deck.covers[i] ?? null);
  const was = pick === null ? -1 : covers.findIndex((c) => c?.id === pick.id);
  if (was >= 0 && was !== slot) covers[was] = covers[slot];
  covers[slot] = pick;
  return { ...deck, covers };
}

/** The 대표 카드's copy, where it is in the deck (fewer copies than it names: the last), or null when gone. */
export function coverPlace(deck: Pick<DeckDraft, DeckZone>, pick: CoverPick): { zone: DeckZone; at: number } | null {
  const zone = zoneHolding(deck, pick.id);
  if (!zone) return null;
  const copies = deck[zone].filter((id) => id === pick.id).length;
  return { zone, at: copyIndex(deck[zone], pick.id, Math.min(pick.copy, copies - 1)) };
}

/** How a 대표 카드 looks: as its copy does (none for its own print in 일반). */
export function coverLook(deck: Pick<DeckDraft, DeckZone | "looks">, pick: CoverPick): CardLook | null {
  const place = coverPlace(deck, pick);
  return place ? deck.looks[place.zone][place.at] : null;
}

/** The 대표 카드 as saved: in slot order without the empty ones, only cards still in the deck, with which copy each is. */
export function savedCovers(deck: Pick<DeckDraft, DeckZone | "covers">) {
  const held = deck.covers.flatMap((c) => {
    const place = c && coverPlace(deck, c);
    return c && place ? [{ id: c.id, copy: copyRank(deck[place.zone], place.at) }] : [];
  });
  return { cover_cards: held.map((c) => c.id), cover_copies: held.map((c) => c.copy) };
}
