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

export async function dismissNotification(id: number): Promise<void> {
  await fetch(`${API_BASE}/${id}/dismiss/`, { method: "POST", headers: authHeaders() }).catch(() => {});
  window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED));
}
