// 문의 게시판 (특이점 2026-10-07): 덱 관련 제보 / 건의, 사이트 관련 문의.
const API_BASE = "/api";

export type InquiryBoard = "deck" | "site";

export const BOARD_INFO: Record<InquiryBoard, { title: string; icon: string; desc: string; placeholder: string }> = {
  deck: {
    title: "덱 관련 제보 / 건의 게시판",
    icon: "🃏",
    desc: "덱 정보·설명·스탯이 틀렸을 때, 새 덱 추가나 덱 분류 건의",
    placeholder: "어떤 덱의 무엇이 틀렸는지, 어떻게 바뀌면 좋을지 적어 주세요.\n근거(카드 텍스트, 공략 링크 등)를 함께 적어 주시면 더 빨리 반영할 수 있어요.",
  },
  site: {
    title: "사이트 관련 문의 게시판",
    icon: "🛠️",
    desc: "사이트·레코더 오류나 문제, 이용 방법, 그 밖의 사이트 관련 문의",
    placeholder: "어떤 화면에서 무엇을 했을 때 어떤 문제가 생겼는지 적어 주세요.\n기기(PC·휴대폰)와 브라우저도 알려 주시면 큰 도움이 돼요.",
  },
};

export type InquiryComment = { id: number; body: string; created_at: string };

export type InquiryPost = {
  id: number;
  board: InquiryBoard;
  board_label: string;
  title: string;
  is_private: boolean;
  answered: boolean;
  comment_count: number | null;
  created_at: string;
  mine: boolean;
  can_view: boolean;
  /** Staff only. */
  author_name?: string;
  body?: string;
  comments?: InquiryComment[];
  notify_email?: boolean;
};

export type InquiryPage = { results: InquiryPost[]; total: number; page: number; pages: number; unanswered?: number };

export class InquiryError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("access_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const msg = (data as { error?: string; detail?: string } | null)?.error || (data as { detail?: string } | null)?.detail || `HTTP ${res.status}`;
    throw new InquiryError(msg, res.status, data);
  }
  return data as T;
}

export function listInquiries(board: InquiryBoard, page = 1, mine = false): Promise<InquiryPage> {
  return request<InquiryPage>(`/inquiry/?board=${board}&page=${page}${mine ? "&mine=1" : ""}`);
}

export function getInquiry(id: number): Promise<InquiryPost> {
  return request<InquiryPost>(`/inquiry/${id}/`);
}

export function createInquiry(draft: { board: InquiryBoard; title: string; body: string; is_private: boolean; notify_email: boolean }): Promise<InquiryPost> {
  return request<InquiryPost>("/inquiry/", { method: "POST", body: JSON.stringify(draft) });
}

export function deleteInquiry(id: number): Promise<void> {
  return request<void>(`/inquiry/${id}/`, { method: "DELETE" });
}

export function answerInquiry(id: number, body: string): Promise<InquiryComment> {
  return request<InquiryComment>(`/inquiry/${id}/comments/`, { method: "POST", body: JSON.stringify({ body }) });
}

export function deleteInquiryAnswer(commentId: number): Promise<void> {
  return request<void>(`/inquiry/comments/${commentId}/`, { method: "DELETE" });
}

export function formatInquiryDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
