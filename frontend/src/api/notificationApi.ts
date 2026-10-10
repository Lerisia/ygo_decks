// 마이페이지 알림 (참혈 2026-10-11): 지우기 전까지 마이페이지에 카드로 남고, 지워도 알림 내역에는 남는다.
const API_BASE = "/api/notifications";

export type SiteNotification = {
  id: number;
  sender: string;
  body: string;
  action_label: string;
  action_url: string;
  created_at: string;
  read: boolean;
  // the action button was followed once; it stays disabled after
  acted: boolean;
};

// Fired after a notification is cleared, so the red dot on the profile picture catches up at once.
export const NOTIFICATIONS_UPDATED = "notifications-updated";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getNotifications(unreadOnly = false): Promise<SiteNotification[]> {
  const res = await fetch(`${API_BASE}/${unreadOnly ? "?unread=1" : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).notifications;
}

export async function getUnreadNotificationCount(): Promise<number> {
  const res = await fetch(`${API_BASE}/unread-count/`, { headers: authHeaders() });
  if (!res.ok) return 0;
  return (await res.json()).count ?? 0;
}

async function mark(id: number, what: "dismiss" | "act" | "hide"): Promise<void> {
  await fetch(`${API_BASE}/${id}/${what}/`, { method: "POST", headers: authHeaders() }).catch(() => {});
  window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED));
}

// X on My Page: off My Page, still in the history.
export const dismissNotification = (id: number) => mark(id, "dismiss");
// The action button was followed (also clears it from My Page).
export const actOnNotification = (id: number) => mark(id, "act");
// X on the history page: gone from the history too, though the server keeps the record.
export const hideNotification = (id: number) => mark(id, "hide");
