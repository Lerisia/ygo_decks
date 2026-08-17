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

export type CustomIllustResult = {
  id: number;
  name: string;
  image_url: string | null;
};

export type IconCategory = "default" | "shop" | "exclusive";
export type IconRarity = "" | "common" | "rare" | "epic" | "legendary";

export const RARITY_LABEL: Record<Exclude<IconRarity, "">, string> = {
  common: "일반",
  rare: "희귀",
  epic: "서사",
  legendary: "전설",
};
export const RARITY_PRICE: Record<Exclude<IconRarity, "">, number> = {
  common: 10,
  rare: 100,
  epic: 500,
  legendary: 2000,
};
export const RARITY_BADGE: Record<Exclude<IconRarity, "">, string> = {
  common: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300",
  rare: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  epic: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
  legendary: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
};

export type CardIcon = {
  id: number;
  title: string;
  card: number | null;
  custom_illust: number | null;
  is_custom: boolean;
  card_id: string | null;
  card_name: string | null;
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
  created_at: string;
};

export const listThemes = () =>
  request<{ themes: string[] }>("/card-icons/themes/");

export const searchCards = (q: string) =>
  request<{ results: CardSearchResult[] }>(`/card-icons/search-cards/?q=${encodeURIComponent(q)}`);

export type CustomIllustListResponse = {
  results: CustomIllustResult[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export const listCustomIllusts = (q?: string, page: number = 1) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return request<CustomIllustListResponse>(
    `/card-icons/custom-illusts/${qs ? `?${qs}` : ""}`
  );
};

export const uploadCustomIllust = async (name: string, file: File): Promise<CustomIllustResult> => {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("image", file);
  const res = await fetch(`${API_BASE}/card-icons/custom-illusts/upload/`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.detail || `HTTP ${res.status}`);
  return body;
};

export const deleteCustomIllust = (id: number) =>
  request<{ ok: boolean }>(`/card-icons/custom-illusts/${id}/delete/`, { method: "DELETE" });

export interface BulkUploadResult {
  imported: CustomIllustResult[];
  imported_count: number;
  skipped: { name: string; reason: string }[];
  skipped_count: number;
  duplicates: number;
}

export const bulkUploadCustomIllusts = async (files: File[]): Promise<BulkUploadResult> => {
  const fd = new FormData();
  files.forEach((f) => fd.append("images", f));
  const res = await fetch(`${API_BASE}/card-icons/custom-illusts/bulk-upload/`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
  return body as BulkUploadResult;
};

export const getTwitterCredentials = () =>
  request<{
    configured: boolean;
    updated_at?: string;
    note?: string;
    auth_token_tail?: string;
    ct0_tail?: string;
  }>("/card-icons/custom-illusts/twitter-credentials/");

export const setTwitterCredentials = (auth_token: string, ct0: string, note: string = "") =>
  request<{ ok: boolean }>("/card-icons/custom-illusts/twitter-credentials/", {
    method: "POST",
    body: JSON.stringify({ auth_token, ct0, note }),
  });

export interface ScrapeResult {
  query: string;
  tweets_seen: number;
  imported: CustomIllustResult[];
  imported_count: number;
  skipped: { tweet: string; reason: string }[];
  skipped_count: number;
  duplicates: number;
  errors: number;
}

export const scrapeTwitterRange = (since: string, until: string, username = "YuGiOh_OCG_INFO") =>
  request<ScrapeResult>("/card-icons/custom-illusts/scrape-twitter/", {
    method: "POST",
    body: JSON.stringify({ since, until, username }),
  });

export const importTweetIllusts = (tweet_url: string, name: string) =>
  request<{ created: CustomIllustResult[] }>("/card-icons/custom-illusts/import-tweet/", {
    method: "POST",
    body: JSON.stringify({ tweet_url, name }),
  });

export const listIcons = () =>
  request<{ icons: CardIcon[] }>("/card-icons/");

export const createIcon = (data: {
  card?: number;
  custom_illust?: number;
  title?: string;
  center_x: number;
  center_y: number;
  radius: number;
  category?: IconCategory;
  rarity?: IconRarity;
  theme?: string;
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
  rarity: IconRarity;
  theme: string;
}>) =>
  request<CardIcon>(`/card-icons/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteIcon = (id: number) =>
  request<{ ok: boolean }>(`/card-icons/${id}/delete/`, { method: "DELETE" });

export const setIconNew = (id: number, isNew: boolean) =>
  request<{ id: number; shop_listed_at: string | null }>(
    `/card-icons/${id}/set-new/`,
    { method: "POST", body: JSON.stringify({ is_new: isNew }) },
  );

export const bulkSetTheme = (iconIds: number[], theme: string) =>
  request<{ ok: boolean; updated: number; theme: string }>("/card-icons/bulk-theme/", {
    method: "POST",
    body: JSON.stringify({ icon_ids: iconIds, theme }),
  });
