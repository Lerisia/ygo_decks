export type RecorderStats = { users: number; games: number; version: string };

/** How many people have recorded how many games with the PC recorder (home page). */
export const getRecorderStats = async (): Promise<RecorderStats> => {
  const response = await fetch("/api/tracker/public-stats/");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
