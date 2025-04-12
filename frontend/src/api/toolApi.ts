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

export const createRecordGroup = async (name: string) => {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`${API_BASE_URL}/record-groups/create/`, {
    method: "POST",
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
    deck?: number;
    opponent_deck?: number | null;
    first_or_second?: "first" | "second";
    coin_toss_result?: "win" | "lose";
    result?: "win" | "lose";
    rank?: string | null;
    score?: number | null;
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
  deck: number;
  opponent_deck: number | null;
  first_or_second: "first" | "second";
  result: "win" | "lose";
  notes?: string;
  coin_toss_result?: "win" | "lose";
  rank?: string;
  score?: number;
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

export const getRecordGroupStatisticsFull = async (recordGroupId: number) => {
  const response = await fetch(`${API_BASE_URL}/record-groups/${recordGroupId}/statistics/full`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
};

export const getRecordGroupMatches = async (recordGroupId: number, page: number, pageSize: number) => {
  let url = `/api/record-groups/${recordGroupId}/matches/?page=${page}&page_size=${pageSize}`;

  const response = await fetch(url, {
    method: "GET",
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

export type MetaDeckStatsResponse = {
  total_matches: number;
  meta_decks: MetaDeckStat[];
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
