/** /dev/cardlayout's operator API: the letter layout the card faces are drawn with (carddb/face_layout.json), a print's
 *  letters, its face without letters, and the free fonts and kind icons of the face assets (참혈 2026-10-14). */
import type { FaceLayout } from "@/lib/cardLayout";

const API_BASE = "/api/carddb/face-layout";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get(path: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), signal });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("관리자 권한이 필요합니다.");
    throw new Error(res.status === 404 ? "그런 카드가 없습니다." : `HTTP ${res.status}`);
  }
  return res;
}

export type ServerFontInfo = {
  file: string;
  family: string;
  style: string;
  weight: number;
  /** hhea, in font units: FreeType (PIL) puts a line's top and middle from these, rounded out to whole pixels. */
  upm: number;
  ascender: number;
  descender: number;
  bytes: number;
  /** A variable font's named weights ({"Medium": 500}), empty for a static one. */
  instances: Record<string, number>;
  weight_range?: [number, number];
};

export type LayoutResponse = {
  layout: FaceLayout;
  size: [number, number];
  /** Letters a wrapped line never starts with (face.NO_LINE_START). */
  no_line_start: string;
  fonts: ServerFontInfo[];
  samples: { label: string; id: number; name: string }[];
};

export type CardLetters = {
  id: number;
  card_id: number;
  name: string;
  category: "monster" | "spell" | "trap";
  frame: string;
  overframe: boolean;
  pendulum: boolean;
  link: boolean;
  type_line: string | null;
  /** From the right: [label, number], the number null for LINK-n. */
  stats: [string, string | null][] | null;
  spell_trap: { label: string; icon: string | null } | null;
  pendulum_scale: string | null;
  effect: string;
  pendulum_effect: string;
  /** A normal monster's text is set in the serif (effect.normal_font). */
  normal_monster: boolean;
  needs_fallback: boolean;
  face_url: string | null;
  prints: { id: number; alt: boolean; overframe: boolean }[];
};

export const getFaceLayout = async () => (await get("/")).json() as Promise<LayoutResponse>;
export const getCardLetters = async (id: number, signal?: AbortSignal) =>
  (await get(`/${id}/`, signal)).json() as Promise<CardLetters>;
export const getBareFace = async (id: number, signal?: AbortSignal) => (await get(`/${id}/bare/`, signal)).blob();
export const getFaceAsset = async (name: string) => (await get(`/assets/${encodeURIComponent(name)}`)).arrayBuffer();
