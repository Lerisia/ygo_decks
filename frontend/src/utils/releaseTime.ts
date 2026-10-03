// Update 마크 자동 해제 시각 (특이점 2026-10-03): 시각은 오후 6시로 고정, 연도는 올해. 사이트 기준 시간대는 한국.
export const RELEASE_HOUR = 18;
const KST = "Asia/Seoul";

const pad = (n: number) => String(n).padStart(2, "0");

export const releaseIso = (year: number, month: number, day: number) =>
  `${year}-${pad(month)}-${pad(day)}T${pad(RELEASE_HOUR)}:00:00+09:00`;

/** Year / month / day of a release time as seen in Korea, or null when unset. */
export const releaseParts = (iso: string | null) => {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KST, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date(iso))
    .reduce<Record<string, number>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  return { year: parts.year, month: parts.month, day: parts.day };
};

export const currentYearKst = (now = new Date()) =>
  Number(new Intl.DateTimeFormat("en-CA", { timeZone: KST, year: "numeric" }).format(now));

export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
