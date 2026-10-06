// One menu for the whole site: the PC dropdowns, the phone's bottom tabs and the 전체 page all read it,
// so a feature is added in one place. (Redesign 2026-10: 도감 · 도구 · 전적 · 놀이터 · 전체)

export const CONTACT_URL = "https://open.kakao.com/o/sDIT5F2c";
export const DONATE_URL = "https://www.buymeacoffee.com/elyss";
export const RECORDER_DOWNLOAD_URL = "/media/recorder/YGODecksRecorder.exe";

export type MenuItem = {
  label: string;
  to: string;
  desc?: string;
  external?: boolean;
  auth?: boolean;   // sends guests to /login
  soon?: boolean;   // listed, not yet open
};

export type MenuGroup = {
  key: "dex" | "tools" | "records" | "play";
  label: string;
  icon: string;
  to: string;            // where the tab / the group's own label goes
  paths: string[];       // path prefixes that count as being inside this group
  items: MenuItem[];
};

export const MENU_GROUPS: MenuGroup[] = [
  {
    key: "dex",
    label: "도감",
    icon: "📚",
    to: "/database",
    paths: ["/database", "/recommend", "/question", "/questions", "/result", "/no-results"],
    items: [
      { label: "덱 목록", to: "/database", desc: "덱별 티어·운영법·전적" },
      { label: "덱 성향 테스트", to: "/recommend", desc: "질문에 답하면 맞는 덱을 추천" },
    ],
  },
  {
    key: "tools",
    label: "도구",
    icon: "🧰",
    to: "/tools",
    paths: ["/tools", "/deck-scanner", "/card-detector", "/tier-list-maker"],
    items: [
      { label: "AI 덱 스캔", to: "/deck-scanner", desc: "사진으로 덱 알아보기" },
      { label: "티어표 만들기", to: "/tier-list-maker", desc: "만들고 이미지로 저장" },
    ],
  },
  {
    key: "records",
    label: "전적",
    icon: "📝",
    to: "/records",
    paths: ["/records", "/record-groups", "/recorder", "/tracker", "/mypage/mydecks"],
    items: [
      { label: "전적 시트", to: "/records", desc: "메타 통계와 내 전적" },
      { label: "레코더", to: "/recorder", desc: "PC에서 전적 자동 기록" },
      { label: "내 전적 통계", to: "/record-groups/statistics", desc: "내 시트를 모아 본 통계", auth: true },
      { label: "보유 덱", to: "/mypage/mydecks", desc: "가진 덱 관리", auth: true },
    ],
  },
  {
    key: "play",
    label: "놀이터",
    icon: "🎮",
    to: "/playground",
    paths: ["/playground", "/solo", "/card-quiz", "/skill-names", "/multiplayer", "/duchmind-wordpacks", "/icon-shop", "/tournaments"],
    items: [
      { label: "멀티플레이", to: "/multiplayer", desc: "여럿이 함께" },
      { label: "솔로 플레이", to: "/solo", desc: "혼자 즐기는 미니게임" },
      { label: "아이콘 샵", to: "/icon-shop", desc: "포인트로 아이콘 사기" },
      { label: "등반 덱 기록", to: "https://mdarchive.pages.dev/#climb", desc: "외부 사이트", external: true },
      { label: "대회", to: "", desc: "준비 중", soon: true },
    ],
  },
];

export const ME_ITEMS: MenuItem[] = [
  { label: "마이페이지", to: "/mypage", auth: true },
  { label: "포인트 내역", to: "/mypage/points", auth: true },
  { label: "아이콘·테두리", to: "/mypage/avatar", auth: true },
  { label: "공지사항", to: "/changelog" },
  { label: "이용약관", to: "/terms" },
];

export const ALL_MENU_PATH = "/all";

/** The group a page belongs to, for highlighting its tab / menu. */
export function groupOf(pathname: string): MenuGroup | undefined {
  return MENU_GROUPS.find((g) => g.paths.some((p) => pathname === p || pathname.startsWith(p + "/")));
}

export function itemHref(item: MenuItem, loggedIn: boolean): string {
  return item.auth && !loggedIn ? "/login" : item.to;
}
