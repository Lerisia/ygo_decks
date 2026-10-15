/** The order of /dev/cards' search suggestions, cards and 카드군·서포트 in one list. */
export type RankedSuggestion = { rank: number; kind: "card" | "group" | "support"; order: number };

const KIND_ORDER = { card: 0, group: 1, support: 2 } as const;

/** The closest answers first whatever they are — whole name, then its start, then anywhere — a card before a 카드군
 *  before a 서포트 as close (참혈 2026-10-14); then the single closest 카드군 or 서포트 goes to the top, under only the
 *  cards whose name was typed exactly (참혈 2026-10-15). At most `limit`. */
export function orderSuggestions<T extends RankedSuggestion>(items: T[], limit: number): T[] {
  const sorted = [...items].sort((a, b) => a.rank - b.rank || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.order - b.order);
  const best = sorted.find((s) => s.kind !== "card");
  if (!best) return sorted.slice(0, limit);
  const exact = sorted.filter((s) => s.kind === "card" && s.rank === 0);
  return [...exact, best, ...sorted.filter((s) => s !== best && !exact.includes(s))].slice(0, limit);
}
