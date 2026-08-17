const API_BASE = "/api/solo";

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
    // Swap the DRF default "Authentication credentials were not provided"
    // for a friendlier Korean prompt — callers display this verbatim and
    // raw English/red is jarring for guests browsing the board.
    if (res.status === 401) throw new Error("로그인 후 이용해주세요.");
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error || body.detail || JSON.stringify(body);
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export type SoloCardOption = {
  card_id: number;
  name: string;
  image_url: string | null;
};

export type SoloStartDrawResponse = {
  offer_token: string;
  draw_seconds: number;
  cards: SoloCardOption[];
};

export type SoloDrawingSummary = {
  id: number;
  drawer_id: string;
  drawer_name: string;
  drawer_avatar_icon: any | null;
  drawer_border: any | null;
  created_at: string;
  expires_at: string;
  solver_count: number;
  recommend_count: number;
  is_hidden: boolean;
  aspect_ratio: number;
  first_solved_at: string | null;
  iam_drawer: boolean;
  iam_solved: boolean;
  iam_gave_up?: boolean;
  /** Server flag — true when the viewer is staff/superuser. Used by the
   *  client to surface admin-only "delete any drawing" buttons. */
  viewer_is_staff?: boolean;
  my_attempts_used: number;
  word: string | null;
  card_image_url: string | null;
  // Stroke buffer — present on board items (for mini-canvas previews) and
  // on the detail response. The drawing itself is public; only the answer
  // (word / card_image_url) is gated.
  strokes?: any[];
};

export type SoloBoardTab = "all" | "unsolved" | "nobody" | "mine";
export type SoloBoardOrder = "recent" | "solvers" | "recommends";

export type SoloBoardResponse = {
  tab: SoloBoardTab;
  order: SoloBoardOrder;
  page: number;
  page_size: number;
  total: number;
  items: SoloDrawingSummary[];
  hall_of_fame: SoloDrawingSummary[];
};

export type SoloSolver = {
  user_id: string;
  name: string;
  solved_at: string | null;
  avatar_icon: any | null;
  border: any | null;
};

export type SoloDrawingDetail = SoloDrawingSummary & {
  strokes: any[];
  draw_seconds: number;
  point_attempt_limit: number;
  iam_recommended: boolean;
  expired: boolean;
  solvers: SoloSolver[];
};

export type SoloGuessResponse = {
  correct: boolean;
  attempts_used: number;
  points_awarded: number;
  points_remaining_today: number;
  daily_points_cap: number;
  first_solver: boolean;
  cap_reached: boolean;
  solved_without_points: boolean;
  point_attempt_limit: number;
  word: string | null;
  card_image_url: string | null;
};

export type SoloMyStatus = {
  drawings_created_today: number;
  points_earned_today: number;
  daily_points_cap: number;
  points_remaining_today: number;
  draw_seconds: number;
  point_attempt_limit: number;
  lifespan_days: number;
  my_recent: {
    id: number;
    word: string;
    is_hidden: boolean;
    created_at: string;
    expires_at: string;
    solver_count: number;
    recommend_count: number;
  }[];
};

export const soloApi = {
  startDraw: () => request<SoloStartDrawResponse>("/start_draw/", { method: "POST" }),

  submitDraw: (payload: { offer_token: string; card_id: number; strokes: any[]; aspect_ratio: number }) =>
    request<{ id: number }>("/submit_draw/", {
      method: "POST", body: JSON.stringify(payload),
    }),

  board: (tab: SoloBoardTab, order: SoloBoardOrder, page = 1) =>
    request<SoloBoardResponse>(`/board/?tab=${tab}&order=${order}&page=${page}`),

  drawingDetail: (id: number) =>
    request<SoloDrawingDetail>(`/drawings/${id}/`),

  submitGuess: (id: number, guess: string) =>
    request<SoloGuessResponse>(`/drawings/${id}/guess/`, {
      method: "POST", body: JSON.stringify({ guess }),
    }),

  giveUp: (id: number) =>
    request<{ gave_up: boolean; word: string; card_image_url: string | null }>(
      `/drawings/${id}/give_up/`, { method: "POST" }
    ),

  toggleRecommend: (id: number) =>
    request<{ recommended: boolean; recommend_count: number }>(`/drawings/${id}/recommend/`, {
      method: "POST",
    }),

  hideDrawing: (id: number) =>
    request<{ is_hidden: boolean }>(`/drawings/${id}/hide/`, { method: "POST" }),

  reportDrawing: (id: number, reason: string) =>
    request<{ ok: boolean }>(`/drawings/${id}/report/`, {
      method: "POST", body: JSON.stringify({ reason }),
    }),

  myStatus: () => request<SoloMyStatus>("/my_status/"),
};
