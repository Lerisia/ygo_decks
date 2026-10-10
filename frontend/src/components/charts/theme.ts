// Win rates read at a glance: clearly good in blue, clearly bad in red, the middle stays plain.
export const rateTone = (v: number | null | undefined) =>
  v == null ? "text-gray-400" : v > 55 ? "text-blue-600 dark:text-blue-400 font-semibold" : v < 45 ? "text-red-500 dark:text-red-400 font-semibold" : "";

export const CHART_BLUE = "#2563eb";
export const RADAR_BLUE = "#3b82f6";
export const EMPTY_GRAY = "#9ca3af";
export const GRID_STROKE = "#e5e7eb";
export const TOOLTIP_STYLE = { fontSize: "0.8rem" };

export const MEDALS = ["#d4a72c", "#b4b9c0", "#c07a46"];
