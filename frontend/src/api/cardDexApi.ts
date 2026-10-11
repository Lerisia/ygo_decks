/** 카드 도감: public card list, filter options and card documents (Master Duel cards). */
const API_BASE = "/api/carddb/cards";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { signal });
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
  /** With a group: "" its members, "support" the cards supporting it. */
  role: string;
  /** A card's own support list: the card, cards bearing its name and cards naming it. */
  card: string;
  sort: string;
};

export const EMPTY_FILTERS: CardFilters = {
  q: "", category: "", frame: "", attribute: "", race: "", level: "", st: "", group: "", role: "", card: "", sort: "new",
};

export type CardListItem = {
  id: number;
  name: string;
  face_thumb_url: string | null;
  thumb_url: string | null;
  image_url: string | null;
};
export type CardListResponse = {
  results: CardListItem[];
  total: number;
  page: number;
  has_more: boolean;
  /** With a group filter: how many of its members and of the cards supporting it match. */
  group_counts?: { member: number; support: number };
  /** With a card filter: the card whose support list this is. */
  card_filter?: { id: number; name: string } | null;
};

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
  /** What Master Duel's Shine / Royal shaders draw themselves: the attribute icon's tile, the stars and the frame
   *  (a print in 오버프레임 is marked on its face). */
  finish: { attribute: number; level: number; frame: "normal" | "link" | "pendulum" };
  texts: { ko: CardTexts; ja: CardTexts };
  image_url: string | null;
  thumb_url: string | null;
  /** The whole card in Korean, drawn from Master Duel's frame (null until drawn). */
  face_url: string | null;
  /** The card's faces: its own print first, then Master Duel's alternate arts. */
  faces: {
    id: number; face: string; thumb: string | null; overframe: boolean; rarity: string;
    /** The card name alone (white on black over the card's top sixth), for the finishes to paint. */
    name_mask: string | null;
    /** Master Duel's monster cut-in for this print: the animation and the game's camera view. */
    cutin: { anim: string; view: [number, number, number] | null } | null;
  }[];
  /** The attribute whose sound goes with a cut-in. */
  cutin_sound: string;
  rarity: string;
  /** md: the day the card came to Master Duel. */
  dates: { md: string | null; ocg: string | null; kr: string | null; tcg: string | null };
  groups: { id: number; name: string; parent_id: number | null }[];
  /** 서포트: the 카드군 and cards its text names outright without being one of them. */
  /** mutual: the card names this one back (의식 몬스터 ↔ 의식 마법): they support each other. */
  supports: { kind: "group" | "card"; id: number; name: string; mutual: boolean }[];
  /** How many cards its own support list holds (itself included); 0 when no other card names it. */
  supporters: number;
  /** Decks of its own groups ("member") first, then of the groups it supports. */
  decks: { id: number; name: string; cover: string | null; via: "member" | "support" }[];
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

export const listCards = (f: CardFilters, page: number, signal?: AbortSignal) => {
  const qs = new URLSearchParams(filtersToSearch(f));
  if (page > 1) qs.set("page", String(page));
  return getJson<CardListResponse>(`/?${qs.toString()}`, signal);
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
