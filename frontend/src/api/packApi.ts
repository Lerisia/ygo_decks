import type { Rarity } from "@/utils/packDraw";

export type PackKind = "normal" | "secret" | "selection";
export type PackSummary = {
  id: number; kind: PackKind; name: string; name_en: string; released: string | null; image: string | null;
  master: boolean; counts: Record<Rarity, number>;
};
export type PackCard = { print: number; card: number; name: string; rarity: Rarity; thumb: string; face: string | null };
export type PackDetail = Omit<PackSummary, "counts"> & { image_hd: string | null; cards: PackCard[]; master_pack?: number | null };

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
