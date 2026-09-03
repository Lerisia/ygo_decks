const VISITOR_KEY = "ygo_visitor_id";

export const getVisitorId = (): string => {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
};

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("access_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

/** Page entry: creates the row immediately so the view is counted even if
 *  the leave beacon is lost (tab closed, Safari unload). Returns the row id. */
export const startPageView = async (path: string): Promise<number | null> => {
  try {
    const res = await fetch("/api/analytics/pageview/", {
      method: "POST", keepalive: true, headers: authHeaders(),
      body: JSON.stringify({ visitor_id: getVisitorId(), path, duration_ms: 0 }),
    });
    if (!res.ok) return null;
    return (await res.json()).id ?? null;
  } catch { return null; }
};

/** Page leave: attaches the dwell time to the row from startPageView. */
export const leavePageView = (id: number, durationMs: number) => {
  try {
    fetch(`/api/analytics/pageview/${id}/leave/`, {
      method: "POST", keepalive: true, headers: authHeaders(),
      body: JSON.stringify({ visitor_id: getVisitorId(), duration_ms: Math.round(durationMs) }),
    }).catch(() => {});
  } catch { /* ignore */ }
};

export type DailyRow = { date: string; visitors: number; views: number; dwell_sec: number; avg_dwell_sec: number };
export type TopPage = { path: string; views: number; visitors: number; dwell_sec: number };
export type AnalyticsSummary = {
  range_days: number;
  today: { visitors: number; views: number; dwell_sec: number };
  daily: DailyRow[];
  top_pages: TopPage[];
};

export const getAnalyticsSummary = async (days: number): Promise<AnalyticsSummary> => {
  const res = await fetch(`/api/analytics/summary/?days=${days}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
  });
  if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
  return res.json();
};
