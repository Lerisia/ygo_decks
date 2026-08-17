/** Solo 딱무고개 (twenty questions) API client. The server picks a secret
 *  card from the 중급 word pack; the player asks structured yes/no
 *  questions, each consuming 1 of 20 turns, until they guess the card or
 *  run out. */
const API_BASE = "/api/solo/twenty";

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
    if (res.status === 401) throw new Error("로그인 후 이용해주세요.");
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || body.detail || JSON.stringify(body);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export type TwMenuItem = {
  q_type: string;
  q_value: string | number;
  label: string;
};
export type TwMenuListGroup = {
  group: string;
  kind: "list";
  items: TwMenuItem[];
};
export type TwMenuNumberGroup = {
  group: string;
  kind: "number";
  // [gte_type, lte_type, eq_type] — e.g., ["atk_gte", "atk_lte", "atk_eq"].
  q_types: [string, string, string];
  min: number;
  max: number;
  step: number;
  placeholder: string;
};
// Multi-select group: the player can tick multiple values; the "묻기" button
// fires one question that returns YES if the card's value matches ANY of
// the selected options. The single `multi_q_type` is what the server expects.
export type TwMenuMultiselectGroup = {
  group: string;
  kind: "multiselect";
  multi_q_type: string;  // e.g. "attribute_in" or "race_in"
  items: { q_value: string | number; label: string }[];
  // When true the FE renders a search input above the list (used for the
  // 아키타입 group with hundreds of entries).
  searchable?: boolean;
};
export type TwMenuGroup = TwMenuListGroup | TwMenuNumberGroup | TwMenuMultiselectGroup;

export type TwHistoryEntry = {
  kind: "ask" | "guess" | "hint";
  q_type: string;
  q_value: string | number;
  q_text: string;
  answer: boolean;
  choice_name?: string;
  hint_dim?: string;
  hint_label?: string;
  hint_value?: string;
};

export type TwGameStatus = "active" | "won" | "lost";
export type TwDifficulty = "초급" | "중급" | "고급";

export type TwGame = {
  id: number;
  questions_used: number;
  questions_remaining: number;
  total_questions: number;
  history: TwHistoryEntry[];
  status: TwGameStatus;
  difficulty: TwDifficulty;
  exclude_st: boolean;
  hints_used: number;
  hints_max: number;
  hint_remaining_per_dim?: Record<string, number>;
  points_awarded: number;
  started_at: string | null;
  ended_at: string | null;
  // Populated only when status !== "active"
  answer?: {
    card_id: string;
    name: string;
    image_url: string | null;
  };
};

export type TwCurrent = {
  game: TwGame | null;
  points_earned_today: number;
  daily_points_cap: number;
  points_remaining_today: number;
  difficulty_caps?: Record<TwDifficulty, number>;
};

export type TwGuessResponse = TwGame & {
  points_awarded: number;
  cap_reached?: boolean;
  points_earned_today: number;
  daily_points_cap: number;
  points_remaining_today: number;
  difficulty_caps?: Record<TwDifficulty, number>;
};

export const fetchMenu = (difficulty: TwDifficulty = "중급", excludeST: boolean = false) =>
  request<{ menu: TwMenuGroup[]; total_questions: number; score_ladder: [number, number][] }>(
    `/menu/?difficulty=${encodeURIComponent(difficulty)}&exclude_st=${excludeST ? 1 : 0}`,
  );

export const fetchCurrentGame = () =>
  request<TwCurrent>("/current/");

export const startGame = (difficulty: TwDifficulty = "중급", excludeST: boolean = false) =>
  request<TwGame>("/start/", { method: "POST", body: JSON.stringify({ difficulty, exclude_st: excludeST }) });

export const askQuestion = (gameId: number, q_type: string, q_value: string | number) =>
  request<TwGame>("/ask/", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, q_type, q_value }),
  });

export const guessCard = (gameId: number, card_name: string) =>
  request<TwGuessResponse>("/guess/", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, card_name }),
  });

export const giveUp = (gameId: number) =>
  request<TwGame>("/give_up/", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId }),
  });

export type TwHintDim = { dim: string; label: string };
export const fetchHintDims = () =>
  request<{ dims: TwHintDim[]; penalties: number[]; max_hints: number }>("/hint_dims/");

export const useHint = (gameId: number, dim: string) =>
  request<TwGame>("/hint/", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, dim }),
  });
