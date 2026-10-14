/** A member's deck lists on the server (덱 구축, 엘리스 2026-10-14: kept on the server, theirs alone for now). */
export type DeckListRow = {
  code: string; name: string; description: string; main_count: number; extra_count: number;
  created_at: string; updated_at: string;
};
/** A deck in full: its cards by card book id, an id once per copy, and what keeps it from being played today. */
export type DeckListDoc = DeckListRow & { main: number[]; extra: number[]; issues: string[] };
export type DeckListBody = { name: string; description: string; main: number[]; extra: number[] };

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
