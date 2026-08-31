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

export type TournamentFormat = "single_elim" | "swiss" | "round_robin" | "swiss_cut";
export type TournamentStatus = "recruiting" | "ongoing" | "completed" | "cancelled";

export type Entrant = {
  id: number;
  user: number | null;
  name: string;
  status: "registered" | "checked_in" | "withdrawn" | "kicked";
  seed: number | null;
  md_uid: string | null;
  avatar_icon: AvatarIcon | null;
  border: Border | null;
};

export type MatchItem = {
  id: number;
  bracket_pos: number;
  entrant1: Entrant;
  entrant2: Entrant | null;
  result: "p1" | "p2" | "draw" | "bye" | null;
  report_status: "pending" | "reported" | "confirmed" | "disputed";
  reported_by: number | null;
};

export type RoundItem = { number: number; status: "ongoing" | "completed"; stage: "swiss" | "knockout" | "league" | "main"; matches: MatchItem[] };

export type TournamentListItem = {
  id: number;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  capacity: number;
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
  wins: number;
  draws: number;
  losses: number;
  points: number;
  buchholz: number;
  avatar_icon: AvatarIcon | null;
  border: Border | null;
};

export const listTournaments = () => req<TournamentListItem[]>("/");
export const getTournament = (id: number) => req<TournamentDetail>(`/${id}/`);
export const createTournament = (payload: {
  name: string; description?: string; format: TournamentFormat;
  capacity: number; event_date: string; format_config?: Record<string, unknown>;
}, coverFile?: File | null) => {
  if (!coverFile) {
    return req<TournamentDetail>("/create/", { method: "POST", body: JSON.stringify(payload) });
  }
  const form = new FormData();
  form.append("name", payload.name);
  if (payload.description) form.append("description", payload.description);
  form.append("format", payload.format);
  form.append("capacity", String(payload.capacity));
  form.append("event_date", payload.event_date);
  if (payload.format_config) form.append("format_config", JSON.stringify(payload.format_config));
  form.append("cover_image", coverFile);
  return req<TournamentDetail>("/create/", { method: "POST", body: form });
};

export const updateCover = (id: number, coverFile: File | null) => {
  const form = new FormData();
  if (coverFile) form.append("cover_image", coverFile);
  return req<TournamentDetail>(`/${id}/cover/`, { method: "POST", body: form });
};

export const registerTournament = (id: number, mdUid?: string) =>
  req<Entrant>(`/${id}/register/`, { method: "POST", body: JSON.stringify(mdUid ? { md_uid: mdUid } : {}) });
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
