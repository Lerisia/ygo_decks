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

export type WordPackSummary = {
  id: number;
  name: string;
  description: string;
  owner_id: number | null;
  owner_name: string | null;
  is_default: boolean;
  is_public: boolean;
  is_mine: boolean;
  /** Server-computed: true if this user may edit the pack (owner, or
   *  staff for any system pack). Prefer this over is_mine/is_default. */
  can_edit?: boolean;
  series?: "yugioh" | "pokemon";
  entry_count: number;
  created_at: string | null;
};

export type WordPackEntry = {
  id: number;
  card_id: string;
  card_pk: number;
  name: string;
  image_url: string | null;
  enabled: boolean;
};

export type CardSearchHit = {
  id: number;
  card_id: string;
  name: string;
  image_url: string | null;
};

export const listPacks = (opts?: { forGame?: boolean }) => {
  const qs = opts?.forGame ? "?for_game=1" : "";
  return request<{ packs: WordPackSummary[] }>(`/duchmind/packs/${qs}`);
};

export const createPack = (name: string, description = "", isPublic = false) =>
  request<WordPackSummary>("/duchmind/packs/create/", {
    method: "POST",
    body: JSON.stringify({ name, description, is_public: isPublic }),
  });

export const getPack = (id: number) =>
  request<{ pack: WordPackSummary; entries: WordPackEntry[] }>(`/duchmind/packs/${id}/`);

export const updatePack = (id: number, data: Partial<{ name: string; description: string; is_public: boolean }>) =>
  request<WordPackSummary>(`/duchmind/packs/${id}/update/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deletePack = (id: number) =>
  request<{ ok: boolean }>(`/duchmind/packs/${id}/delete/`, { method: "DELETE" });

export const addCardToPack = (packId: number, cardPk: number) =>
  request<{ id: number; card_id: string; name: string; created: boolean }>(`/duchmind/packs/${packId}/add-card/`, {
    method: "POST",
    body: JSON.stringify({ card_pk: cardPk }),
  });

export const removeWordFromPack = (packId: number, wordId: number) =>
  request<{ ok: boolean }>(`/duchmind/packs/${packId}/words/${wordId}/`, { method: "DELETE" });

// Companion to addCardToPack — same shape, but operates on Card.id directly
// (used by the browse-cards grid where the wordId isn't surfaced).
export const removeCardFromPack = (packId: number, cardPk: number) =>
  request<{ ok: boolean; removed: number }>(`/duchmind/packs/${packId}/remove-card/`, {
    method: "POST",
    body: JSON.stringify({ card_pk: cardPk }),
  });

export const importPack = (packId: number, text: string) =>
  request<{ added: number; skipped: number; not_found: string[] }>(`/duchmind/packs/${packId}/import/`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

export const exportPack = (packId: number) =>
  request<{ name: string; csv: string; count: number }>(`/duchmind/packs/${packId}/export/`);

export const searchCardsForPack = (packId: number, q: string) =>
  request<{ results: CardSearchHit[] }>(`/duchmind/packs/${packId}/search/?q=${encodeURIComponent(q)}`, { method: "POST" });
