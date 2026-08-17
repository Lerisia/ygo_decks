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
  // Rule fields (shown via collapsible 방 규칙 panel in the lobby)
  is_anonymous: boolean;
  spectators_can_chat: boolean;
  quiz_total_rounds: number;
  duchmind_total_rounds: number;
  duchmind_word_pack_name: string | null;
  duchmind_word_pack_series?: "yugioh" | "pokemon";
  duchmind_draw_seconds: number;
  duchmind_word_options: number;
  duchmind_show_word_length: boolean;
  duchmind_show_hints: boolean;
  duchmind_hide_winner_chat: boolean;
  duchmind_first_correct_speedup: boolean;
  twenty_total_rounds: number;
  twenty_mode: "competitive" | "cooperative";
  twenty_guess_attempts: number;
};

import type { PublicCardIcon, Border } from "@/api/avatarApi";

export type RoomPlayer = {
  id: number;
  display_name: string;
  is_guest: boolean;
  score: number;
  is_host: boolean;
  is_spectator: boolean;
  reserved_for_next: boolean;
  joined_at: string;
  avatar_icon: PublicCardIcon | null;
  border: Border | null;
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
  quiz_total_rounds: number;
  quiz_word_pack: number | null;
  quiz_word_pack_name: string | null;
  duchmind_total_rounds: number;
  duchmind_word_pack: number | null;
  duchmind_word_pack_name: string | null;
  duchmind_word_pack_series?: "yugioh" | "pokemon";
  duchmind_draw_seconds: number;
  duchmind_word_options: number;
  duchmind_show_word_length: boolean;
  duchmind_show_hints: boolean;
  duchmind_hide_winner_chat: boolean;
  duchmind_first_correct_speedup: boolean;
  twenty_total_rounds: number;
  twenty_mode: "competitive" | "cooperative";
  twenty_guess_attempts: number;  // per-player per-round, 0 = unlimited
  spectators_can_chat: boolean;
  is_anonymous: boolean;
  players: RoomPlayer[];
  created_at: string;
  last_activity_at: string;
  your_player_id?: number;
};

export type CreateRoomData = {
  name: string;
  password?: string;
  max_players?: number;
  is_listed?: boolean;
  current_game?: string;
  allow_guests?: boolean;
  spectators_can_chat?: boolean;
  duchmind_draw_seconds?: number;
  duchmind_word_options?: number;
  duchmind_show_word_length?: boolean;
  duchmind_show_hints?: boolean;
  duchmind_hide_winner_chat?: boolean;
  duchmind_first_correct_speedup?: boolean;
  is_anonymous?: boolean;
  twenty_mode?: "competitive" | "cooperative";
  twenty_guess_attempts?: number;
  quiz_total_rounds?: number;
  quiz_word_pack?: number | null;
  duchmind_total_rounds?: number;
  duchmind_word_pack?: number | null;
  twenty_total_rounds?: number;
};

export const listRooms = () =>
  request<{ rooms: RoomListItem[] }>("/rooms/");

export const myRoom = () =>
  request<{ room: RoomDetail | null }>("/rooms/my/");

export const createRoom = (data: CreateRoomData) =>
  request<RoomDetail>("/rooms/create/", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getRoom = (roomId: number) =>
  request<RoomDetail>(`/rooms/${roomId}/`);

export const getRoomByCode = (code: string) =>
  request<RoomDetail>(`/rooms/by-code/${code.toUpperCase()}/`);

export type UpdateRoomData = {
  name?: string;
  password?: string;  // omit to keep, "" to clear, non-empty to set
  max_players?: number;
  is_listed?: boolean;
  current_game?: string;
  quiz_total_rounds?: number;
  quiz_word_pack?: number | null;
  duchmind_total_rounds?: number;
  duchmind_word_pack?: number | null;
  twenty_total_rounds?: number;
  twenty_mode?: "competitive" | "cooperative";
  twenty_guess_attempts?: number;
  spectators_can_chat?: boolean;
  allow_guests?: boolean;
  duchmind_show_word_length?: boolean;
  duchmind_show_hints?: boolean;
  duchmind_hide_winner_chat?: boolean;
  duchmind_first_correct_speedup?: boolean;
};

export type GuestSession = {
  token: string;
  nickname: string;
  player_id: number;
  room_id: number;
};

const GUEST_SESSION_KEY = "mp_guest_session";

export function getGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GuestSession;
  } catch {
    return null;
  }
}

export function setGuestSession(s: GuestSession | null) {
  if (s) localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(GUEST_SESSION_KEY);
}

export function getGuestTokenForRoom(roomId: number): string {
  const s = getGuestSession();
  return s && s.room_id === roomId ? s.token : "";
}

export const updateRoom = (roomId: number, data: UpdateRoomData) =>
  request<RoomDetail>(`/rooms/${roomId}/update/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export type JoinRoomResult = RoomDetail & {
  _guest?: { token: string; nickname: string; player_id: number };
};

export const joinRoom = (
  roomId: number,
  password?: string,
  invite?: string,
  asSpectator?: boolean,
  asStealth?: boolean,
) =>
  request<JoinRoomResult>(`/rooms/${roomId}/join/`, {
    method: "POST",
    body: JSON.stringify({
      password: password || "",
      invite: invite || "",
      as_spectator: !!asSpectator,
      as_stealth: !!asStealth,
      guest_token: getGuestTokenForRoom(roomId),
    }),
  });

export const leaveRoom = (roomId: number) =>
  request<{ ok: boolean }>(`/rooms/${roomId}/leave/`, {
    method: "POST",
    body: JSON.stringify({ guest_token: getGuestTokenForRoom(roomId) }),
  });

export const closeRoom = (roomId: number) =>
  request<{ ok: boolean }>(`/rooms/${roomId}/close/`, { method: "POST" });

export const toggleSpectator = (roomId: number) =>
  request<RoomPlayer>(`/rooms/${roomId}/toggle-spectator/`, {
    method: "POST",
    body: JSON.stringify({ guest_token: getGuestTokenForRoom(roomId) }),
  });

// In-game spectators opt in to next-turn promotion. One-way (no cancel).
// Reserved seat counts against `max_players` so the room can't be
// over-reserved.
export const reserveForNext = (roomId: number) =>
  request<RoomPlayer>(`/rooms/${roomId}/reserve-for-next/`, {
    method: "POST",
    body: JSON.stringify({ guest_token: getGuestTokenForRoom(roomId) }),
  });

export const transferHost = (roomId: number, playerId: number) =>
  request<{ ok: boolean }>(`/rooms/${roomId}/transfer-host/${playerId}/`, {
    method: "POST",
  });

export const startGame = (roomId: number) =>
  request<RoomDetail>(`/rooms/${roomId}/start/`, { method: "POST" });

export const endGame = (roomId: number) =>
  request<RoomDetail>(`/rooms/${roomId}/end/`, { method: "POST" });

export const kickPlayer = (roomId: number, playerId: number) =>
  request<{ ok: boolean }>(`/rooms/${roomId}/kick/${playerId}/`, {
    method: "POST",
  });

