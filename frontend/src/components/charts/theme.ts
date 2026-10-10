// Win rates read at a glance: clearly good in blue, clearly bad in red, the middle stays plain.
export const rateTone = (v: number | null | undefined) =>
  v == null ? "text-gray-400" : v > 55 ? "text-blue-600 dark:text-blue-400 font-semibold" : v < 45 ? "text-red-500 dark:text-red-400 font-semibold" : "";

export const CHART_BLUE = "#2563eb";
export const RADAR_BLUE = "#3b82f6";
export const EMPTY_GRAY = "#9ca3af";
export const GRID_STROKE = "#e5e7eb";
export const TOOLTIP_STYLE = { fontSize: "0.8rem" };

// Slices are plain colours (gold/silver/bronze, then rainbow for 4–10, near-black for the rest) and each deck's
// picture sits in a small circle on the pie's edge, so ranks read at a glance (특이점 2026-10-10).
// Flat, fully opaque colours with no sheen (특이점 2026-10-10).
export const PODIUM = [{ solid: "#d4a72c" }, { solid: "#b4b9c0" }, { solid: "#c07a46" }];
// Slices given an exact colour by the team (index 3 = 4위, 특이점 2026-10-10); rings and rank squares keep the rainbow.
export const SLICE_FILL: Record<number, string> = { 3: "#ff6d6d" };
export const RAINBOW = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#4f46e5", "#9333ea"];
export const OTHERS_COLOR = "#3a3a3d";

export const sliceColor = (rank: number) => (rank < 3 ? PODIUM[rank].solid : RAINBOW[rank - 3] ?? OTHERS_COLOR);
