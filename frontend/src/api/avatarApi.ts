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

export type PublicCardIcon = {
  id: number;
  title: string;
  card: number;
  card_id: string;
  card_name: string;
  card_image_url: string | null;
  center_x: number;
  center_y: number;
  radius: number;
};

export type Border = {
  id: number;
  key: string;
  name: string;
  color: string;
  image_url: string | null;
  is_default: boolean;
};

export const listPublicIcons = (q?: string) =>
  request<{ icons: PublicCardIcon[] }>(`/card-icons/public/${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const listMyIcons = (q?: string) =>
  request<{ icons: PublicCardIcon[] }>(`/card-icons/my/${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export type ShopCardIcon = PublicCardIcon & { owned: boolean };

export const listShopIcons = (q?: string) =>
  request<{ icons: ShopCardIcon[] }>(`/card-icons/shop/${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const getMyAvatar = () =>
  request<{
    icon: PublicCardIcon | null;
    is_default_icon: boolean;
    border: Border | null;
    is_default_border: boolean;
  }>("/me/");

export const setMyAvatar = (iconId: number | null) =>
  request<{ ok: boolean; icon: PublicCardIcon | null }>("/me/set/", {
    method: "POST",
    body: JSON.stringify({ icon_id: iconId }),
  });

export const getMyBorders = () =>
  request<{ borders: Border[] }>("/borders/me/");

export const setMyBorder = (borderId: number | null) =>
  request<{ ok: boolean; border: Border | null }>("/borders/me/set/", {
    method: "POST",
    body: JSON.stringify({ border_id: borderId }),
  });
