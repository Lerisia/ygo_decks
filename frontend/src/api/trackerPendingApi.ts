// Games captured by the PC tracker that wait for the user's confirmation on the record page.
const API_BASE_URL = "/api";

export type DeckCandidate = { deck_id: number; name: string; score?: number; share?: number; source?: "inferred" | "remembered" };
export type CardName = { id: number; name: string; count: number };

export type TrackerPendingMatch = {
  id: number;
  did: string;
  status: string;
  created_at: string;
  game_mode: number;            // 3 rank, 19 rate
  result: "win" | "lose" | "draw" | string;
  finish: string;
  coin_win: boolean;
  first: boolean;
  my_name: string;
  opp_name: string;
  rank_before: { rank: number; tier: number } | null;
  rank_after: { rank: number; tier: number } | null;
  rank_code: string | null;     // post-game rank code, e.g. "bronze3"
  wins: number | null;          // post-game gauge (estimated by the tracker)
  rating_before: number | null;
  rating_after: number | null;
  turn: number;
  md_deck_id: string | null;
  my_cards: number[];
  opp_cards: number[];
  my_candidates: DeckCandidate[];
  opp_candidates: DeckCandidate[];
  my_card_names: CardName[];
  opp_card_names: CardName[];
  suggested_deck: DeckCandidate | null;
  suggested_opp_deck: DeckCandidate | null;
  started_at: string | null;
  ended_at: string | null;
};

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("access_token")}`,
});

export const getTrackerPending = async (): Promise<TrackerPendingMatch[]> => {
  const res = await fetch(`${API_BASE_URL}/tracker/pending/`, { headers: authHeaders(), credentials: "include" });
  if (!res.ok) throw new Error(`API 요청 실패: ${res.status}`);
  return res.json();
};

export const discardTrackerPending = async (id: number) => {
  const res = await fetch(`${API_BASE_URL}/tracker/pending/${id}/discard/`, { method: "POST", headers: authHeaders(), credentials: "include" });
  if (!res.ok) throw new Error(`API 요청 실패: ${res.status}`);
  return res.json();
};

export type TrackerClientStatus = {
  version: string | null;
  latest: string;
  outdated: boolean;
  used_tracker: boolean;
  url: string;
  last_seen: string | null;
};

export const getTrackerClientStatus = async (): Promise<TrackerClientStatus> => {
  const res = await fetch(`${API_BASE_URL}/tracker/client-status/`, { headers: authHeaders(), credentials: "include" });
  if (!res.ok) throw new Error(`API 요청 실패: ${res.status}`);
  return res.json();
};
