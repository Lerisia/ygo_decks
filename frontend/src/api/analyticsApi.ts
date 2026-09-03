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

/** Fire-and-forget page-leave beacon; survives navigation/unload. */
export const sendPageView = (path: string, durationMs: number) => {
  const body = JSON.stringify({ visitor_id: getVisitorId(), path, duration_ms: Math.round(durationMs) });
  const token = localStorage.getItem("access_token");
  // sendBeacon can't carry the Authorization header, so logged-in users are
  // only attributed when fetch/keepalive is available; both are fine.
  if (token && typeof fetch === "function") {
    fetch("/api/analytics/pageview/", {
      method: "POST", keepalive: true, body,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    }).catch(() => {});
    return;
  }
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/analytics/pageview/", new Blob([body], { type: "application/json" }));
  } else {
    fetch("/api/analytics/pageview/", { method: "POST", keepalive: true, body, headers: { "Content-Type": "application/json" } }).catch(() => {});
  }
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
