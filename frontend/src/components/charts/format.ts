export const rate = (wins: number, games: number) => (games > 0 ? (wins / games) * 100 : null);
export const pctText = (v: number | null | undefined, digits = 0) => (v == null ? "–" : `${v.toFixed(digits)}%`);
