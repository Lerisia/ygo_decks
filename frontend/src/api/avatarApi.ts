const API_BASE = "/api/avatar";

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
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || body.detail || JSON.stringify(body);
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export type PublicCardIcon = {
  id: number;
  title: string;
  card: number;
  card_id: string;
  card_name: string;
  card_image_url: string | null;
  center_x: number;
  center_y: number;
  radius: number;
};

export const listPublicIcons = (q?: string) =>
  request<{ icons: PublicCardIcon[] }>(`/card-icons/public/${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const getMyAvatar = () =>
  request<{ icon: PublicCardIcon | null; is_default: boolean }>("/me/");

export const setMyAvatar = (iconId: number | null) =>
  request<{ ok: boolean; icon: PublicCardIcon | null }>("/me/set/", {
    method: "POST",
    body: JSON.stringify({ icon_id: iconId }),
  });
