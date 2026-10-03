const API_BASE = "/api";

export type ChangelogEntry = {
  id: number;
  title: string;
  body: string;
  published_at: string;
  /** Only staff ever receive future entries; true when not yet shown to everyone. */
  scheduled?: boolean;
};

export type ChangelogDraft = { title: string; body: string; published_at?: string };

async function request<T>(path: string, init?: RequestInit, withAuth = false): Promise<T> {
  const token = withAuth ? localStorage.getItem("access_token") : null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Public list; staff pass withAuth to also get scheduled entries. */
export function listChangelog(withAuth = false): Promise<ChangelogEntry[]> {
  return request<ChangelogEntry[]>("/changelog/", undefined, withAuth);
}

export function getLatestChangelog(): Promise<{ entry: ChangelogEntry | null }> {
  return request<{ entry: ChangelogEntry | null }>("/changelog/latest/");
}

// 운영진 전용 공지 쓰기 (특이점 2026-10-03)
export function createChangelog(draft: ChangelogDraft): Promise<ChangelogEntry> {
  return request<ChangelogEntry>("/changelog/", { method: "POST", body: JSON.stringify(draft) }, true);
}

export function updateChangelog(id: number, draft: ChangelogDraft): Promise<ChangelogEntry> {
  return request<ChangelogEntry>(`/changelog/${id}/`, { method: "PUT", body: JSON.stringify(draft) }, true);
}

export function deleteChangelog(id: number): Promise<void> {
  return request<void>(`/changelog/${id}/`, { method: "DELETE" }, true);
}
