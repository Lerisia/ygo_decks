import type { Rarity } from "@/utils/packDraw";

export type PackKind = "normal" | "secret" | "selection";
export type PackSummary = {
  id: number; kind: PackKind; name: string; name_en: string; released: string | null; image: string | null;
  master: boolean; counts: Record<Rarity, number>;
  arts: { new_art: number; overframe: number };   // cards that came in a new art / an 오버프레임 in it
  // a campaign's version of the pack, listed as a pack of its own (엘리스 10/13): its id, days and the cards in their art then
  version: number | null; period: [string, string] | null; featured: string[];
};
export type PackCard = { print: number; card: number; name: string; rarity: Rarity; thumb: string; face: string | null };
/** The pack as a campaign or an older lineup sold it (엘리스 10/13): its days, its cover then, the cards that came in
 *  their campaign art (each naming the usual print it stands in for), the cards it held that were removed since, how
 *  many of today's it did not hold yet, and its whole lineup. */
export type PackVersion = {
  id: number; start: string; end: string; image: string | null; image_hd: string | null; arts: (PackCard & { base: number })[];
  gone: PackCard[]; later: number; cards: PackCard[];
};
export type PackDetail = Omit<PackSummary, "counts" | "arts" | "version" | "period" | "featured"> & {
  image_hd: string | null; cards: PackCard[]; master_pack?: number | null; versions: PackVersion[];
  changed: string | null;   // the day today's lineup began, when the pack's cards changed
};

let list: Promise<PackSummary[]> | null = null;
const details = new Map<number, Promise<PackDetail>>();

/** The packs one can open, newest first (kept for the visit). */
export function getPacks(): Promise<PackSummary[]> {
  list ??= fetch("/api/carddb/packs/")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => d.packs)
    .catch((e) => {
      list = null;
      throw e;
    });
  return list;
}

/** A pack and its cards (kept for the visit: the master pack, which every secret pack draws from, is asked once). */
export function getPack(id: number): Promise<PackDetail> {
  if (!details.has(id)) {
    details.set(id, fetch(`/api/carddb/packs/${id}/`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e) => {
        details.delete(id);
        throw e;
      }));
  }
  return details.get(id)!;
}

export type PackHit = { id: number; cards: string[]; count: number };

/** Packs by their pickup cards (a secret pack's pickup cards, a selection pack's own; never the master pack), the best
 *  match first, each with how many of its cards match and the first three names. */
export async function searchPacks(q: string, signal?: AbortSignal): Promise<PackHit[]> {
  const r = await fetch(`/api/carddb/packs/search/?q=${encodeURIComponent(q)}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).packs;
}

export type PackTally = { gems: number; packs: number; ur: number; sr: number; owed: boolean };
export type PackMine = { signed_in: boolean; gems: number; tally: PackTally };
export type OpenedCard = PackCard & { finish: "basic" | "shine" | "royal" };

const auth = (): Record<string, string> => {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** The signed-in user's gems and their tally for a pack. */
export async function getPackMine(id: number): Promise<PackMine> {
  const r = await fetch(`/api/carddb/packs/${id}/mine/`, { headers: auth() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Buy one or ten packs with gems; the server draws them. */
export async function openPack(id: number, count: 1 | 10, version: number | null = null): Promise<{ packs: OpenedCard[][]; gems: number; tally: PackTally }> {
  const r = await fetch(`/api/carddb/packs/${id}/open/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...auth() }, body: JSON.stringify({ count, version }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || body.detail || `HTTP ${r.status}`), { gems: body.gems });
  return body;
}
