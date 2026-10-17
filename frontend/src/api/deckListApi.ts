/** The deck list board (덱 구축 → 덱리 게시판, 엘리스 2026-10-17: every deck list is a post on it; there is no 마이덱).
 *  Replies are shaped as the inquiry board's: a page is results / total / page / pages, an error {"error"}.
 *  The server's own notes: backend/decklists/API.md. */
import type { UserRef } from "@/components/UserName";

/** Who posted it: shown as icon + role chip + name, always together (components/UserName). */
export type DeckListAuthor = UserRef;
export type DeckListRow = {
  code: string; name: string; description: string; kind?: "own" | "entry"; main_count: number; extra_count: number;
  /** Up to 3 of its cards standing for it, in order (대표 카드, 참혈 2026-10-16), and which copy of each (0 the first). */
  cover_cards: number[];
  cover_copies?: number[];
  /** The 금제 it is checked by (lib/banlists: "md" Master Duel's newest, "ocg:2020-04-01", …) (참혈 2026-10-16). */
  banlist?: string;
  author?: DeckListAuthor;
  /** 비공개 (엘리스 2026-10-17): its author's alone; others never get it. */
  is_private?: boolean;
  view_count?: number;
  comment_count?: number | null;
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
  is_private?: boolean;
};
export type DeckListPage = { results: DeckListRow[]; total: number; page: number; pages: number };
export type DeckListBanlistKind = "md" | "ocg" | "tcg" | "custom" | "none";
export type DeckListQuery = { page?: number; banlist?: DeckListBanlistKind; author?: string; card?: number; q?: string };

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
export const addDeckComment = (code: string, body: string) => send<DeckListComment>(`${code}/comments/`, "POST", { body });
export const deleteDeckComment = (id: number) => send<void>(`comments/${id}/`, "DELETE");
