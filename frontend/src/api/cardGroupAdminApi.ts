/** Staff client for 카드군: the groups worked out from the card texts, their Korean names and members. */
const API_BASE = "/api/carddb/card-groups";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers || {}) },
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

export type NameSource = "pair" | "quote" | "common" | "manual" | "none";
export type MemberHow = "name" | "reading" | "treated" | "added" | "removed";

export type CardGroupRow = {
  id: number;
  text: string;
  reading: string;
  name_ko: string;
  name_source: NameSource;
  name_agreement: number;
  name_coverage: number;
  members: number;
  md_list: boolean;
  needs_review: boolean;
  minor: boolean;
  parent: { id: number; text: string; name_ko: string } | null;
};

export type CardGroupListResponse = {
  results: CardGroupRow[];
  total: number;
  page: number;
  page_size: number;
  all_count: number;
  review_count: number;
};

export type CardGroupMemberRow = {
  card_id: number;
  name: string;
  name_ja: string;
  how: MemberHow;
  image_url: string | null;
};

export type CardGroupDetail = {
  group: CardGroupRow;
  members: CardGroupMemberRow[];
  children: { id: number; text: string; name_ko: string; members: number }[];
};

export const listCardGroups = (p: { q?: string; review?: boolean; page?: number }) => {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.review) qs.set("review", "1");
  if (p.page && p.page > 1) qs.set("page", String(p.page));
  return request<CardGroupListResponse>(`/?${qs.toString()}`);
};

export const getCardGroup = (id: number) => request<CardGroupDetail>(`/${id}/`);

export const updateCardGroup = (id: number, body: { name_ko?: string; reviewed?: boolean; minor?: boolean }) =>
  request<CardGroupDetail>(`/${id}/`, { method: "PATCH", body: JSON.stringify(body) });

export const editCardGroupMember = (id: number, cardId: number, action: "add" | "remove") =>
  request<CardGroupDetail>(`/${id}/members/`, { method: "POST", body: JSON.stringify({ card_id: cardId, action }) });
