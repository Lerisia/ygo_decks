import type { CardFilters, CardOptions } from "@/api/cardDexApi";
import type { ComboItem } from "@/components/ComboBox";
import type { DexField, DexValues } from "@/utils/dexFilter";

/** The card book's filter chips (참혈 2026-10-12), shared by the card book and the deck builder's card search. */

// cards with another art, a monster cut-in, or both: chosen together they narrow to cards with both (엘리스 2026-10-11)
export const HAS = [
  { value: "alt", label: "다른 일러스트" },
  { value: "cutin", label: "소환 연출" },
  // an alternate print whose art covers the whole card (특이점 2026-10-12)
  { value: "overframe", label: "오버프레임" },
];
// the filter bar's chips (참혈 2026-10-12); a monster's items don't fit 마법·함정, nor 마법·함정 a monster
export const BAR_KEYS = ["category", "frame", "attribute", "race", "level", "st"] as const;
// today's Master Duel 금제, the same as the icon in each card's corner; several at once (엘리스 10/12)
export const BANS = [
  { value: "forbidden", label: "금지" },
  { value: "limited", label: "제한" },
  { value: "semi_limited", label: "준제한" },
  { value: "unlimited", label: "무제한" },
];
const MONSTER_KEYS = ["frame", "attribute", "race", "level"];
export const misfit = (key: string, v: DexValues) =>
  MONSTER_KEYS.includes(key) ? ["spell", "trap"].includes(v.category?.[0] ?? "") : key === "st" && v.category?.[0] === "monster";

export const barFields = (options: CardOptions | null): DexField[] => [
  { key: "category", label: "종류", primary: true, options: options?.categories ?? [] },
  { key: "frame", label: "몬스터", options: options?.frames ?? [] },
  { key: "attribute", label: "속성", options: options?.attributes ?? [] },
  { key: "race", label: "종족", options: options?.races ?? [] },
  {
    key: "level", label: "레벨·랭크·링크", format: (l) => `레벨·랭크·링크 ${l}`,
    options: (options?.levels ?? []).map((n) => ({ value: String(n), label: String(n) })),
  },
  { key: "st", label: "마법·함정", options: options?.spell_trap_kinds ?? [] },
  { key: "ban", label: "금제", multi: true, options: BANS },
];
export const BAR_EXTRA: DexField = { key: "has", label: "그 외", multi: true, options: HAS };

/** The chips' values from the filters, and the filters from the chips' values. */
export const barValues = (f: Pick<CardFilters, (typeof BAR_KEYS)[number] | "has" | "ban">): DexValues => ({
  ...Object.fromEntries(BAR_KEYS.map((k) => [k, f[k] ? [f[k]] : []])),
  has: f.has.split(",").filter(Boolean),
  ban: f.ban.split(",").filter(Boolean),
});
export const barFilters = (v: DexValues) => ({
  ...(Object.fromEntries(BAR_KEYS.map((k) => [k, v[k]?.[0] ?? ""])) as Record<(typeof BAR_KEYS)[number], string>),
  has: HAS.map((h) => h.value).filter((x) => v.has?.includes(x)).join(","),
  ban: BANS.map((b) => b.value).filter((x) => v.ban?.includes(x)).join(","),
});

/** 카드군, and the cards with a support list (엘리스 10/12: a card's 서포트 searched beside them), as picker items. */
export const groupItems = (options: CardOptions | null): ComboItem[] => [
  ...(options?.groups ?? []).map((g) => ({ key: `g${g.id}`, name: g.name, sub: `${g.count.toLocaleString()}장`, tag: "카드군" })),
  ...(options?.support_cards ?? []).map((c) => ({
    key: `c${c.id}`, name: c.name, sub: `서포트 ${c.count.toLocaleString()}장`, tag: "카드", searchOnly: true,
  })),
];
