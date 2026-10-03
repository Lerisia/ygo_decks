export type DeckStats = {
  consistency: number | null;
  breakthrough: number | null;
  interruption: number | null;
  recovery: number | null;
  deck_space: number | null;
};

export type DeckData = {
  id: number;
  name: string;
  cover_image?: string;
  cover_image_small?: string;
  strength: string;
  difficulty: string;
  deck_type: string;
  art_style: string;
  summoning_methods: string[];
  performance_tags: string[];
  aesthetic_tags: string[];
  description: string;
  stats?: DeckStats;
};

export const fetchDeckResult = async (answerKey: string) => {
  try {
    const token = localStorage.getItem("access_token");
    const headers: HeadersInit = token
      ? { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      : { "Content-Type": "application/json" }; // If not logged in

    const response = await fetch(`/api/deck/result?key=${encodeURIComponent(answerKey)}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error("Failed to fetch result");
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching deck result:", error);
    return null;
  }
};

export const getAllDecks = async () => {
  const response = await fetch("/api/deck/");
  return response.json();
};

export const getDeckData = async (deckId: number) => {
  const response = await fetch(`/api/deck/${deckId}/`);
  return response.json();
};

export type FeaturedVideo = {
  video_id: string;
  title: string;
  url: string;
  channel: string;
  channel_url: string;
  lang: "en" | "ja" | "ko" | "other";
  lang_label: string;
  thumbnail_url: string;
  view_count: number | null;
  published_at: string | null;
  duration: number | null;
  note: string;
};

export type DeckVideosResponse = {
  deck_id: number;
  featured: FeaturedVideo | null;
};

export const getDeckVideos = async (deckId: number): Promise<DeckVideosResponse> => {
  const response = await fetch(`/api/deck/${deckId}/videos/`);
  if (!response.ok) throw new Error("Failed to fetch deck videos");
  return response.json();
};


export type DeckNote = {
  id: number;
  title: string;
  author: string;
  url: string;
  source: string;
  source_label: string;
  game: "md" | "ocg" | "both";
  game_label: string;
  is_paid: boolean;
  price: string;
  published_at: string | null;
  summary: string;
  series: string;
  part: number | null;
  part_label: string;
};

export type DeckHyeol = {
  deck_id: number;
  overview: { t: string; short: string; name: string; image: string | null; level: string; label: string }[];
  updated_at: string;
  source_url: string;
};

export const getDeckHyeol = async (deckId: number): Promise<DeckHyeol> => {
  const response = await fetch(`/api/deck/${deckId}/hyeol/`);
  if (!response.ok) throw new Error("Failed to fetch deck hyeol");
  return response.json();
};

export const getDeckNotes = async (deckId: number): Promise<{ deck_id: number; notes: DeckNote[] }> => {
  const response = await fetch(`/api/deck/${deckId}/notes/`);
  if (!response.ok) throw new Error("Failed to fetch deck notes");
  return response.json();
};

// 운영자 전용 덱 정보·스탯 수정 (특이점 2026-10-03), 새 덱 추가·이름·별칭·대표 이미지도 같은 창에서
export type DeckEditOption = { value: number; label: string };
export type DeckEditValues = {
  name: string;
  aliases: string[];
  description: string;
  // null only while a new deck's choice hasn't been picked yet
  strength: number | null;
  difficulty: number | null;
  deck_type: number | null;
  art_style: number | null;
  is_engine: boolean;
  is_upcoming: boolean;
  summoning_methods: number[];
  performance_tags: string[];
  aesthetic_tags: string[];
  stats: DeckStats;
};
export type DeckEditInfo = {
  values: DeckEditValues;
  options: {
    strength: DeckEditOption[];
    difficulty: DeckEditOption[];
    deck_type: DeckEditOption[];
    art_style: DeckEditOption[];
    summoning_methods: DeckEditOption[];
    performance_tags: string[];
    aesthetic_tags: string[];
  };
};
export type SavedDeck = { id: number } & Record<string, unknown>;

const staffRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = localStorage.getItem("access_token");
  const isForm = init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.detail || `HTTP ${res.status}`);
  return body as T;
};

export const getDeckEditInfo = (deckId: number) => staffRequest<DeckEditInfo>(`/api/deck/${deckId}/edit/`);

export const saveDeckEditInfo = (deckId: number, values: DeckEditValues) =>
  staffRequest<{ deck: SavedDeck; changed: string }>(`/api/deck/${deckId}/edit/`, {
    method: "PUT",
    body: JSON.stringify(values),
  });

export const getNewDeckInfo = () => staffRequest<DeckEditInfo>("/api/deck/create/");

export const createDeck = (values: DeckEditValues, cover: File | null) => {
  const form = new FormData();
  form.append("data", JSON.stringify(values));
  if (cover) form.append("cover_image", cover);
  return staffRequest<{ deck: SavedDeck }>("/api/deck/create/", { method: "POST", body: form });
};

export const replaceDeckCover = (deckId: number, cover: File) => {
  const form = new FormData();
  form.append("cover_image", cover);
  return staffRequest<{ deck: SavedDeck }>(`/api/deck/${deckId}/cover/`, { method: "POST", body: form });
};
