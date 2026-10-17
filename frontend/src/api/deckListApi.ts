/** The deck list board (덱 구축 → 덱리 게시판, 엘리스 2026-10-17: every deck list is a post on it; there is no 마이덱).
 *  Replies are shaped as the inquiry board's: a page is results / total / page / pages, an error {"error"}.
 *  The server's own notes: backend/decklists/API.md. */
import type { AvatarIcon } from "@/components/Avatar";
import type { Border } from "@/api/avatarApi";

/** Who posted it: shown as name + icon + frame, always together. */
export type DeckListAuthor = { name: string; avatar_icon: AvatarIcon | null; border: Border | null };
/** The 도감 deck a list is filed under. */
export type DeckListDeck = { id: number; name: string };
export type DeckListRow = {
  code: string; name: string; description: string; kind?: "own" | "entry"; main_count: number; extra_count: number;
  /** Up to 3 of its cards standing for it, in order (대표 카드, 참혈 2026-10-16), and which copy of each (0 the first). */
  cover_cards: number[];
  cover_copies?: number[];
  /** The 금제 it is checked by (lib/banlists: "md" Master Duel's newest, "ocg:2020-04-01", …) (참혈 2026-10-16). */
  banlist?: string;
  author?: DeckListAuthor;
  /** What its cards say (deck_chosen false), or what its author picked — a pick of none too (엘리스 2026-10-17). */
  deck?: DeckListDeck | null;
  deck_chosen?: boolean;
  /** 비공개 (엘리스 2026-10-17): its author's alone; others never get it. */
  is_private?: boolean;
  like_count?: number;
  view_count?: number;
  comment_count?: number | null;
  liked?: boolean;
  mine?: boolean;
  created_at: string; updated_at: string;
};
/** How one copy in a deck looks (참혈 2026-10-16): which of the card's prints (its own md id or an alternate art's)
 *  and its finish; null is its own print in 일반. */
export type CardLook = { face: number; finish: "normal" | "shine" | "royal" };
export type DeckLooks = { main: (CardLook | null)[]; extra: (CardLook | null)[] };
export type DeckListComment = { id: number; author: DeckListAuthor; body: string; created_at: string; mine: boolean };
/** A deck in full: its cards by card book id, an id once per copy, each copy's look lined up with them, what
 *  keeps it from being played under its 금제, and its comments. */
export type DeckListDoc = DeckListRow & { main: number[]; extra: number[]; looks?: DeckLooks; issues: string[]; comments?: DeckListComment[] };
export type DeckListBody = {
  name: string; description: string; main: number[]; extra: number[]; looks?: DeckLooks; cover_cards?: number[]; cover_copies?: number[];
  banlist?: string;
  /** Sent with deck_chosen true: the author's pick (an id, or null for none); false: the cards decide, again on every save. */
  deck?: number | null;
  deck_chosen?: boolean;
  is_private?: boolean;
};
export type DeckListPage = { results: DeckListRow[]; total: number; page: number; pages: number };
export type DeckListSort = "new" | "top";
export type DeckListBanlistKind = "md" | "ocg" | "tcg" | "custom" | "none";
export type DeckListQuery = {
  page?: number; sort?: DeckListSort; deck?: number | "none"; banlist?: DeckListBanlistKind; author?: string; card?: number; q?: string;
};
/** What the cards say a deck is, while it is built. */
export type DeckClass = { deck: (DeckListDeck & { share: number }) | null; candidates: (DeckListDeck & { share: number })[] };

const auth = (): Record<string, string> => {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function send<T>(path: string, method = "GET", body?: object): Promise<T> {
  const r = await fetch(`/api/decklists/${path}`, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...auth() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || data.detail || `HTTP ${r.status}`), { status: r.status });
  return data as T;
}

const query = (q: DeckListQuery) => {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const listDeckLists = (q: DeckListQuery = {}) => send<DeckListPage>(query(q));
export const getDeckList = (code: string) => send<DeckListDoc>(`${code}/`);
export const createDeckList = (body: DeckListBody) => send<DeckListDoc>("", "POST", body);
export const updateDeckList = (code: string, body: DeckListBody) => send<DeckListDoc>(`${code}/`, "PUT", body);
export const deleteDeckList = (code: string) => send<void>(`${code}/`, "DELETE");
/** 추천 on, or off again. */
export const likeDeckList = (code: string) => send<{ liked: boolean; like_count: number }>(`${code}/like/`, "POST", {});
export const addDeckComment = (code: string, body: string) => send<DeckListComment>(`${code}/comments/`, "POST", { body });
export const deleteDeckComment = (id: number) => send<void>(`comments/${id}/`, "DELETE");
export const classifyDeck = (main: number[], extra: number[]) => send<DeckClass>("classify/", "POST", { main, extra });

// The 도감 decks' names, for the chip naming a filter or a pick: the same list the deck picker fetches, once a visit.
let names: Promise<Map<number, string>> | null = null;
export const deckNames = () =>
  (names ??= fetch("/api/deck/")
    .then((r) => r.json())
    .then((d) => new Map<number, string>((d.decks || []).map((x: { id: number; name: string }) => [x.id, x.name])))
    .catch(() => {
      names = null;
      return new Map<number, string>();
    }));
