// Win rates read at a glance: clearly good in blue, clearly bad in red, the middle stays plain.
export const rateTone = (v: number | null | undefined) =>
  v == null ? "text-gray-400" : v > 55 ? "text-blue-600 dark:text-blue-400 font-semibold" : v < 45 ? "text-red-500 dark:text-red-400 font-semibold" : "";

// Win rate colour: blue from 55%, red from 45%, plain text only at exactly 50%, and a gradual blend in between
// (특이점 2026-10-10). The blend mixes into the surrounding text colour so it works in both themes.
export const winRateTint = (rate: number): { cls: string; mix?: string } => {
  if (rate >= 55) return { cls: "text-blue-600" };
  if (rate <= 45) return { cls: "text-red-500" };
  if (rate > 50) return { cls: "", mix: `color-mix(in srgb, #2563eb ${(((rate - 50) / 5) * 100).toFixed(1)}%, currentColor)` };
  if (rate < 50) return { cls: "", mix: `color-mix(in srgb, #ef4444 ${(((50 - rate) / 5) * 100).toFixed(1)}%, currentColor)` };
  return { cls: "" };
};

export const CHART_BLUE = "#2563eb";
export const RADAR_BLUE = "#3b82f6";
export const EMPTY_GRAY = "#9ca3af";
export const GRID_STROKE = "#e5e7eb";
export const TOOLTIP_STYLE = { fontSize: "0.8rem" };

export const MEDALS = ["#d4a72c", "#b4b9c0", "#c07a46"];
