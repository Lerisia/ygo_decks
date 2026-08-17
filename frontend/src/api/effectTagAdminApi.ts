/** Admin-only client for LLM-classified card effect tags. The 13 tag flags
 *  are LLM-derived (12 of them) or namuwiki-sourced (`hand_trap`); this UI
 *  is the audit/correction surface where a human flips wrong values. */
const API_BASE = "/api/admin/effect-tags";

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
    if (res.status === 401 || res.status === 403) throw new Error("관리자 권한이 필요합니다.");
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || body.detail || JSON.stringify(body);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export type EffectTagRow = {
  card_pk: number;
  card_id: string;
  korean_name: string;
  frame_type: string;
  card_type: string;
  image_url: string;
  description: string;
  tags: Record<string, boolean>;
  manually_reviewed: boolean;
  classifier_version: string;
};

export type EffectTagListResponse = {
  results: EffectTagRow[];
  page: number;
  page_size: number;
  total: number;
  total_with_tags: number;
  total_reviewed: number;
  tag_fields: string[];
  tag_labels: Record<string, string>;
  per_tag_count: Record<string, number>;
};

export type EffectTagFilters = {
  tag?: string;          // require this tag = true
  missing_tag?: string;  // require this tag = false
  q?: string;
  reviewed?: "yes" | "no" | "any";
  has_tags?: "yes" | "no" | "any";
  page?: number;
};

export const listEffectTags = (filters: EffectTagFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.missing_tag) params.set("missing_tag", filters.missing_tag);
  if (filters.q) params.set("q", filters.q);
  if (filters.reviewed && filters.reviewed !== "any") params.set("reviewed", filters.reviewed);
  if (filters.has_tags && filters.has_tags !== "any") params.set("has_tags", filters.has_tags);
  if (filters.page) params.set("page", String(filters.page));
  const qs = params.toString();
  return request<EffectTagListResponse>(`/${qs ? `?${qs}` : ""}`);
};

export const updateEffectTag = (cardPk: number, patch: Record<string, boolean>) =>
  request<EffectTagRow>(`/${cardPk}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
