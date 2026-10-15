import { useEffect, useMemo, useState } from "react";
import { CHIP_FILTERS, getFilteredCounts, type CardFilters } from "@/api/cardDexApi";
import type { ComboItem } from "@/components/ComboBox";
import { makeMatcher, matchRank, nameKeys } from "@/utils/hangul";

/** The filter chips in use, as the server reads them ("" with none). */
export const chipQuery = (filters?: Partial<CardFilters>) =>
  new URLSearchParams(CHIP_FILTERS.flatMap((k) => (filters?.[k] ? [[k, filters[k] as string]] : []))).toString();

export type GroupSuggestion = { it: ComboItem; rank: number; order: number };

/** The 카드군 and cards with a support list answering the typing (name or 초성: the whole name, then its start, then
 *  anywhere), at most `limit`. Under filter chips only those with cards left count, each with how many (참혈 2026-10-14);
 *  none at all until the counts come. Shared by /dev/cards' search and the deck builder's. */
export function useGroupSuggestions(items: ComboItem[], typed: string, chips: string, limit: number): GroupSuggestion[] {
  const keyed = useMemo(() => items.map((it) => ({ it, k: nameKeys(it.name) })), [items]);
  const [counts, setCounts] = useState<{ chips: string; groups: Record<string, number>; cards: Record<string, number> } | null>(null);
  useEffect(() => {
    if (!chips) return;
    const ctrl = new AbortController();
    getFilteredCounts(chips, ctrl.signal).then((r) => setCounts({ chips, ...r })).catch(() => {});
    return () => ctrl.abort();
  }, [chips]);
  const narrowed = useMemo(() => {
    if (!chips) return keyed;
    if (counts?.chips !== chips) return [];
    return keyed.flatMap(({ it, k }) => {
      const support = it.tag === "카드";
      const n = (support ? counts.cards : counts.groups)[it.key.slice(1)] ?? 0;
      return n ? [{ it: { ...it, sub: `${support ? "서포트 " : ""}${n.toLocaleString()}장` }, k }] : [];
    });
  }, [keyed, chips, counts]);
  return useMemo(() => {
    if (!nameKeys(typed).jamo) return [];
    const match = makeMatcher(typed);
    const rank = matchRank(typed);
    return narrowed
      .filter(({ k }) => match(k))
      .map((x, i) => ({ it: x.it, rank: rank(x.k), order: i }))
      .sort((a, b) => a.rank - b.rank || a.order - b.order)
      .slice(0, limit);
  }, [narrowed, typed, limit]);
}
