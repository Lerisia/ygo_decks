// Master Duel's ranked seasons run a calendar month each: October 2026 is 시즌 58, November 59, … (특이점 2026-10-12).
const BASE = { year: 2026, month: 10, season: 58 };

/** The season a moment falls in, by its month in Korea. */
export function mdSeason(at: Date): number {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric" })
    .formatToParts(at)
    .filter((p) => p.type === "year" || p.type === "month")
    .map((p) => Number(p.value));
  return BASE.season + (year - BASE.year) * 12 + (month - BASE.month);
}
