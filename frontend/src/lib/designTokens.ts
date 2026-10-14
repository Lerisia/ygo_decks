// The site's design in one place (참혈 2026-10-14): what the design page /dev/palette shows and frontend/DESIGN.md is
// written from (src/lib/designMd.ts), laid out like the DESIGN.md files on getdesign.md. The counts come from
// designUsage.json (scripts/design-usage.mjs); the data colours are imported from where the site draws them.
import { CHART_BLUE, EMPTY_GRAY, GRID_STROKE, MEDALS, RADAR_BLUE } from "@/components/charts/theme";
import { COIN_PALETTES } from "@/components/CoinBadge";
import { SOURCE_STYLE } from "@/components/DeckNotesSection";
import { RARITY_BADGE, RARITY_LABEL } from "@/api/cardIconApi";
import { POWER_COLORS } from "@/lib/deckPower";
import { FRAME_COLORS } from "@/lib/cardFrames";

/** A Tailwind colour class with "dark:" left off ("bg-blue-600", "text-gray-500", "bg-blue-900/20") or a hex. */
export type Tone = string;

export type Swatch = {
  /** a short English name for DESIGN.md's token list */
  key: string;
  name: string;
  light: Tone;
  /** the dark screen's value; left out when it is the same */
  dark?: Tone;
  role: string;
  where: string;
  /** a background drawn instead of the flat colour (the coin badges' gradients) */
  paint?: string;
  /** the class to write when it is not the tone itself */
  cls?: string;
};

export type ColorGroup = { id: string; title: string; note?: string; swatches: Swatch[] };

export const OVERVIEW = {
  title: "YGO Decks 디자인 정리",
  summary:
    "유희왕 마스터 듀얼 덱·카드 도감과 전적 기록 사이트. 흑백 선화 로고와 흰 바탕 위에 파랑 하나를 주색으로 쓰고, " +
    "나머지는 회색(gray) 단계로 정리합니다. 색이 많은 곳은 덱 파워·승률·레어도처럼 데이터가 색을 가진 자리뿐입니다.",
  paragraphs: [
    "친구가 그려 준 흑백 선화 로고(역삼각형 안의 카드)가 사이트의 얼굴입니다. 로고 모양은 바꾸지 않고, 어두운 화면에서는 " +
      "CSS invert로 뒤집기만 합니다. 로고 세트(2026-10-14)는 favicon·탭 아이콘·앱 아이콘·링크 미리보기(og-image)·메뉴 로고 " +
      "logo_wide.webp이고, 같은 그림을 쪼갠 로딩 표시(LogoLoader)가 있습니다.",
    "기본은 밝은 화면이고, 더보기·마이페이지의 스위치로 어두운 화면을 고릅니다(localStorage theme, html.dark). 글꼴은 " +
      "본문 전체가 Pretendard, 카드 그림 속 글자는 서버가 마루 부리·Noto로 그립니다. 주색은 파랑 blue-600(#2563eb) — 주 " +
      "버튼·켜진 칩·스위치·포인트 P·차트 막대가 모두 이 색입니다. 상자는 흰 바탕에 회색 테두리, 모서리는 버튼·입력 8px, " +
      "상자 12px, 칩·알약 둥글게.",
  ],
  traits: [
    "흑백 선화 로고, 어두운 화면에서는 invert",
    "주색은 파랑 하나: bg-blue-600 · hover:bg-blue-700 (#2563eb · #1d4ed8)",
    "무채색은 gray 한 계열(slate·zinc·neutral·stone은 클래스에 없음)",
    "밝은 화면 기본, 어두운 화면은 같은 클래스의 dark: 짝으로",
    "Pretendard 본문, 카드 그림은 마루 부리·Noto(무료 글꼴만)",
    "rounded-lg(8px) 버튼·입력, rounded-xl(12px) 상자, rounded-full 칩·스위치·아바타",
    "데이터 색: 덱 파워 6단계, 승률(55%↑ 파랑·45%↓ 빨강), 레어도, 코인 배지 E·N",
  ],
};

