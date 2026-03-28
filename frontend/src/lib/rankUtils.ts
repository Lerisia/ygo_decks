export const RANK_OPTIONS = [
  { value: "rookie2", label: "루키 2" },
  { value: "rookie1", label: "루키 1" },
  { value: "bronze5", label: "브론즈 5" },
  { value: "bronze4", label: "브론즈 4" },
  { value: "bronze3", label: "브론즈 3" },
  { value: "bronze2", label: "브론즈 2" },
  { value: "bronze1", label: "브론즈 1" },
  { value: "silver5", label: "실버 5" },
  { value: "silver4", label: "실버 4" },
  { value: "silver3", label: "실버 3" },
  { value: "silver2", label: "실버 2" },
  { value: "silver1", label: "실버 1" },
  { value: "gold5", label: "골드 5" },
  { value: "gold4", label: "골드 4" },
  { value: "gold3", label: "골드 3" },
  { value: "gold2", label: "골드 2" },
  { value: "gold1", label: "골드 1" },
  { value: "platinum5", label: "플래티넘 5" },
  { value: "platinum4", label: "플래티넘 4" },
  { value: "platinum3", label: "플래티넘 3" },
  { value: "platinum2", label: "플래티넘 2" },
  { value: "platinum1", label: "플래티넘 1" },
  { value: "diamond5", label: "다이아 5" },
  { value: "diamond4", label: "다이아 4" },
  { value: "diamond3", label: "다이아 3" },
  { value: "diamond2", label: "다이아 2" },
  { value: "diamond1", label: "다이아 1" },
  { value: "master5", label: "마스터 5" },
  { value: "master4", label: "마스터 4" },
  { value: "master3", label: "마스터 3" },
  { value: "master2", label: "마스터 2" },
  { value: "master1", label: "마스터 1" },
];

export function getValidWinOptions(rank: string): number[] {
  if (!rank) return [];
  if (rank.startsWith("rookie") || rank.startsWith("bronze")) return [0];
  if (rank.startsWith("silver")) return [0, 1];
  if (rank.startsWith("gold") || rank === "platinum5" || rank === "diamond5") return [0, 1, 2, 3];
  if (rank.startsWith("platinum") && rank !== "platinum5") return [-3, -2, -1, 0, 1, 2, 3];
  if (rank.startsWith("diamond") && rank !== "diamond5") return [-2, -1, 0, 1, 2, 3];
  if (rank === "master5") return [0, 1, 2, 3, 4];
  if (["master4", "master3", "master2"].includes(rank)) return [-2, -1, 0, 1, 2, 3, 4];
  return [];
}

function getUpperRank(rank: string): string {
  const idx = RANK_OPTIONS.findIndex((r) => r.value === rank);
  if (idx < 0 || idx === RANK_OPTIONS.length - 1) return rank;
  return RANK_OPTIONS[idx + 1].value;
}

function getLowerRank(rank: string): string {
  const idx = RANK_OPTIONS.findIndex((r) => r.value === rank);
  if (idx <= 0) return rank;
  return RANK_OPTIONS[idx - 1].value;
}

export function getNextRankAndWins(
  rank: string,
  currentWins: number | null,
  result: "win" | "lose"
): { nextRank: string; nextWins: number | null } {
  if (rank === "master1") return { nextRank: rank, nextWins: null };

  if (rank === "rookie2" || rank === "rookie1") {
    return { nextRank: getUpperRank(rank), nextWins: 0 };
  }

  const options = getValidWinOptions(rank);
  const max = Math.max(...options);
  const min = Math.min(...options);

  if (currentWins === null) return { nextRank: rank, nextWins: null };

  let newWins = result === "win" ? currentWins + 1 : currentWins - 1;

  if (currentWins < 0 && result === "win") {
    newWins = 1;
  }

  if (
    result === "lose" &&
    ((currentWins === -2 && !options.includes(-3)) || currentWins === -3)
  ) {
    return { nextRank: getLowerRank(rank), nextWins: 0 };
  }

  if (newWins > max) {
    return { nextRank: getUpperRank(rank), nextWins: 0 };
  }

  if (newWins < min) {
    newWins = min;
  }

  return { nextRank: rank, nextWins: newWins };
}

export function getRankLabel(rank: string): string {
  return RANK_OPTIONS.find((r) => r.value === rank)?.label || rank;
}
