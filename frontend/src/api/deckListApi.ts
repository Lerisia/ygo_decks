/** A member's deck lists on the server (덱 구축, 엘리스 2026-10-14: kept on the server, theirs alone for now). */
export type DeckListRow = {
  code: string; name: string; description: string; main_count: number; extra_count: number;
  /** Up to 3 of its cards standing for it, in order (대표 카드, 참혈 2026-10-16), and which copy of each (0 the first). */
  cover_cards: number[];
  cover_copies?: number[];
  created_at: string; updated_at: string;
};
/** How one copy in a deck looks (참혈 2026-10-16): which of the card's prints (its own md id or an alternate art's)
 *  and its finish; null is its own print in 일반. */
export type CardLook = { face: number; finish: "normal" | "shine" | "royal" };
export type DeckLooks = { main: (CardLook | null)[]; extra: (CardLook | null)[] };
/** A deck in full: its cards by card book id, an id once per copy, each copy's look lined up with them, and what
 *  keeps it from being played today. */
export type DeckListDoc = DeckListRow & { main: number[]; extra: number[]; looks?: DeckLooks; issues: string[] };
export type DeckListBody = {
  name: string; description: string; main: number[]; extra: number[]; looks?: DeckLooks; cover_cards?: number[]; cover_copies?: number[];
};

const auth = (): Record<string, string> => {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function send<T>(path: string, method = "GET", body?: DeckListBody): Promise<T> {
  const r = await fetch(`/api/decklists/${path}`, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...auth() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || data.detail || `HTTP ${r.status}`), { status: r.status });
  return data as T;
}

export const listDeckLists = () => send<{ decks: DeckListRow[] }>("").then((r) => r.decks);
export const getDeckList = (code: string) => send<DeckListDoc>(`${code}/`);
export const createDeckList = (body: DeckListBody) => send<DeckListDoc>("", "POST", body);
export const updateDeckList = (code: string, body: DeckListBody) => send<DeckListDoc>(`${code}/`, "PUT", body);
export const deleteDeckList = (code: string) => send<void>(`${code}/`, "DELETE");
