// The home page's 「더 둘러보기」 tiles. NOW is what the live home shows; NEXT is the set tuned on /dev/home (참혈
// 2026-10-16): the 팩깡 시뮬레이터 moves here from its pillar, AI 덱 스캔 goes (it is folding into the 도감 and 덱 리스트),
// 3 × 2 on every screen. Going live is Info's default layout switching to "next".

export type HomeTile = { to?: string; title: string; desc: string; soon?: boolean };

export const HOME_TILES_NOW: HomeTile[] = [
  { to: "/records", title: "전적 시트", desc: "메타 통계·내 전적" },
  { to: "/playground", title: "놀이터", desc: "퀴즈·미니게임" },
  { to: "/tier-list-maker", title: "티어표 만들기", desc: "만들고 이미지로" },
  { to: "/deck-scanner", title: "AI 덱 스캔", desc: "사진으로 덱 알아보기" },
  { to: "/icon-shop", title: "포인트 상점", desc: "포인트로 아이콘·프레임 사기" },
  { title: "대회", desc: "준비 중", soon: true },
];

export type NextTileKind = "meta" | "packs" | "soon" | "plain";
export type NextTile = HomeTile & { kind: NextTileKind; chip?: string };

// No-break spaces keep 「개최 • 참가」 together, so a narrow tile breaks after 간편하게.
export const HOME_TILES_NEXT: NextTile[] = [
  { kind: "meta", to: "/records", title: "메타 통계", desc: "덱 사용률·승률" },
  { kind: "packs", to: "/packs", title: "팩깡 시뮬레이터", desc: "마스터 듀얼의 모든 팩 뽑기", chip: "베타" },
  { kind: "soon", title: "대회", desc: "간편하게 개최\u00a0•\u00a0참가", chip: "개발 중", soon: true },
  { kind: "plain", to: "/playground", title: "놀이터", desc: "미니게임을 즐기고 포인트 획득" },
  { kind: "plain", to: "/tier-list-maker", title: "티어표 만들기", desc: "만들고 이미지로" },
  { kind: "plain", to: "/icon-shop", title: "포인트 상점", desc: "각종 꾸미기 아이템 구매" },
];

export type CupStage = 1 | 2 | null;
export type MetaChip = { tone: "season" | "cup"; label: string; tail: string };

/** The 메타 통계 tile's chip: the season, or the Duelist Cup stage while one runs. `tail` is the part narrow tiles drop. */
export function metaChip(season: number, cupStage: CupStage): MetaChip {
  if (cupStage) return { tone: "cup", label: `DC • ${cupStage === 1 ? "1st" : "2nd"}`, tail: " Stage" };
  return { tone: "season", label: `Season ${season}`, tail: "" };
}
