const API_BASE = "/api/multiplayer";

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

export type RoomListItem = {
  id: number;
  name: string;
  host_name: string;
  has_password: boolean;
  max_players: number;
  player_count: number;
  allow_guests: boolean;
  status: "waiting" | "in_game" | "closed";
  current_game: string;
  created_at: string;
};

export type RoomPlayer = {
  id: number;
  display_name: string;
  is_guest: boolean;
  score: number;
  is_host: boolean;
  joined_at: string;
};

export type RoomDetail = {
  id: number;
  code: string;
  name: string;
  host: number;
  host_name: string;
  has_password: boolean;
  max_players: number;
  allow_guests: boolean;
  is_listed: boolean;
  status: "waiting" | "in_game" | "closed";
  current_game: string;
  game_state: Record<string, unknown>;
  players: RoomPlayer[];
  created_at: string;
  last_activity_at: string;
};

export type CreateRoomData = {
  name: string;
  password?: string;
  max_players?: number;
  is_listed?: boolean;
  current_game?: string;
};

export const listRooms = () =>
  request<{ rooms: RoomListItem[] }>("/rooms/");

export const createRoom = (data: CreateRoomData) =>
  request<RoomDetail>("/rooms/create/", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getRoom = (roomId: number) =>
  request<RoomDetail>(`/rooms/${roomId}/`);

export type UpdateRoomData = {
  name?: string;
  password?: string;  // omit to keep, "" to clear, non-empty to set
  max_players?: number;
  is_listed?: boolean;
  current_game?: string;
};

export const updateRoom = (roomId: number, data: UpdateRoomData) =>
  request<RoomDetail>(`/rooms/${roomId}/update/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const joinRoom = (roomId: number, password?: string) =>
  request<RoomDetail>(`/rooms/${roomId}/join/`, {
    method: "POST",
    body: JSON.stringify({ password: password || "" }),
  });

export const leaveRoom = (roomId: number) =>
  request<{ ok: boolean }>(`/rooms/${roomId}/leave/`, { method: "POST" });

export const kickPlayer = (roomId: number, playerId: number) =>
  request<{ ok: boolean }>(`/rooms/${roomId}/kick/${playerId}/`, {
    method: "POST",
  });
