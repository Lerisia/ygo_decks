const API_BASE = "/api";

export type ChangelogEntry = {
  id: number;
  title: string;
  body: string;
  published_at: string;
};

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
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

export function listChangelog(): Promise<ChangelogEntry[]> {
  return request<ChangelogEntry[]>("/changelog/");
}

export function getLatestChangelog(): Promise<{ entry: ChangelogEntry | null }> {
  return request<{ entry: ChangelogEntry | null }>("/changelog/latest/");
}