export const COLOR_GROUPS: ColorGroup[] = [
  {
    id: "color-primary",
    title: "주색",
    note: "파랑은 '누를 수 있다·선택됐다·좋다'는 뜻으로만 씁니다. 다른 강조색은 정해진 자리 하나씩입니다(후원 장미색, 관리 호박색).",
    swatches: [
      { key: "primary", name: "주 파랑", light: "bg-blue-600", role: "주 버튼, 켜진 칩·스위치, 포인트 P, 차트 막대", where: "버튼 84곳(bg-blue-600 → hover:bg-blue-700), DexFilterBar 켜진 칩, PLogo, MeterBar·ColumnChart" },
      { key: "primary-hover", name: "주 파랑 (누를 때)", light: "bg-blue-700", role: "주 버튼·켜진 칩의 hover", where: "hover:bg-blue-700 — 마우스가 있는 기기에서만" },
      { key: "primary-text", name: "파랑 글자", light: "text-blue-600", dark: "text-blue-400", role: "현재 메뉴, 포인트 숫자, 승률 55% 이상, 강조 링크", where: "Navbar·하단 탭바 현재 메뉴, 포인트 잔액, rateTone" },
      { key: "primary-soft", name: "선택 바탕", light: "bg-blue-50", dark: "bg-blue-900/20", role: "선택된 메뉴·줄의 옅은 바탕", where: "Navbar 현재 메뉴(dark:bg-blue-900/30), 선택된 행" },
      { key: "logo-ink", name: "로고 잉크", light: "#000000", dark: "#ffffff", role: "로고·로딩 표시의 선(어두운 화면은 invert)", where: "logo_wide.webp, LogoLoader (dark:invert)" },
      { key: "donate", name: "후원 장미색", light: "bg-rose-600", role: "후원 버튼 하나만", where: "Navbar 우측 상단 ☕ 후원 (hover:bg-rose-700)" },
      { key: "staff", name: "운영진 호박색", light: "text-amber-700", dark: "text-amber-300", role: "운영진 전용 링크·표시", where: "Navbar '관리' 링크" },
    ],
  },
  {
    id: "color-surface",
    title: "표면",
    note: "페이지 바탕은 shadcn 변수(bg-background), 그 위 상자는 흰색/gray-800입니다. 어두운 화면에서는 바탕이 중성 검정, 상자가 푸른 회색이라 계열이 둘입니다(알려진 빈틈).",
    swatches: [
      { key: "canvas", name: "페이지 바탕", light: "#ffffff", dark: "#0a0a0a", cls: "bg-background", role: "body 바탕", where: "index.css body { bg-background } — --background 0 0% 100% / 0 0% 3.9%" },
      { key: "surface-card", name: "상자·카드", light: "bg-white", dark: "bg-gray-800", role: "상자, 팝업, 드롭다운, 칩 기본", where: "가장 많이 쓰는 짝 318곳" },
      { key: "surface-bar", name: "메뉴 막대", light: "bg-white", dark: "bg-gray-900", role: "위 메뉴 막대·하단 탭바·메뉴 펼침", where: "Navbar, BottomTabBar" },
      { key: "surface-soft", name: "옅은 면", light: "bg-gray-50", dark: "bg-gray-900", role: "줄 hover, 보조 막대, 안쪽 패널", where: "hover:bg-gray-50, 폰 홈의 이름·포인트 줄" },
      { key: "surface-muted", name: "회색 면", light: "bg-gray-200", dark: "bg-gray-700", role: "탭 바탕, 꺼진 칩, 스켈레톤", where: "DexTabs 바탕, DexFilterBar off, 스켈레톤 41곳" },
      { key: "surface-chip", name: "연회색 면", light: "bg-gray-100", dark: "bg-gray-700", role: "작은 배지, 고르기 옵션, 빈 칸", where: "필터 옵션 버튼, 출처 배지(기타), ResultChips 빈칸" },
      { key: "overlay", name: "덮개", light: "bg-black/60", role: "모달 뒤 화면 가림", where: "fixed inset-0 bg-black/60 14곳 · bg-black/50 12곳" },
    ],
  },
  {
    id: "color-text",
    title: "글자",
    swatches: [
      { key: "ink", name: "본문 글자", light: "#0a0a0a", dark: "#fafafa", cls: "text-foreground", role: "기본 글자(따로 지정하지 않을 때)", where: "body text-foreground; 제목은 text-gray-900 dark:text-white(23)·text-black dark:text-white(39)도" },
      { key: "ink-secondary", name: "보조 글자", light: "text-gray-500", dark: "text-gray-400", role: "설명, 날짜, 라벨, 단위", where: "306곳 — 가장 많이 쓰는 글자 색" },
      { key: "ink-body", name: "중간 글자", light: "text-gray-600", dark: "text-gray-300", role: "설명 본문, 칩 글자", where: "61곳; text-gray-700 dark:text-gray-300(43)·dark:text-gray-200(33)도 같은 역할" },
      { key: "ink-muted", name: "흐린 글자", light: "text-gray-400", dark: "text-gray-500", role: "준비 중 메뉴, 비활성, ↗ 표시", where: "Navbar 준비 중 항목, 외부 링크 ↗" },
      { key: "on-color", name: "색 위 글자", light: "text-white", role: "파랑·빨강·회색 버튼 위", where: "모든 채운 버튼" },
    ],
  },
  {
    id: "color-border",
    title: "테두리",
    swatches: [
      { key: "border-control", name: "입력·칩 테두리", light: "border-gray-300", dark: "border-gray-600", role: "입력칸, 기본 칩, 알약 버튼, 덱 파워 스위치", where: "171곳" },
      { key: "border-box", name: "상자 테두리", light: "border-gray-200", dark: "border-gray-700", role: "상자·패널·메뉴 막대 아래선", where: "107곳" },
      { key: "border-hair", name: "옅은 구분선", light: "border-gray-100", dark: "border-gray-700", role: "목록 줄 사이", where: "더보기 목록, 표 줄" },
      { key: "border-default", name: "기본 테두리", light: "#e5e5e5", dark: "#262626", cls: "border", role: "색을 적지 않은 border", where: "* { border-border } — --border 0 0% 89.8% / 14.9%" },
      { key: "focus", name: "포커스 고리", light: "ring-blue-500", role: "입력칸 포커스", where: "focus:ring-2 focus:ring-blue-500 focus:outline-none 28곳" },
    ],
  },
  {
    id: "color-semantic",
    title: "의미색",
    note: "글자는 600(어두운 화면 400), 옅은 바탕은 50(어두운 화면 900/20), 테두리는 200(800)으로 짝을 맞춥니다.",
    swatches: [
      { key: "success", name: "성공", light: "text-green-600", dark: "text-green-400", role: "완료, 저장됨, 이김", where: "text-green-700 dark:text-green-300(24)도; 버튼 bg-green-600 hover:bg-green-700" },
      { key: "success-soft", name: "성공 바탕", light: "bg-green-100", dark: "bg-green-900/30", role: "성공 알림 상자·배지", where: "저장 완료 표시" },
      { key: "warning", name: "경고", light: "text-amber-600", dark: "text-amber-400", role: "주의, 베타, 오래된 노트", where: "(베타) 글자, ⏳ 2년 이상 지난 노트(amber-800/300)" },
      { key: "warning-soft", name: "경고 바탕", light: "bg-yellow-50", dark: "bg-yellow-900/20", role: "주의 상자", where: "안내 상자 14곳; 코인 블록은 amber-50" },
      { key: "danger", name: "위험", light: "text-red-600", dark: "text-red-400", role: "오류, 삭제, 짐", where: "오류 문구 32곳; 승률 45% 아래는 text-red-500" },
      { key: "danger-soft", name: "위험 바탕", light: "bg-red-50", dark: "bg-red-900/20", role: "오류 상자", where: "border-red-200 dark:border-red-800과 함께" },
      { key: "danger-fill", name: "위험 버튼·점", light: "bg-red-500", role: "삭제 버튼, 새 알림 점", where: "bg-red-500 hover:bg-red-600 8곳; 숫자 배지는 bg-red-600" },
      { key: "info", name: "정보", light: "text-blue-700", dark: "text-blue-300", role: "안내 문구", where: "41곳; 바탕 bg-blue-50 dark:bg-blue-900/20, 테두리 border-blue-300 dark:border-blue-700" },
      { key: "beta", name: "베타 배지", light: "bg-amber-500", role: "BETA 표시", where: "놀이터 타일 BETA (text-white)" },
    ],
  },
];

