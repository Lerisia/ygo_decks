/** The card book's sorts: Master Duel's, each either way (엘리스 10/12), under its names; 디폴트 순: each monster frame
 *  before its pendulum, low levels first, then spells and traps. Kept here so the analytics page can name them too. */
export const CARD_SORTS = [
  { value: "new", label: "최신 카드순" },
  { value: "type", label: "디폴트 순" },
  { value: "name", label: "이름순" },
  { value: "rarity", label: "레어리티" },
  { value: "level", label: "레벨 / 랭크 / 링크" },
  { value: "atk", label: "공격력" },
  { value: "def", label: "수비력" },
];

/** /dev/cards tries 조회순 — the most viewed cards first, then the newest, then by name; with a query it reads
 *  정확도순, the closest names first — and calls 디폴트 순 유형순 (참혈 2026-10-14). */
export const DEV_CARD_SORTS = [
  { value: "popular", label: "조회순" },
  ...CARD_SORTS.map((s) => (s.value === "type" ? { ...s, label: "유형순" } : s)),
];
