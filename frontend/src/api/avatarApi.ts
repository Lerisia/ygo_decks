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

export type IconCategory = "default" | "shop" | "exclusive";
export type IconRarity = "" | "common" | "rare" | "epic" | "legendary";

export type PublicCardIcon = {
  id: number;
  title: string;
  card: number;
  card_id: string;
  card_name: string;
  card_image_url: string | null;
  cropped_image_url?: string | null;
  center_x: number;
  center_y: number;
  radius: number;
  category: IconCategory;
  rarity: IconRarity;
  price: number;
  theme: string;
  shop_listed_at?: string | null;
  is_new?: boolean;
};

export type Border = {
  id: number;
  key: string;
  name: string;
  color: string;
  image_url: string | null;
  is_default: boolean;
  category?: IconCategory;
  rarity?: IconRarity;
  price?: number;
  unlocked?: boolean;
  unlock_condition?: string;
  /** Made from an uploaded frame image (drawn over the icon); the built-in ones are drawn by the site. */
  uploaded?: boolean;
  /** Admin list only: how many users have it. */
  owners?: number;
};

export const listPublicIcons = (q?: string) =>
  request<{ icons: PublicCardIcon[] }>(`/card-icons/public/${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const listMyIcons = (q?: string) =>
  request<{ icons: PublicCardIcon[] }>(`/card-icons/my/${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export type ShopCardIcon = PublicCardIcon & { owned: boolean };

export const listShopIcons = (q?: string) =>
  request<{ icons: ShopCardIcon[] }>(`/card-icons/shop/${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const purchaseIcon = (iconId: number) =>
  request<{ ok: true; points: number; icon_id: number }>(`/card-icons/${iconId}/purchase/`, {
    method: "POST",
  });

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

export type ShopBorder = Border & { owned: boolean };

export const listShopBorders = () =>
  request<{ borders: ShopBorder[] }>("/borders/shop/");

export const purchaseBorder = (borderId: number) =>
  request<{ ok: true; points: number; border_id: number }>(`/borders/${borderId}/purchase/`, {
    method: "POST",
  });

// Admin
export const listAdminBorders = () =>
  request<{ borders: Border[] }>("/borders/admin/");

export const updateBorder = (borderId: number, data: { name?: string; category?: IconCategory; rarity?: IconRarity }) =>
  request<Border>(`/borders/${borderId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

async function upload<T>(path: string, fd: FormData): Promise<T> {
  // No Content-Type here: the browser sets the multipart boundary itself.
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: authHeaders(), body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.detail || `HTTP ${res.status}`);
  return body;
}

export const createBorder = (name: string, image: File, category: IconCategory, rarity: IconRarity) => {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("image", image);
  fd.append("category", category);
  fd.append("rarity", rarity);
  return upload<Border>("/borders/create/", fd);
};

export const replaceBorderImage = (borderId: number, image: File) => {
  const fd = new FormData();
  fd.append("image", image);
  return upload<Border>(`/borders/${borderId}/image/`, fd);
};

export const deleteBorder = (borderId: number) =>
  request<{ ok: true }>(`/borders/${borderId}/delete/`, { method: "DELETE" });
