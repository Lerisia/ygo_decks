/** Staff client for the scanner test set: real uploads whose boxes (카드, 덱 칸, 머리글) staff check. */
const API_BASE = "/api/scanner/samples";

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

/** x, y (top left), w, h in fractions of the picture. */
export type ScanBox = { c: string; x: number; y: number; w: number; h: number };
export type ScanStatus = "todo" | "done" | "skip";
export type ScanSampleRow = { id: number; kind: string; status: ScanStatus; image_url: string; width: number; height: number; boxes: number; note: string };
export type ScanSampleDoc = Omit<ScanSampleRow, "boxes"> & { boxes: ScanBox[]; reviewed_by: string | null };
export type ScanSampleList = {
  results: ScanSampleRow[];
  counts: Record<ScanStatus, number>;
  classes: { key: string; label: string }[];
  kinds: { key: string; label: string }[];
};

export const listScanSamples = (f: { status?: string; kind?: string }) => {
  const qs = new URLSearchParams();
  if (f.status) qs.set("status", f.status);
  if (f.kind) qs.set("kind", f.kind);
  return request<ScanSampleList>(`/?${qs}`);
};
export const getScanSample = (id: number) => request<ScanSampleDoc>(`/${id}/`);
export const saveScanSample = (id: number, body: { boxes?: ScanBox[]; status?: ScanStatus; note?: string }) =>
  request<ScanSampleDoc>(`/${id}/`, { method: "PUT", body: JSON.stringify(body) });
