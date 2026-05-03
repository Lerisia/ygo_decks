const API_BASE = "/api/avatar";

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

export type CardSearchResult = {
  id: number;
  card_id: string;
  name: string;
  image_url: string | null;
};

export type IconCategory = "default" | "shop" | "exclusive";

export type CardIcon = {
  id: number;
  title: string;
  card: number;
  card_id: string;
  card_name: string;
  card_image_url: string | null;
  center_x: number;
  center_y: number;
  radius: number;
  category: IconCategory;
  price: number;
  created_at: string;
};

export const searchCards = (q: string) =>
  request<{ results: CardSearchResult[] }>(`/card-icons/search-cards/?q=${encodeURIComponent(q)}`);

export const listIcons = () =>
  request<{ icons: CardIcon[] }>("/card-icons/");

export const createIcon = (data: {
  card: number;
  title?: string;
  center_x: number;
  center_y: number;
  radius: number;
  category?: IconCategory;
  price?: number;
}) =>
  request<CardIcon>("/card-icons/create/", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateIcon = (id: number, data: Partial<{
  title: string;
  center_x: number;
  center_y: number;
  radius: number;
  category: IconCategory;
  price: number;
}>) =>
  request<CardIcon>(`/card-icons/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteIcon = (id: number) =>
  request<{ ok: boolean }>(`/card-icons/${id}/delete/`, { method: "DELETE" });
