import type { CupStage } from "@/lib/homeTiles";

export type HomeSeason = { season: number; cup_stage: CupStage };

/** The season now and the Duelist Cup stage if one runs (the home page's 메타 통계 tile, 참혈 2026-10-16). */
export const getHomeSeason = async (): Promise<HomeSeason> => {
  const response = await fetch("/api/home/season/");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
