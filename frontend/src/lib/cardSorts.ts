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

const SORT_KEY = "card_list_sort";
type Sorted = { sort: string; dir: string };

/** The viewer's last sort and its way, kept in this browser (엘리스 10/12) — one memory for the card book and the deck
 *  builder's search (엘리스 2026-10-18); none, or one not among `sorts`, is null. */
export function rememberedSort(sorts: { value: string }[]): Sorted | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) || "null");
    if (sorts.some((s) => s.value === saved?.sort) && ["", "asc", "desc"].includes(saved.dir)) return { sort: saved.sort, dir: saved.dir };
  } catch {
    /* no storage: the default sort */
  }
  return null;
}

export function rememberSort(f: Sorted) {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify({ sort: f.sort, dir: f.dir }));
  } catch {
    /* private mode: the choice lasts while the page is open */
  }
}
