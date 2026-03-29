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