const POWER_WHERE = "덱 도감 '덱 파워' 스위치를 켜면 표지 3px 테두리+같은 색 빛(box-shadow), 범례 점";
const coinStops = (bg: unknown) => String(bg).match(/#[0-9a-f]{6}/gi) ?? [];

/** Colours that belong to the data, not to the interface. */
export const DATA_GROUPS: ColorGroup[] = [
  {
    id: "data-power",
    title: "덱 파워 6단계",
    note: "lib/deckPower.ts POWER_COLORS. 강한 순서대로 빨강→보라, 밝은/어두운 화면 같은 값.",
    swatches: POWER_COLORS.map((p, i) => ({
      key: `power-${i + 1}`,
      name: p.label,
      light: p.color,
      role: `${i + 1}단계`,
      where: POWER_WHERE,
    })),
  },
  {
    id: "data-winrate",
    title: "승률",
    note: "charts/theme.ts. rateTone: 55% 초과 파랑·45% 미만 빨강(굵게), 사이는 보통 글자. winRateTint(메타 통계·시트 목록): 55% 이상 파랑, 45% 이하 빨강, 50~55%와 45~50%는 글자색에 파랑/빨강을 섞는 그라데이션(color-mix).",
    swatches: [
      { key: "win-good", name: "좋은 승률", light: "text-blue-600", dark: "text-blue-400", role: "55% 초과(rateTone) · 이상(winRateTint)", where: "시트 통계 표(rateTone), 사용률 도넛·시트 목록(winRateTint, dark 짝 없음)" },
      { key: "win-bad", name: "나쁜 승률", light: "text-red-500", dark: "text-red-400", role: "45% 미만(rateTone) · 이하(winRateTint)", where: "같은 곳" },
      { key: "win-chip", name: "승 칩", light: "bg-blue-600", role: "최근 전적 칩: 이김", where: "ResultChips (선/후 글자)" },
      { key: "lose-chip", name: "패 칩", light: "bg-red-500", role: "최근 전적 칩: 짐", where: "ResultChips" },
      { key: "chip-empty", name: "빈 칩", light: "bg-gray-100", dark: "bg-gray-700/60", role: "아직 없는 판", where: "ResultChips" },
    ],
  },
  {
    id: "data-coin",
    title: "코인 배지 · 코인토스",
    note: "CoinBadge.tsx COIN_PALETTES: 둥근 동전 모양 그라데이션. E는 엔진 덱(금색), N은 신규 업데이트 덱(빨강, 10/13부터 — 그 전 파란 U는 남아 있지만 쓰지 않음).",
    swatches: [
      { key: "coin-engine", name: "E · 엔진", light: coinStops(COIN_PALETTES.gold.background)[2] ?? "#f59e0b", paint: String(COIN_PALETTES.gold.background), role: `글자 ${String(COIN_PALETTES.gold.color)}, 바탕 ${coinStops(COIN_PALETTES.gold.background).join(" → ")}`, where: "덱 표지 왼쪽 위 (EngineBadge)" },
      { key: "coin-new", name: "N · 신규 업데이트 덱", light: coinStops(COIN_PALETTES.red.background)[1] ?? "#f03030", paint: String(COIN_PALETTES.red.background), role: `흰 글자, 바탕 ${coinStops(COIN_PALETTES.red.background).join(" → ")}`, where: "덱 표지 오른쪽 위 (UpdateBadge), 사용률 도넛" },
      { key: "coin-block", name: "코인토스 상자", light: "bg-amber-50", dark: "bg-amber-900/15", role: "코인 이김/짐 승률 블록", where: "CoinSplit (border-amber-200 dark:border-amber-800/60, 칩 bg-amber-200)" },
    ],
  },
  {
    id: "data-chart",
    title: "차트",
    note: "components/charts. 사용률 도넛은 덱 원본 일러스트로 칠하고, 그 밖의 막대·곡선은 파랑 하나입니다.",
    swatches: [
      { key: "chart-blue", name: "차트 파랑", light: CHART_BLUE, role: "막대·곡선·면(10%)", where: "ColumnChart, RankCurve" },
      { key: "radar-blue", name: "레이더 파랑", light: RADAR_BLUE, role: "덱 스탯 레이더", where: "StatRadar" },
      { key: "chart-empty", name: "빈 값 회색", light: EMPTY_GRAY, role: "스탯 없는 레이더", where: "StatRadar" },
      { key: "chart-grid", name: "격자선", light: GRID_STROKE, role: "가로 격자(투명도 0.7)", where: "RankCurve" },
      ...MEDALS.map((hex, i) => ({ key: `medal-${i + 1}`, name: ["금", "은", "동"][i] + " 메달", light: hex, role: `${i + 1}위`, where: "사용률 도넛 순위" })),
      { key: "meter-track", name: "막대 바탕", light: "bg-gray-100", dark: "bg-gray-700", role: "MeterBar 트랙(red·amber 판도 있음)", where: "MeterBar, BarStat" },
    ],
  },
  {
    id: "data-notice",
    title: "알림 · 신규",
    note: "마이페이지 알림은 노란 섹션 안에 갈색(tan) 카드. 읽은 알림은 회색.",
    swatches: [
      { key: "notice-section", name: "알림 섹션 테두리", light: "border-yellow-400", dark: "border-yellow-500", role: "border-2, 바탕 bg-yellow-300/25 dark:bg-yellow-500/10", where: "마이페이지 '알림 n개'" },
      { key: "notice-card", name: "알림 카드", light: "#d2b48c", dark: "#6e5737", cls: "bg-[#d2b48c] dark:bg-[#6e5737]", role: "안 읽은 알림 한 장", where: "NotificationCard" },
      { key: "notice-sender", name: "보낸 이", light: "text-amber-900", dark: "text-amber-200", role: "알림 카드 머리", where: "NotificationCard" },
      { key: "notice-action", name: "알림 버튼", light: "bg-yellow-400", role: "알림이 가리키는 곳으로(hover:bg-yellow-500, 글자 gray-900)", where: "NotificationCard; 한 번 누르면 비활성 회색" },
      { key: "unread-dot", name: "새 알림 점", light: "bg-red-500", role: "프로필 사진 위 빨간 점(ring-2 ring-white)", where: "Navbar" },
    ],
  },
  {
    id: "data-rarity",
    title: "레어도 · 아이콘 등급",
    note: "카드 레어도 N/R/SR/UR은 색이 아니라 마스터 듀얼의 배지 그림(/media/md_ui/rarity_*_hd.png)을 그대로 씁니다. 포인트 상점 아이콘·프레임 등급은 따로 네 가지 색(cardIconApi RARITY_BADGE).",
    swatches: (["common", "rare", "epic", "legendary"] as const).map((r) => {
      const cls = RARITY_BADGE[r];
      const bg = cls.match(/(?:^|\s)(bg-[a-z]+-\d+)/)?.[1] ?? "bg-gray-100";
      const darkBg = cls.match(/dark:(bg-[a-z]+-\d+(?:\/\d+)?)/)?.[1];
      return { key: `icon-${r}`, name: RARITY_LABEL[r], light: bg, dark: darkBg, cls, role: "포인트 상점 등급 배지", where: "IconShop" };
    }),
  },
  {
    id: "data-frame",
    title: "카드 문서 상자",
    note: "lib/cardFrames.ts FRAME_COLORS. 카드 문서 맨 위 상자를 그 카드의 테두리 색으로 칠합니다(일반·싱크로는 어두운 글자).",
    swatches: Object.entries(FRAME_COLORS).map(([k, hex]) => ({
      key: `frame-${k}`,
      name: { normal: "일반", effect: "효과", ritual: "의식", fusion: "융합", synchro: "싱크로", xyz: "엑시즈", link: "링크", spell: "마법", trap: "함정", token: "토큰" }[k] ?? k,
      light: hex,
      role: `${k} 카드`,
      where: "CardDetail 정보 상자 (펜듈럼은 아래가 마법 색)",
    })),
  },
  {
    id: "data-source",
    title: "강의노트 출처",
    note: "DeckNotesSection SOURCE_STYLE. 출처마다 옅은 바탕+진한 글자 배지.",
    swatches: Object.entries(SOURCE_STYLE).map(([k, cls]) => ({
      key: `source-${k}`,
      name: { postype: "포스타입", dcinside: "디시인사이드", notion: "노션", gdocs: "구글 문서", blog: "블로그", twitter: "X(트위터)", other: "기타" }[k] ?? k,
      light: cls.match(/(?:^|\s)(bg-[a-z]+-\d+|bg-white|bg-black)/)?.[1] ?? "bg-gray-100",
      dark: cls.match(/dark:(bg-[a-z]+-\d+(?:\/\d+)?)/)?.[1],
      cls,
      role: "출처 배지",
      where: "덱 문서 강의노트",
    })),
  },
];

export const FONTS = [
  {
    name: "Pretendard Variable",
    use: "사이트의 모든 글자(본문·제목·버튼)",
    detail: "jsdelivr에서 dynamic subset으로 받음(index.html). 대체: Pretendard, Inter, system-ui, Avenir, Helvetica, Arial. OFL 무료 글꼴.",
    family: '"Pretendard Variable", Pretendard, Inter, system-ui, sans-serif',
  },
  {
    name: "마루 부리 (MaruBuri)",
    use: "카드 그림 속 이름·종족 줄·공격력/수비력·스케일",
    detail: "서버(carddb/face.py)가 카드 그림을 만들 때 씀 — 웹 글꼴로 받지 않음. 없는 글자는 Noto Serif KR → Noto Serif JP → DejaVu Serif.",
    family: "serif",
  },
  {
    name: "Noto Sans KR / Noto Serif KR",
    use: "카드 그림 속 효과문(그릴 때), 대체 글자",
    detail: "역시 서버에서만. 상업용·게임 추출 글꼴(마듀 로딘, AtkDef 등)은 쓰지 않음.",
    family: "serif",
  },
];

export const TYPE_SCALE = [
  { key: "page-title", name: "페이지 제목", cls: "text-2xl font-bold", px: "24px / 700", where: "h1 18곳(text-xl font-bold 13곳, 큰 화면 md:text-3xl·4xl)" },
  { key: "section-title", name: "섹션 제목", cls: "text-lg font-bold", px: "18px / 700", where: "h2·h3 — text-lg font-semibold도" },
  { key: "card-title", name: "상자 제목", cls: "text-base font-semibold", px: "16px / 600", where: "상자 머리, 목록 이름 (코인 블록은 text-[15px] font-bold)" },
  { key: "body", name: "본문", cls: "text-sm", px: "14px / 400", where: "가장 많이 쓰는 크기 — 버튼·칩·설명" },
  { key: "body-lg", name: "큰 본문", cls: "text-base", px: "16px / 400", where: "덱 이름(sm 이상), 문서 본문" },
  { key: "caption", name: "작은 글씨", cls: "text-xs", px: "12px / 400", where: "날짜·라벨·보조 설명" },
  { key: "micro", name: "아주 작은 글씨", cls: "text-[11px]", px: "11px", where: "배지·차트 주석(text-[10px]도 많음 — 정리 후보)" },
];

export const TYPE_RULES = [
  "굵기는 semibold(600)가 기본 강조, 제목은 bold(700). medium(500)은 드뭄.",
  "숫자가 줄 맞춰 바뀌는 곳(포인트, 승률, 판수)은 tabular-nums.",
  "좁은 칸의 한국어는 break-keep — 낱말 가운데서 줄이 바뀌지 않게(\"링크 마/커\" 금지).",
  "휴대폰(640px 미만)에서 input·textarea·select는 16px 이상(index.css) — iOS 확대 방지.",
  "줄 간격 기본 1.5(:root). 글자 크기는 Tailwind 단계(xs~2xl)를 먼저 쓰고 [11px] 같은 값은 배지에만.",
  "h1~h6에는 전역 크기가 있음(tailwind.css: h1 text-5xl, margin 0.2em) — 페이지마다 클래스로 덮어씀.",
];

export const LAYOUT = {
  rules: [
    "모든 페이지의 바깥 상자 위쪽은 pt-6 또는 py-6(24px) 하나만 — 메뉴 막대 아래 24px (backend/backend/test_frontend_page_top.py가 검사).",
    "페이지 바깥 상자: min-h-screen w-full max-w-* mx-auto px-4 py-6. 좌우 여백은 px-4(16px)가 51개 페이지.",
    "#root: 휴대폰은 좌우 10px, md(768px) 이상은 최대 1280px + 안쪽 2rem (App.css).",
    "간격은 Tailwind 4px 단계: gap-2(8px)가 가장 많고, 상자 안쪽은 p-4·px-3 py-2, 상자 사이는 mb-4·mt-4.",
    "비동기 영역은 같은 크기의 스켈레톤(bg-gray-200 dark:bg-gray-700 animate-pulse) — 불러온 뒤 화면이 밀리지 않게.",
    "게임 화면은 크기가 바뀌지 않음(고정 크기, svh — dvh 아님).",
  ],
  bars: [
    { name: "PC 메뉴 막대", value: "h-20 (80px), 안쪽 max-w-6xl px-4" },
    { name: "휴대폰 위 막대", value: "h-14 (56px), sm 미만" },
    { name: "휴대폰 하단 탭바", value: "h-16 (64px), fixed, sm 미만" },
    { name: "덱 도감 격자", value: "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" },
    { name: "카드 도감 격자", value: "grid-cols-3 sm:4 md:5 lg:grid-cols-6 gap-3" },
    { name: "덱 짜기 칸", value: ".deck-zone 5 / sm 6 / md 8 / lg 10열" },
  ],
};

export const DEPTH = [
  { cls: "shadow", name: "기본 그림자", use: "떠 있는 상자(놀이터 타일, 마이페이지 카드) — hover:shadow-md" },
  { cls: "shadow-md", name: "중간", use: "hover로 올라온 타일" },
  { cls: "shadow-lg", name: "떠 있는 메뉴", use: "드롭다운 메뉴, 필터 팝오버, 토스트" },
  { cls: "shadow-xl", name: "모달", use: "필터 모달, 확인 창 (편집 창은 shadow-2xl)" },
  { cls: "ring-1 ring-white/10", name: "어두운 화면 테두리", use: "어두운 화면에서는 그림자 대신 옅은 흰 고리(카드 문서 상자 dark:ring-1)" },
];

export const RADII = [
  { cls: "rounded", px: "4px", use: "작은 배지(BETA·출처·레어도 등급), 스켈레톤 줄" },
  { cls: "rounded-md", px: "6px", use: "shadcn Input, DexTabs 안쪽 탭" },
  { cls: "rounded-lg", px: "8px", use: "버튼·입력·칩·작은 상자 — 기본" },
  { cls: "rounded-xl", px: "12px", use: "상자·패널·섹션·메뉴 펼침·모달" },
  { cls: "rounded-2xl", px: "16px", use: "홈 화면 섹션, 레코더 안내, 덱 짜기 검색 패널" },
  { cls: "rounded-full", px: "9999px", use: "알약 버튼(공지·문의·후원), 스위치, 아바타, 점, 코인 배지, 숫자 배지" },
  { cls: "card-corner", px: "3.5% / 2.4%", use: "카드 그림 — 704×1024 카드의 진짜 모서리(index.css)" },
];

export type ComponentDoc = { id: string; title: string; desc: string; classes?: string[]; states?: string[] };

export const COMPONENTS: ComponentDoc[] = [
  {
    id: "buttons",
    title: "버튼",
    desc: "채운 버튼은 h-9 px-4 rounded-lg font-semibold, 흰 글자. 주 버튼은 파랑, 보조(닫기·취소)는 회색 500, 위험은 빨강. 누를 수 없을 때는 회색 면+흐린 글자+cursor-not-allowed.",
    classes: [
      "주: h-9 px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition",
      "보조: h-9 px-4 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition",
      "위험: bg-red-500 text-white hover:bg-red-600",
      "테두리: border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800",
      "비활성: bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed",
      "알약: rounded-full px-3 py-1.5 text-sm font-semibold border … (공지·문의), bg-rose-600 (후원)",
    ],
    states: [
      "hover는 마우스가 있는 기기에서만(hoverOnlyWhenSupported)",
      "포커스는 키보드일 때만 테두리(button:focus-visible)",
      "지금은 index.css 때문에 마우스를 올리면 1px 보라 테두리가 함께 생김 — 견본의 테두리 버튼처럼 hover:border-…를 붙이면 막힘(알려진 빈틈)",
    ],
  },
  {
    id: "inputs",
    title: "입력 · 검색칸",
    desc: "검색칸은 모두 SearchForm 안에 두고 input에 enterKeyHint=\"search\" — 휴대폰 키보드의 검색 키로 입력을 끝내고 키보드를 내립니다(test_frontend_search_boxes.py가 검사). 도감은 shadcn Input(h-9 rounded-md), 그 밖은 rounded-lg 입력.",
    classes: [
      "<SearchForm onSearch={…}><Input enterKeyHint=\"search\" placeholder=\"… 검색\" /></SearchForm>",
      "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500",
    ],
  },
  {
    id: "filters",
    title: "칩 · 필터 바",
    desc: "덱·카드 도감의 DexFilterBar: 기본 칩(종류/파워)부터, 쓰는 칩은 파랑+✕, 여러 개 항목은 값마다 칩, + 로 나머지 펼침. 데스크톱은 고르는 즉시 적용, 휴대폰은 모달에서 닫기·적용. 칩은 h-9 rounded-lg text-sm font-semibold.",
    classes: ["on: bg-blue-600 text-white hover:bg-blue-700", "base: border-gray-300 bg-white … dark:bg-gray-800", "off: bg-gray-200 dark:bg-gray-700", "옵션: h-8 px-3 rounded-lg bg-gray-100 dark:bg-gray-700"],
  },
  {
    id: "tabs",
    title: "탭 · 나눔 단추",
    desc: "회색 바탕(rounded-lg bg-gray-200 dark:bg-gray-700 p-1) 위에 고른 칸만 흰 바탕+그림자. 덱/카드 도감 탭(DexTabs), 카드 문서 연혁 형식, 고르기 창 보기 방식.",
    classes: ["바탕: grid grid-cols-2 gap-1 rounded-lg bg-gray-200 dark:bg-gray-700 p-1", "고른 칸: rounded-md bg-white dark:bg-gray-900 shadow"],
  },
  {
    id: "switches",
    title: "스위치",
    desc: "켜면 파랑, 끄면 회색, 흰 손잡이가 미끄러짐. role=\"switch\" aria-checked. 크기가 화면마다 달라 정리 후보입니다.",
    classes: ["덱 파워: w-9 h-5 (켬 bg-blue-600 / 끔 bg-gray-400), 손잡이 w-4 h-4 translate-x-4", "화면 밝기(더보기): w-11 h-6 (끔 bg-gray-300), 손잡이 w-5 h-5 translate-x-5"],
  },
  {
    id: "badges",
    title: "배지",
    desc: "동전 배지(E 엔진·N 신규), 포인트 P, BETA, 상점 등급, 강의노트 출처, 레어도·금제 그림, 숫자 배지.",
    classes: ["CoinBadge: rounded-full font-black ring-2 ring-white dark:ring-gray-900 + 그라데이션", "BETA: text-xs font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white", "숫자: min-w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[10px] font-bold"],
  },
  {
    id: "decks",
    title: "덱 표지 · 카드 그림",
    desc: "덱 표지는 휴대폰 h-24, md부터 4:3, rounded-lg; 덱 파워를 켜면 그 색 3px 고리. 카드는 서버가 그린 한국어 전체 카드 그림(마듀 테두리), card-corner 모서리, 오른쪽 위 레어도·왼쪽 위 금제 그림.",
  },
  {
    id: "avatar",
    title: "아바타 + 프레임",
    desc: "사용자 이름이 나오는 곳에는 늘 아이콘+프레임(Avatar)을 함께. 단색 프레임은 얇은 고리(5%), 그림 프레임은 아이콘 위에 덮어 그림(가운데 74% 비움).",
  },
  {
    id: "picker",
    title: "고르기 창",
    desc: "덱·카드처럼 그림으로 고르는 곳은 공용 PickerModal(DeckPickerModal 등): 큰 그림/작은 그림/목록 보기, 휴대폰 기본 작은 그림·PC 기본 큰 그림, 고른 보기를 기억.",
  },
  {
    id: "loading",
    title: "스켈레톤 · 로딩",
    desc: "불러오는 자리는 같은 크기의 회색 덩어리(animate-pulse). 로고로 만든 로딩 표시 LogoLoader는 섞기 3번+쉼, 움직임 줄이기 설정에서는 깜빡임만.",
  },
  {
    id: "notice",
    title: "알림 카드",
    desc: "NotificationCard: 보낸 이·지우기(×)·내용·이동 버튼. 이동 버튼은 한 번 누르면 비활성. 마이페이지에서는 노란 섹션 안에 최대 3장.",
  },
  {
    id: "charts",
    title: "차트 조각",
    desc: "components/charts: 최근 전적 칩(ResultChips), 얇은 막대(MeterBar h-1.5 rounded-full), 코인토스 블록(CoinSplit), 승률 색(winRateTint). 견본 전체는 /manage/charts.",
  },
];

export const DOS = [
  "주 버튼은 bg-blue-600 hover:bg-blue-700 흰 글자 rounded-lg, 보조는 bg-gray-500 hover:bg-gray-600, 비활성은 회색 면에 흐린 글자.",
  "밝은 화면 클래스마다 dark: 짝을 붙임 — bg-white dark:bg-gray-800, text-gray-500 dark:text-gray-400, border-gray-300 dark:border-gray-600.",
  "모든 페이지 바깥 상자 위쪽은 pt-6/py-6(24px)만.",
  "불러오는 영역은 같은 크기 스켈레톤으로 자리를 먼저 잡음 — 새 화면을 만들면 스켈레톤도 함께.",
  "검색칸은 SearchForm + enterKeyHint=\"search\".",
  "좁은 칸의 한국어는 break-keep.",
  "사용자 이름 옆에는 Avatar(아이콘+프레임).",
  "덱·카드를 고르는 곳은 공용 PickerModal.",
  "로고는 그대로 쓰고 어두운 화면에서만 invert.",
  "용어: 아키타입은 「카드군」, 다른 아트는 「다른 일러스트」(좁은 칸 「다른 일러」), PC 프로그램은 「레코더」(이름은 「YGO Decks 레코더」, 버튼은 「다운로드」로 Windows에서만), 게임은 「마스터 듀얼」(게임 안 한국어처럼 띄어 씀), 레코더 글의 한 판은 「듀얼」, 상점은 「포인트 상점」(짧게 「상점」), 아바타 테두리는 「프레임」.",
];

export const DONTS = [
  "로고 모양을 바꾸거나 새로 그리지 않음.",
  "상업용·게임 추출 글꼴(마듀 로딘, AtkDef 등)을 쓰지 않음 — Noto·Pretendard·마루 부리 같은 무료 글꼴만.",
  "CSS :hover를 @media (hover: hover) 밖에 쓰지 않음 — 휴대폰에서 누른 색이 남음.",
  "게임 화면 크기가 판 도중 바뀌거나, 불러온 뒤 화면이 밀리지 않게.",
  "게임 화면 높이에 dvh를 쓰지 않음(svh).",
  "파랑을 주색 말고 다른 뜻(경고·장식)으로 쓰지 않음.",
  "화면 문구에 「트래커」, 「신규 일러」·「신일러」를 쓰지 않음.",
];

export const BREAKPOINTS = [
  { name: "sm", px: 640, note: "휴대폰/PC 나눔: 아래는 위 막대 h-14 + 하단 탭바, 필터는 모달(DexFilterBar)" },
  { name: "md", px: 768, note: "#root 1280px·2rem, 덱 표지 4:3, 격자 한 칸 늘림" },
  { name: "lg", px: 1024, note: "넓은 배치(덱 문서 PC 배치), 가로 화면 게임은 body 고정(svh)" },
  { name: "xl", px: 1280, note: "거의 안 씀" },
];

export const RESPONSIVE_RULES = [
  "휴대폰(sm 미만)은 하단 탭바(도감·도구·전적·놀이터·더보기, h-16 fixed)로 다님. 덱 짜기 화면과 게임 방에서는 숨김.",
  "안전 영역: 팩깡·덱 짜기 검색 패널이 env(safe-area-inset-*)로 여백을 잡음.",
  "터치 대상은 버튼·칩 h-9(36px) 이상, 탭바 칸은 64px 높이.",
  ":hover는 마우스 기기에서만 — Tailwind future.hoverOnlyWhenSupported, index.css의 a:hover·button:hover도 @media (hover: hover) 안.",
  "누를 때 회색 상자가 번쩍이지 않게 -webkit-tap-highlight-color: transparent.",
  "표지·카드 그림은 srcSet으로 휴대폰 320px, 문서 960px, loading=\"lazy\"는 src 앞에.",
];

export const ITERATION = [
  "색·모양을 바꾸면 이 파일(src/lib/designTokens.ts)과 해당 코드를 함께 고치고, 사용 빈도와 DESIGN.md를 다시 만듭니다.",
  "사용 빈도: cd frontend && node scripts/design-usage.mjs → src/lib/designUsage.json",
  "DESIGN.md: cd frontend && DESIGN_MD=write npx vitest run src/lib/designMd.test.ts (평소 테스트는 둘이 같은지만 봄)",
  "새 색이 필요하면 먼저 위 표의 역할 중 맞는 것이 있는지 봅니다 — 없을 때만 새 단계를 추가하고 여기에 적습니다.",
];

export const KNOWN_GAPS = [
  "버튼 단계 혼용: 파랑은 bg-blue-600→700이 84곳인데 bg-blue-500→600이 2곳, 빨강은 500→600(8)과 600→700(2), 회색 보조는 gray-500→600(14)과 gray-700→600(3).",
  "스위치 크기가 제각각: 덱 파워 w-9 h-5(끔 gray-400), 더보기 화면 밝기 w-11 h-6(끔 gray-300), 마이페이지 다크 모드 w-12 h-6, 시트 통계 w-11 h-6(끔 gray-300/dark gray-600).",
  "index.css에 Vite 시작 템플릿의 규칙이 남아 있음(헤드리스 Chrome으로 확인): 모든 button에 1px 투명 테두리와 8px 모서리가 붙고, 마우스를 올리면 그 테두리가 보라(#646cff)로 바뀜 — 주 버튼(bg-blue-600)·덱 파워 스위치도 hover 때 1px 보라 테두리. 막으려면 hover:border-transparent(DexFilterBar 칩)나 border-0. a는 굵기 500에 hover 글자색이 보라(#747bff, OS가 어두운 모드면 #535bf2). button의 padding·배경·굵기 규칙은 Tailwind preflight가 덮어 효과 없음.",
  "shadcn 변수의 --primary가 거의 검정(#171717)이라 ui/button(쓰는 곳 0)·ui/badge 기본 색이 사이트 주색(파랑)과 다름. ui/input은 rounded-md(6px)라 다른 입력칸(rounded-lg 8px)과 모서리가 다름.",
  "어두운 화면 바탕은 #0a0a0a(중성 검정)인데 상자는 gray-800(#1f2937)·메뉴는 gray-900(#111827) — 무채색 계열이 둘.",
  "승률 색 경계: rateTone은 55 초과/45 미만, winRateTint는 55 이상/45 이하라 정확히 55%·45%에서 다름. winRateTint의 text-blue-600·text-red-500에는 dark: 짝이 없음.",
  "모달 덮개가 bg-black/60(14곳)과 bg-black/50(12곳)으로 나뉨.",
  "표준 단계 밖 글자 크기: text-[10px] 84곳, text-[11px] 69곳, text-[13px] 16곳, text-[9px] 11곳.",
  "페이지 폭이 max-w-2xl·3xl·4xl·5xl·6xl·7xl·lg·md로 제각각(정해진 몇 가지가 없음).",
  "제목 크기 위계가 페이지마다 다름: h1이 text-2xl(18)·text-xl(13)·text-2xl md:text-3xl(7)·text-2xl md:text-4xl(4)…",
  "같은 역할에 비슷한 두 계열: 보라 purple(51)·violet(19), 초록 green(219)·emerald(26).",
  "하단 탭바의 safe-bottom 클래스는 정의가 없고 viewport-fit=cover도 없어, iPhone 홈 막대 여백은 브라우저 기본에 맡겨져 있음.",
  "터치 대상이 작은 곳: 알림 지우기 28px, 필터 옵션 32px, 코인 배지 20px — 44px 권장보다 작음.",
  "레어도 두 체계: 카드는 게임 배지 그림(N/R/SR/UR), 포인트 상점은 일반/희귀/서사/전설 색 배지.",
];
