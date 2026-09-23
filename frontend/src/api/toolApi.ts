const API_BASE_URL = "/api";

export const getUserRecordGroups = async () => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/record-groups/`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export const createRecordGroup = async (name: string, kind: "solo" | "shared" = "solo") => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/record-groups/create/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, kind }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export const updateRecordGroupName = async (recordGroupId: number, name: string) => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/update-name/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export const updateMatchRecord = async (
  matchId: number,
  data: {
    deck?: number | null;
    opponent_deck?: number | null;
    opponent_deck_name?: string | null;
    first_or_second?: "first" | "second";
    coin_toss_result?: "win" | "lose";
    result?: "win" | "lose";
    rank?: string | null;
    wins?: number | null;
    score?: number | null;
    score_type?: string | null;
    notes?: string;
  }
) => {
  const token = localStorage.getItem("access_token");

  const response = await fetch(`${API_BASE_URL}/match-records/${matchId}/update/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.error || `수정 실패: ${response.status}`);
  }

  return response.json();
};

export const updateRecordGroupVisibility = async (recordGroupId: number, isPublic: boolean) => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/update-visibility/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ is_public: isPublic }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export const deleteRecordGroup = async (recordGroupId: number) => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/delete/`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }
};

type NewMatchPayload = {
  deck: number | null;
  opponent_deck: number | null;
  opponent_deck_name?: string | null;
  first_or_second: "first" | "second";
  result: "win" | "lose";
  notes?: string;
  coin_toss_result?: "win" | "lose";
  rank?: string;
  wins?: number | null;
  score?: number;
  score_type?: string | null;
  tracker_pending_id?: number | null;
};

export const addMatchToRecordGroup = async (
  recordGroupId: number,
  data: NewMatchPayload
) => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/add-match/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export const deleteMatchRecord = async (matchId: number) => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/match-records/${matchId}/delete/`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }
};

export const getRecordGroupStatistics = async (recordGroupId: number) => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/statistics/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export const getRecordGroupStatisticsFull = async (recordGroupId: number, deckId?: number, memberId?: number | null) => {
  const qs = [deckId ? `deck_id=${deckId}` : "", memberId ? `member=${memberId}` : ""].filter(Boolean).join("&");
  const params = qs ? `?${qs}` : "";
  const token = localStorage.getItem("access_token");
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/statistics/full${params}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export const getRecordGroupMatches = async (recordGroupId: number, page: number, pageSize: number, memberId?: number | null) => {
  const url = `/api/record-groups/${recordGroupId}/matches/?page=${page}&page_size=${pageSize}`
    + (memberId ? `&member=${memberId}` : "");
  const token = localStorage.getItem("access_token");
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export type MetaDeckStat = {
  meta_deck_id: number;
  meta_deck_name: string;
  appearance_percent: number;
  win_rate: number;
};

export type PlayerDeckStat = {
  deck_id: number;
  deck_name: string;
  appearance_percent: number;
  win_rate: number;
};

export type MetaDeckStatsResponse = {
  total_matches: number;
  meta_decks: MetaDeckStat[];
  player_decks: PlayerDeckStat[];
};

export const getMetaDeckStats = async () => {
  const response = await fetch(`${API_BASE_URL}/recent-meta-deck-stats/`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return await response.json();
};

export const getUserStatisticsFull = async (deckId?: number) => {
  const params = deckId ? `?deck_id=${deckId}` : "";
  const token = localStorage.getItem("access_token");
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await fetch(`${API_BASE_URL}/record-groups/statistics/full/${params}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }
  return response.json();
};

export const getRecordGroupRankHistory = async (recordGroupId: number, memberId?: number | null) => {
  const token = localStorage.getItem("access_token");
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(
    `${API_BASE_URL}/record-groups/${recordGroupId}/rank-history/${memberId ? `?member=${memberId}` : ""}`,
    { headers },
  );

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return await response.json();
};

// ---- shared sheets ----
export type SheetMember = {
  id: number;
  username: string;
  icon: string | null;
  border: string | null;
  role: "editor" | "viewer";
  joined_at: string;
};

export type SheetMembers = {
  kind: "solo" | "shared";
  my_role: "owner" | "editor" | "viewer" | "public" | null;
  owner: { id: number; username: string; icon: string | null; border: string | null };
  members: SheetMember[];
  invite_code: string;
};

export type SheetContributor = {
  user: { id: number; username: string; icon: string | null; border: string | null } | null;
  games: number;
  wins: number;
  win_rate: number | null;
};

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("access_token")}`,
});

const jsonOrThrow = async (res: Response) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API 요청 실패: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
};

export const getSheetMembers = async (recordGroupId: number): Promise<SheetMembers> =>
  jsonOrThrow(await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/members/`, { headers: authHeaders(), credentials: "include" }));

export const addSheetMember = async (
  recordGroupId: number,
  who: { userId?: number; username?: string },
  role: "editor" | "viewer" = "editor"
): Promise<SheetMembers> =>
  jsonOrThrow(await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/members/`, {
    method: "POST", headers: authHeaders(), credentials: "include",
    body: JSON.stringify({ user_id: who.userId, username: who.username, role }),
  }));

export const removeSheetMember = async (recordGroupId: number, userId: number) =>
  jsonOrThrow(await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/members/${userId}/`, {
    method: "DELETE", headers: authHeaders(), credentials: "include",
  }));

export const issueSheetInvite = async (recordGroupId: number, disable = false): Promise<{ invite_code: string; kind: string }> =>
  jsonOrThrow(await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/invite/`, {
    method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify({ disable }),
  }));

export const joinSheetByCode = async (code: string): Promise<{ record_group_id: number; name: string; role: string }> =>
  jsonOrThrow(await fetch(`${API_BASE_URL}/record-groups/join/`, {
    method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify({ code }),
  }));

export const getSheetContributors = async (recordGroupId: number): Promise<{ contributors: SheetContributor[] }> =>
  jsonOrThrow(await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/contributors/`, { headers: authHeaders(), credentials: "include" }));
