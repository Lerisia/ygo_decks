const API_BASE = "/api/multiplayer";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || body.detail || JSON.stringify(body);
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export type DuchMindWord = {
  id: number;
  card_id: string;
  card_pk: number;
  name: string;
  image_url: string | null;
  enabled: boolean;
  note: string;
};

export type CardSearchHit = {
  id: number;
  card_id: string;
  name: string;
  image_url: string | null;
};

export type AdminDmPack = {
  id: number;
  name: string;
  is_default: boolean;
  entry_count: number;
};

const packQS = (packId?: number) => (packId ? `?pack_id=${packId}` : "");

export const listAdminDmPacks = () =>
  request<{ packs: AdminDmPack[] }>("/duchmind/admin-packs/");

export const listDmWords = (packId?: number) =>
  request<{ words: DuchMindWord[]; count: number; pack_id: number | null }>(`/duchmind/words/${packQS(packId)}`);

export const searchDmCards = (q: string, packId?: number) => {
  const params = new URLSearchParams({ q });
  if (packId) params.set("pack_id", String(packId));
  return request<{ results: CardSearchHit[] }>(`/duchmind/words/search/?${params}`, { method: "POST" });
};

export const addDmWord = (cardPk: number, packId?: number, note?: string) =>
  request<{ id: number; card_id: string; name: string; created: boolean }>("/duchmind/words/add/", {
    method: "POST",
    body: JSON.stringify({ card_pk: cardPk, note: note || "", pack_id: packId }),
  });

export const bulkAddDmWords = (names: string[], packId?: number) =>
  request<{ added: number; skipped: number; not_found: string[] }>("/duchmind/words/bulk/", {
    method: "POST",
    body: JSON.stringify({ names, pack_id: packId }),
  });

export const toggleDmWord = (id: number, enabled: boolean) =>
  request<{ id: number; enabled: boolean }>(`/duchmind/words/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });

export const deleteDmWord = (id: number) =>
  request<{ ok: boolean }>(`/duchmind/words/${id}/delete/`, { method: "DELETE" });

export type BrowseCard = {
  id: number;
  card_id: string;
  name: string;
  image_url: string | null;
  in_pack: boolean;
};

export const browseDmCards = (opts: { packId?: number; page?: number; q?: string }) => {
  const params = new URLSearchParams();
  if (opts.packId) params.set("pack_id", String(opts.packId));
  if (opts.page) params.set("page", String(opts.page));
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  return request<{
    items: BrowseCard[]; page: number; page_size: number;
    total: number; total_pages: number; pack_id: number | null;
  }>(`/duchmind/browse-cards/?${params}`);
};

export const removeDmWordByCard = (cardPk: number, packId?: number) =>
  request<{ ok: boolean; removed: number }>("/duchmind/words/remove-card/", {
    method: "POST",
    body: JSON.stringify({ card_pk: cardPk, pack_id: packId }),
  });
