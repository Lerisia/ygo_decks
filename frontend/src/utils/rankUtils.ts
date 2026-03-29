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

export const RANK_ORDER = [
  "rookie2", "rookie1",
  "bronze5", "bronze4", "bronze3", "bronze2", "bronze1",
  "silver5", "silver4", "silver3", "silver2", "silver1",
  "gold5", "gold4", "gold3", "gold2", "gold1",
  "platinum5", "platinum4", "platinum3", "platinum2", "platinum1",
  "diamond5", "diamond4", "diamond3", "diamond2", "diamond1",
  "master5", "master4", "master3", "master2", "master1",
];

function getUpperRank(rank: string): string {
  const i = RANK_ORDER.indexOf(rank);
  if (i < 0 || i === RANK_ORDER.length - 1) return rank;
  return RANK_ORDER[i + 1];
}

function getLowerRank(rank: string): string {
  const i = RANK_ORDER.indexOf(rank);
  if (i <= 0) return rank;
  return RANK_ORDER[i - 1];
}

function getTier(rank: string): string {
  return rank.replace(/[0-9]/g, "");
}

type RankState = { rank: string; wins: number | null };

export function getNextRankState(
  rank: string,
  currentWins: number | null,
  result: "win" | "lose"
): RankState {
  const tier = getTier(rank);
  const w = currentWins ?? 0;

  // 마스터 1: 영구 고정
  if (rank === "master1") return { rank, wins: null };

  // 루키/브론즈: 승리 시 무조건 승급, 패배 시 변화 없음
  if (tier === "rookie" || tier === "bronze") {
    if (result === "win") return { rank: getUpperRank(rank), wins: 0 };
    return { rank, wins: 0 };
  }

  // 실버: 승급에 2승 필요, 패배해도 승수 안 떨어짐, 강등 없음
  if (tier === "silver") {
    if (result === "win") {
      if (w + 1 >= 2) return { rank: getUpperRank(rank), wins: 0 };
      return { rank, wins: w + 1 };
    }
    return { rank, wins: w };
  }

  // 골드: 승급에 4승 필요, 패배해도 승수 안 떨어짐, 강등 없음
  if (tier === "gold") {
    if (result === "win") {
      if (w + 1 >= 4) return { rank: getUpperRank(rank), wins: 0 };
      return { rank, wins: w + 1 };
    }
    return { rank, wins: w };
  }

  // 플래티넘: 승급에 4승 필요, 패배 시 승수 감소, 5티어 강등 없음
  // 마이너스 승수 가능 (최소 -3), -3에서 패배 시 강등
  if (tier === "platinum") {
    const isTier5 = rank === "platinum5";
    if (result === "win") {
      const next = w < 0 ? 1 : w + 1;
      if (next >= 4) return { rank: getUpperRank(rank), wins: 0 };
      return { rank, wins: next };
    }
    if (isTier5) return { rank, wins: Math.max(0, w - 1) };
    if (w <= -3) return { rank: getLowerRank(rank), wins: 0 };
    return { rank, wins: w - 1 };
  }

  // 다이아: 승급에 4승 필요, 패배 시 승수 감소, 5티어 강등 없음
  // 마이너스 승수 가능 (최소 -2), -2에서 패배 시 강등
  if (tier === "diamond") {
    const isTier5 = rank === "diamond5";
    if (result === "win") {
      const next = w < 0 ? 1 : w + 1;
      if (next >= 4) return { rank: getUpperRank(rank), wins: 0 };
      return { rank, wins: next };
    }
    if (isTier5) return { rank, wins: Math.max(0, w - 1) };
    if (w <= -2) return { rank: getLowerRank(rank), wins: 0 };
    return { rank, wins: w - 1 };
  }

  // 마스터: 승급에 5승 필요, 5티어/1티어 강등 없음
  // 마이너스 승수 가능 (최소 -2), -2에서 패배 시 강등
  if (tier === "master") {
    const isTier5 = rank === "master5";
    if (result === "win") {
      const next = w < 0 ? 1 : w + 1;
      if (next >= 5) return { rank: getUpperRank(rank), wins: 0 };
      return { rank, wins: next };
    }
    if (isTier5) return { rank, wins: Math.max(0, w - 1) };
    if (w <= -2) return { rank: getLowerRank(rank), wins: 0 };
    return { rank, wins: w - 1 };
  }

  return { rank, wins: w };
}

export function getRankLabel(rank: string): string {
  return RANK_OPTIONS.find((r) => r.value === rank)?.label || rank;
}

export function getValidWinOptions(rank: string): number[] {
  if (!rank) return [];
  const tier = getTier(rank);
  if (tier === "rookie" || tier === "bronze") return [0];
  if (tier === "silver") return [0, 1];
  if (tier === "gold") return [0, 1, 2, 3];
  if (tier === "platinum") {
    return rank === "platinum5" ? [0, 1, 2, 3] : [-3, -2, -1, 0, 1, 2, 3];
  }
  if (tier === "diamond") {
    return rank === "diamond5" ? [0, 1, 2, 3] : [-2, -1, 0, 1, 2, 3];
  }
  if (tier === "master") {
    if (rank === "master1") return [];
    if (rank === "master5") return [0, 1, 2, 3, 4];
    return [-2, -1, 0, 1, 2, 3, 4];
  }
  return [];
}
