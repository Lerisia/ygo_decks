// A stat of 11 is the "?" value — shown as a question mark on the radar charts (특이점 2026-09-27).
export const UNKNOWN_STAT = 11;

/** Label text for a stat: "?" for 11, "-" when unset. */
export const statText = (raw: number | null | undefined) =>
  raw == null ? "-" : raw === UNKNOWN_STAT ? "?" : String(raw);

/** Where the point sits on the 0-10 chart: "?" is drawn at the outer edge. */
export const statPlot = (raw: number | null | undefined) => (raw == null ? 0 : Math.min(raw, 10));
