/** 카드 도감: public card list, filter options and card documents (Master Duel cards). */
const API_BASE = "/api/carddb/cards";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(res.status === 404 ? "카드를 찾을 수 없습니다." : `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export type CardFilters = {
  q: string;
  category: string;
  frame: string;
  attribute: string;
  race: string;
  level: string;
  st: string;
  group: string;
  sort: string;
};

export const EMPTY_FILTERS: CardFilters = {
  q: "", category: "", frame: "", attribute: "", race: "", level: "", st: "", group: "", sort: "new",
};

export type CardListItem = { id: number; name: string; thumb_url: string | null; image_url: string | null };
export type CardListResponse = { results: CardListItem[]; total: number; page: number; has_more: boolean };

export type Option = { value: string; label: string };
export type CardOptions = {
  categories: Option[];
  frames: Option[];
  attributes: Option[];
  races: Option[];
  levels: number[];
  spell_trap_kinds: Option[];
  groups: { id: number; name: string; count: number }[];
};

export type CardTexts = { materials: string; effect: string; pendulum_effect: string; flavor: string } | null;

export type CardDoc = {
  id: number;
  name: string;
  name_ko: string;
  name_ja: string;
  name_ja_ruby: string;
  name_en: string;
  category: "monster" | "spell" | "trap";
  frame: string;
  type_line: string;
  attribute: string;
  level_label: string;
  atk: string | null;
  def: string | null;
  link_markers: string[];
  pendulum_scale: number | null;
  texts: { ko: CardTexts; ja: CardTexts };
  image_url: string | null;
  thumb_url: string | null;
  /** Whole card with its frame — the English (YGOPRODeck) picture; no Korean one exists. */
  full_image_url: string | null;
  alt_arts: string[];
  rarity: string;
  dates: { ocg: string | null; kr: string | null; tcg: string | null };
  groups: { id: number; name: string; parent_id: number | null }[];
  decks: { id: number; name: string; cover: string | null }[];
};

export function filtersToSearch(f: CardFilters): string {
  const qs = new URLSearchParams();
  (Object.keys(f) as (keyof CardFilters)[]).forEach((k) => {
    if (f[k] && !(k === "sort" && f[k] === "new")) qs.set(k, f[k]);
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function searchToFilters(search: string): CardFilters {
  const qs = new URLSearchParams(search);
  const f = { ...EMPTY_FILTERS };
  (Object.keys(f) as (keyof CardFilters)[]).forEach((k) => {
    const v = qs.get(k);
    if (v) f[k] = v;
  });
  return f;
}

export const listCards = (f: CardFilters, page: number) => {
  const qs = new URLSearchParams(filtersToSearch(f));
  if (page > 1) qs.set("page", String(page));
  return getJson<CardListResponse>(`/?${qs.toString()}`);
};

let optionsPromise: Promise<CardOptions> | null = null;
export const getCardOptions = () => {
  optionsPromise ??= getJson<CardOptions>("/options/").catch((e) => {
    optionsPromise = null;
    throw e;
  });
  return optionsPromise;
};

export const getCard = (id: number | string) => getJson<CardDoc>(`/${id}/`);
