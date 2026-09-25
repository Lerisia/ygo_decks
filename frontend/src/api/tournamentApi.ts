import type { AvatarIcon } from "@/components/Avatar";
import type { Border } from "@/api/avatarApi";

const BASE = "/api/tournaments";

const authHeaders = (): HeadersInit => {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let msg = `요청 실패 (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

export type TournamentFormat = "single_elim" | "swiss" | "round_robin" | "swiss_cut" | "group_knockout" | "double_elim";
export type TournamentStatus = "recruiting" | "ongoing" | "completed" | "cancelled";

export type TeamMember = {
  id: number;
  user: number;
  name: string;
  md_uid: string | null;
  is_captain: boolean;
  order: number;
  avatar_icon: AvatarIcon | null;
  border: Border | null;
};

export type Entrant = {
  id: number;
  user: number | null;
  name: string;
  status: "registered" | "checked_in" | "withdrawn" | "kicked";
  seed: number | null;
  md_uid: string | null;
  avatar_icon: AvatarIcon | null;
  border: Border | null;
  members: TeamMember[];
  join_code: string | null;
};

export type Board = {
  id: number;
  order: number;
  member1: TeamMember | null;
  member2: TeamMember | null;
  result: "p1" | "p2" | null;
  report_status: "pending" | "reported" | "confirmed" | "disputed";
  reported_by: number | null;
};

export type MatchItem = {
  id: number;
  bracket_pos: number;
  group: number | null;
  bracket: "" | "winners" | "losers" | "final";
  entrant1: Entrant;
  entrant2: Entrant | null;
  result: "p1" | "p2" | "draw" | "bye" | null;
  report_status: "pending" | "reported" | "confirmed" | "disputed";
  reported_by: number | null;
  boards: Board[];
};

export type RoundItem = { number: number; status: "ongoing" | "completed"; stage: "swiss" | "knockout" | "league" | "main"; matches: MatchItem[] };

export type TournamentListItem = {
  id: number;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  capacity: number;
  team_size: number;
  event_date: string;
  current_round: number;
  host_name: string;
  entrant_count: number;
  cover_image: string | null;
  created_at: string;
};

export type TournamentDetail = TournamentListItem & {
  description: string;
  format_config: Record<string, unknown>;
  host: number;
  host_avatar_icon: AvatarIcon | null;
  host_border: Border | null;
  entrants: Entrant[];
  rounds: RoundItem[];
};

export type StandingRow = {
  entrant_id: number;
  name: string;
  user: number | null;
  members: { id: number; name: string; is_captain: boolean; avatar_icon: AvatarIcon | null; border: Border | null }[];
  wins: number;
  draws: number;
  losses: number;
  points: number;
  buchholz: number;
  group: number | null;
  qualified: boolean;
  dropped: boolean;
  avatar_icon: AvatarIcon | null;
  border: Border | null;
};

export const GROUP_LABEL = (g: number) => `${String.fromCharCode(65 + g)}조`;

export const listTournaments = () => req<TournamentListItem[]>("/");
export const getTournament = (id: number) => req<TournamentDetail>(`/${id}/`);
export const createTournament = (payload: {
  name: string; description?: string; format: TournamentFormat;
  capacity: number; team_size?: number; event_date: string; format_config?: Record<string, unknown>;
}, coverFile?: File | null) => {
  if (!coverFile) {
    return req<TournamentDetail>("/create/", { method: "POST", body: JSON.stringify(payload) });
  }
  const form = new FormData();
  form.append("name", payload.name);
  if (payload.description) form.append("description", payload.description);
  form.append("format", payload.format);
  form.append("capacity", String(payload.capacity));
  if (payload.team_size) form.append("team_size", String(payload.team_size));
  form.append("event_date", payload.event_date);
  if (payload.format_config) form.append("format_config", JSON.stringify(payload.format_config));
  form.append("cover_image", coverFile);
  return req<TournamentDetail>("/create/", { method: "POST", body: form });
};

export const updateTournament = (id: number, payload: {
  name?: string; description?: string; event_date?: string; capacity?: number;
  format?: TournamentFormat; format_config?: Record<string, unknown>;
}) => req<TournamentDetail>(`/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
export const cancelTournament = (id: number) => req<TournamentDetail>(`/${id}/cancel/`, { method: "POST", body: "{}" });

export const updateCover = (id: number, coverFile: File | null) => {
  const form = new FormData();
  if (coverFile) form.append("cover_image", coverFile);
  return req<TournamentDetail>(`/${id}/cover/`, { method: "POST", body: form });
};

export const registerTournament = (id: number, mdUid?: string, teamName?: string) =>
  req<Entrant>(`/${id}/register/`, { method: "POST", body: JSON.stringify({ ...(mdUid ? { md_uid: mdUid } : {}), ...(teamName ? { team_name: teamName } : {}) }) });
export const joinTeam = (id: number, code: string, mdUid?: string) =>
  req<Entrant>(`/${id}/team/join/`, { method: "POST", body: JSON.stringify({ code, ...(mdUid ? { md_uid: mdUid } : {}) }) });
export const leaveTeam = (id: number) => req<{ ok: boolean }>(`/${id}/team/leave/`, { method: "POST", body: "{}" });
export const setTeamOrder = (id: number, memberIds: number[]) =>
  req<Entrant>(`/${id}/team/order/`, { method: "POST", body: JSON.stringify({ members: memberIds }) });
export const setLineup = (matchId: number, memberIds: number[]) =>
  req<{ ok: boolean }>(`/matches/${matchId}/lineup/`, { method: "POST", body: JSON.stringify({ members: memberIds }) });
export const reportBoard = (boardId: number, result: "win" | "lose") =>
  req<{ ok: boolean }>(`/boards/${boardId}/report/`, { method: "POST", body: JSON.stringify({ result }) });
export const confirmBoard = (boardId: number) => req<{ ok: boolean }>(`/boards/${boardId}/confirm/`, { method: "POST", body: "{}" });
export const disputeBoard = (boardId: number) => req<{ ok: boolean }>(`/boards/${boardId}/dispute/`, { method: "POST", body: "{}" });
export const overrideBoard = (boardId: number, result: "p1" | "p2") =>
  req<{ ok: boolean }>(`/boards/${boardId}/override/`, { method: "POST", body: JSON.stringify({ result }) });
export const withdrawTournament = (id: number) => req<{ ok: boolean }>(`/${id}/withdraw/`, { method: "POST", body: "{}" });
export const checkInTournament = (id: number) => req<{ ok: boolean }>(`/${id}/check-in/`, { method: "POST", body: "{}" });
export const kickEntrant = (id: number, entrantId: number) =>
  req<{ ok: boolean }>(`/${id}/kick/`, { method: "POST", body: JSON.stringify({ entrant_id: entrantId }) });

export const startTournament = (id: number) => req<TournamentDetail>(`/${id}/start/`, { method: "POST", body: "{}" });
export const nextRound = (id: number) => req<TournamentDetail>(`/${id}/next-round/`, { method: "POST", body: "{}" });
export const completeTournament = (id: number) => req<TournamentDetail>(`/${id}/complete/`, { method: "POST", body: "{}" });
export const getStandings = (id: number) => req<StandingRow[]>(`/${id}/standings/`);

export const reportMatch = (matchId: number, result: "win" | "lose" | "draw") =>
  req<{ ok: boolean }>(`/matches/${matchId}/report/`, { method: "POST", body: JSON.stringify({ result }) });
export const confirmMatch = (matchId: number) => req<{ ok: boolean }>(`/matches/${matchId}/confirm/`, { method: "POST", body: "{}" });
export const disputeMatch = (matchId: number) => req<{ ok: boolean }>(`/matches/${matchId}/dispute/`, { method: "POST", body: "{}" });
export const overrideMatch = (matchId: number, result: "p1" | "p2" | "draw") =>
  req<{ ok: boolean }>(`/matches/${matchId}/override/`, { method: "POST", body: JSON.stringify({ result }) });


// --- deck submission / announcements / chat ---------------------------------

export type DeckCard = {
  id: number;
  card: { id: number; name: string; image_url: string | null };
  quantity: number;
  confidence: number | null;
  source: "auto" | "manual";
};
export type DeckSubmission = {
  id: number;
  entrant_id: number;
  member: number | null;
  image: string | null;
  unmatched_count: number;
  cards: DeckCard[];
  locked: boolean;
  updated_at: string;
};
export type Announcement = { id: number; content: string; pinned: boolean; created_at: string };
export type ChatMessage = {
  id: number; user: number; username: string; team: number | null; content: string; created_at: string;
  avatar_icon: AvatarIcon | null; border: Border | null;
};

export const getDeck = (id: number, entrantId?: number, memberId?: number) =>
  req<DeckSubmission>(`/${id}/deck/${memberId ? `?member_id=${memberId}` : entrantId ? `?entrant_id=${entrantId}` : ""}`);
export const uploadDeck = (id: number, file: File) => {
  const form = new FormData();
  form.append("image", file);
  return req<DeckSubmission>(`/${id}/deck/`, { method: "POST", body: form });
};
export const addDeckCard = (id: number, cardId: number, quantity: number) =>
  req<DeckSubmission>(`/${id}/deck/cards/`, { method: "POST", body: JSON.stringify({ card_id: cardId, quantity }) });
export const removeDeckCard = (id: number, rowId: number) =>
  req<{ ok: boolean }>(`/${id}/deck/cards/${rowId}/`, { method: "DELETE" });

export const getAnnouncements = (id: number) => req<Announcement[]>(`/${id}/announcements/`);
export const postAnnouncement = (id: number, content: string, pinned: boolean) =>
  req<Announcement>(`/${id}/announcements/`, { method: "POST", body: JSON.stringify({ content, pinned }) });
export const deleteAnnouncement = (announcementId: number) =>
  req<{ ok: boolean }>(`/announcements/${announcementId}/`, { method: "DELETE" });

export const getChat = (id: number, after?: number, team = false) => {
  const q = [after ? `after=${after}` : "", team ? "team=1" : ""].filter(Boolean).join("&");
  return req<ChatMessage[]>(`/${id}/chat/${q ? `?${q}` : ""}`);
};
export const postChat = (id: number, content: string, team = false) =>
  req<ChatMessage>(`/${id}/chat/`, { method: "POST", body: JSON.stringify({ content, ...(team ? { team: true } : {}) }) });
