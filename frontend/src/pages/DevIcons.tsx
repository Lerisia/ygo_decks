import { useState, type ReactNode } from "react";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { FA_REGULAR, FA_SOLID, MATERIAL_ICONS, MATERIAL_SYMBOLS, type Glyph } from "@/lib/iconSamples";

function Icon({ g, size, className = "" }: { g: Glyph; size: number; className?: string }) {
  return (
    <svg viewBox={g.vb} width={size} height={size} fill="currentColor" aria-hidden className={`shrink-0 ${className}`}>
      {g.d.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

type Row = { emoji: string; where: string; fa: string[] };
type Gap = Row & { note: string; mi?: string[]; sym?: string[]; tint?: string[] };

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "1. 상단 메뉴 · 하단 탭바 · 더보기",
    rows: [
      { emoji: "📢", where: "공지", fa: ["bullhorn"] },
      { emoji: "💬", where: "문의", fa: ["comment-dots"] },
      { emoji: "☕", where: "후원", fa: ["mug-hot"] },
      { emoji: "🎁", where: "출석 보너스", fa: ["gift"] },
      { emoji: "📚", where: "도감 탭", fa: ["book", "book-open"] },
      { emoji: "🧰", where: "도구 탭", fa: ["toolbox"] },
      { emoji: "📝", where: "전적 탭", fa: ["pen-to-square"] },
      { emoji: "🎮", where: "놀이터 탭", fa: ["gamepad"] },
      { emoji: "☰", where: "더보기", fa: ["bars"] },
      { emoji: "🌙", where: "어둡게", fa: ["moon"] },
      { emoji: "☀️", where: "밝게", fa: ["sun"] },
      { emoji: "👤", where: "내 정보", fa: ["circle-user"] },
      { emoji: "⚙️", where: "기타 · 설정", fa: ["gear"] },
    ],
  },
  {
    title: "2. 공통 버튼과 표시",
    rows: [
      { emoji: "🔍", where: "검색", fa: ["magnifying-glass"] },
      { emoji: "✕", where: "닫기", fa: ["xmark"] },
      { emoji: "✓", where: "확인", fa: ["check"] },
      { emoji: "↗", where: "외부 링크", fa: ["arrow-up-right-from-square"] },
      { emoji: "🔒", where: "잠금", fa: ["lock"] },
      { emoji: "🗑", where: "삭제", fa: ["trash-can"] },
      { emoji: "✏️", where: "수정", fa: ["pen", "pencil"] },
      { emoji: "⚠️", where: "경고", fa: ["triangle-exclamation"] },
      { emoji: "⏳", where: "대기", fa: ["hourglass-half"] },
      { emoji: "🕐", where: "시간", fa: ["clock"] },
      { emoji: "🔔", where: "알림", fa: ["bell"] },
      { emoji: "🔗", where: "링크", fa: ["link"] },
      { emoji: "🔄", where: "새로고침", fa: ["arrows-rotate"] },
      { emoji: "↶", where: "되돌리기", fa: ["rotate-left"] },
      { emoji: "↺", where: "다시", fa: ["rotate-right"] },
      { emoji: "💾", where: "저장", fa: ["floppy-disk"] },
      { emoji: "📋", where: "목록 · 규칙", fa: ["clipboard-list"] },
      { emoji: "🔊", where: "소리 켬", fa: ["volume-high"] },
      { emoji: "🔇", where: "소리 끔", fa: ["volume-xmark"] },
      { emoji: "✉️", where: "문의함", fa: ["envelope"] },
      { emoji: "📮", where: "받은 문의", fa: ["inbox"] },
      { emoji: "📦", where: "덱 업데이트 공지", fa: ["box-open"] },
      { emoji: "📊", where: "통계", fa: ["chart-column"] },
      { emoji: "📈", where: "추이", fa: ["chart-line"] },
    ],
  },
  {
    title: "3. 덱 문서 · 놀이터 · 멀티",
    rows: [
      { emoji: "🎯", where: "상대법", fa: ["bullseye", "crosshairs"] },
      { emoji: "📖", where: "덱 문서", fa: ["book-open"] },
      { emoji: "🏆", where: "우승", fa: ["trophy"] },
      { emoji: "👑", where: "1위", fa: ["crown"] },
      { emoji: "🎨", where: "그림", fa: ["palette"] },
      { emoji: "🖼️", where: "그림 · 테두리", fa: ["image"] },
      { emoji: "🏳️", where: "항복", fa: ["flag"] },
      { emoji: "❓", where: "질문", fa: ["circle-question"] },
      { emoji: "✋", where: "손 들기", fa: ["hand"] },
      { emoji: "🖊", where: "펜", fa: ["pen"] },
      { emoji: "🪣", where: "채우기", fa: ["fill-drip"] },
      { emoji: "👍", where: "좋아요", fa: ["thumbs-up"] },
      { emoji: "👎", where: "싫어요", fa: ["thumbs-down"] },
      { emoji: "💡", where: "힌트", fa: ["lightbulb"] },
      { emoji: "🤝", where: "협력", fa: ["handshake"] },
      { emoji: "🎭", where: "역할", fa: ["masks-theater"] },
      { emoji: "🧩", where: "퍼즐", fa: ["puzzle-piece"] },
      { emoji: "👀", where: "보기", fa: ["eye"] },
      { emoji: "📸", where: "사진", fa: ["camera"] },
      { emoji: "📱", where: "휴대폰", fa: ["mobile-screen"] },
      { emoji: "👻", where: "유령", fa: ["ghost"] },
      { emoji: "🚪", where: "나가기", fa: ["door-open"] },
      { emoji: "🛍️", where: "상점", fa: ["bag-shopping"] },
      { emoji: "🪙", where: "포인트", fa: ["coins"] },
      { emoji: "🏷️", where: "태그", fa: ["tag"] },
      { emoji: "🪄", where: "도구", fa: ["wand-magic-sparkles"] },
      { emoji: "📜", where: "문서", fa: ["scroll"] },
      { emoji: "📁", where: "폴더", fa: ["folder"] },
      { emoji: "♪", where: "테두리 음표", fa: ["music"] },
    ],
  },
];

// Font Awesome Free has no match: what it has nearest, and Material's (참혈 2026-10-15)
const GAPS: Gap[] = [
  { emoji: "⚔️", where: "대결", fa: ["shield-halved", "hand-fist"], sym: ["swords"], note: "칼은 Font Awesome 유료판에만 있음 · Material Icons(MUI)에도 없음" },
  { emoji: "🎴", where: "카드 게임", fa: ["clone", "layer-group"], mi: ["style", "casino"], sym: ["playing_cards"], note: "트럼프 카드는 Font Awesome 유료판에만 있음" },
  { emoji: "🎉", where: "축하", fa: ["champagne-glasses"], mi: ["celebration"], sym: ["celebration"], note: "파티 나팔은 Font Awesome 유료판에만 있음" },
  { emoji: "🐤", where: "멀티 게임 마스코트", fa: ["kiwi-bird", "dove"], mi: ["flutter_dash"], sym: ["flutter_dash", "raven"], note: "병아리는 어느 쪽에도 없음" },
  {
    emoji: "🥇🥈🥉", where: "1·2·3등", fa: ["medal"], mi: ["military_tech", "workspace_premium"], sym: ["military_tech", "workspace_premium"],
    tint: ["text-yellow-500", "text-gray-400", "text-amber-700"], note: "숫자가 든 메달은 어느 쪽에도 없음: 한 모양을 금·은·동 색으로",
  },
  { emoji: "💯", where: "만점", fa: [], note: "Font Awesome · Material 모두 없음: 이모지를 두거나 글자로" },
];

const SIZES = [16, 20, 24, 32];
const CELL = "flex items-center justify-center w-12 h-12 rounded-lg bg-gray-50 dark:bg-gray-900/40";

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children}
      <span className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[6rem] truncate" title={label}>{label}</span>
    </div>
  );
}

/** /dev/icons (operators only): the emoji the site draws its marks with, beside the free Font Awesome icons that could
 *  take their place, and Material's where Font Awesome has none (참혈 2026-10-15). */
export default function DevIcons() {
  const admin = useAdminOnly();
  const [size, setSize] = useState(20);
  const [regular, setRegular] = useState(false);
  if (!admin) return <div className="min-h-screen" />;
  const fa = (name: string) => (regular && FA_REGULAR[name]) || FA_SOLID[name];

  const pill = "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap px-3 py-1.5 text-sm";
  const navButtons = (useIcons: boolean) => (
    <div className="flex items-center gap-1.5">
      <span className={`${pill} border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800`}>
        {useIcons ? <Icon g={fa("bullhorn")} size={14} /> : "📢"}<span>공지</span>
      </span>
      <span className={`${pill} border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800`}>
        {useIcons ? <Icon g={fa("comment-dots")} size={14} /> : "💬"}<span>문의</span>
      </span>
      <span className={`${pill} bg-rose-600 text-white`}>{useIcons ? <Icon g={fa("mug-hot")} size={14} /> : "☕"}<span>후원</span></span>
    </div>
  );
  const tabs: [string, string, string][] = [["📚", "book", "도감"], ["🧰", "toolbox", "도구"], ["📝", "pen-to-square", "전적"], ["🎮", "gamepad", "놀이터"], ["☰", "bars", "더보기"]];
  const tabBar = (useIcons: boolean) => (
    <div className="w-full max-w-sm flex justify-around items-center h-16 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
      {tabs.map(([emoji, name, label], i) => (
        <span key={label} className={`flex flex-col items-center justify-center flex-1 h-full text-xs ${i === 0 ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-gray-500 dark:text-gray-400"}`}>
          {useIcons ? <Icon g={fa(name)} size={20} className="h-7" /> : <span className="text-xl">{emoji}</span>}
          <span className="mt-1">{label}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen w-full max-w-5xl mx-auto px-4 py-6 text-left">
      <h1 className="text-xl font-bold">아이콘 견본</h1>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-keep">
        지금 쓰는 이모지와 바꿀 수 있는 Font Awesome 무료 아이콘(7.3.1)입니다. Font Awesome에 맞는 게 없는 것은 Material Icons(MUI가 쓰는 것)와
        Material Symbols도 함께 놓았습니다. 이모지는 기기마다 그림이 다르니 휴대폰에서도 열어 보세요.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-600 dark:text-gray-300">크기</span>
        <div className="flex gap-1">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={`h-8 px-3 rounded-lg text-sm font-semibold hover:border-transparent ${s === size ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"}`}
            >
              {s}px
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={regular} onChange={(e) => setRegular(e.target.checked)} />
          외곽선형(Regular)이 있으면 그것으로
        </label>
      </div>

      <section className="mt-6">
        <h2 className="text-base font-bold">실제 자리에 넣어 보기</h2>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400">상단 버튼 · 지금</span>
            {navButtons(false)}
            <span className="text-xs text-gray-500 dark:text-gray-400">상단 버튼 · Font Awesome</span>
            {navButtons(true)}
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400">하단 탭바 · 지금</span>
            {tabBar(false)}
            <span className="text-xs text-gray-500 dark:text-gray-400">하단 탭바 · Font Awesome</span>
            {tabBar(true)}
          </div>
        </div>
      </section>

      {SECTIONS.map((s) => (
        <section key={s.title} className="mt-8">
          <h2 className="text-base font-bold">{s.title}</h2>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {s.rows.map((r) => (
              <div key={r.emoji + r.where} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-2.5">
                <Labeled label="지금">
                  <span className={CELL} style={{ fontSize: size }}>{r.emoji}</span>
                </Labeled>
                <span className="text-gray-300 dark:text-gray-600">→</span>
                {r.fa.map((n) => (
                  <Labeled key={n} label={n}>
                    <span className={CELL}><Icon g={fa(n)} size={size} /></span>
                  </Labeled>
                ))}
                <span className="ml-auto text-sm font-semibold text-gray-700 dark:text-gray-200 text-right break-keep">{r.where}</span>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="mt-8">
        <h2 className="text-base font-bold">4. Font Awesome 무료판에 딱 맞는 게 없는 것</h2>
        <div className="mt-2 flex flex-col gap-2">
          {GAPS.map((r) => {
            const tints = r.tint ?? [""];
            const group = (label: string, glyphs: [string, Glyph][]) =>
              glyphs.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{label}</span>
                  <div className="flex flex-wrap gap-3">
                    {glyphs.map(([n, g]) => (
                      <Labeled key={n} label={n}>
                        <span className={`${CELL} ${tints.length > 1 ? "w-auto px-2 gap-1" : ""}`}>
                          {tints.map((t) => <Icon key={t} g={g} size={size} className={t} />)}
                        </span>
                      </Labeled>
                    ))}
                  </div>
                </div>
              );
            return (
              <div key={r.emoji} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-wrap items-start gap-x-6 gap-y-3">
                <div className="flex items-center gap-3 w-44 shrink-0">
                  <span className={`${CELL} ${r.emoji.length > 2 ? "w-auto px-2" : ""}`} style={{ fontSize: size }}>{r.emoji}</span>
                  <span className="text-sm font-semibold break-keep">{r.where}</span>
                </div>
                {group("Font Awesome (비슷한 것)", r.fa.map((n) => [n, fa(n)]))}
                {group("Material Icons · MUI", (r.mi ?? []).map((n) => [n, MATERIAL_ICONS[n]]))}
                {group("Material Symbols", (r.sym ?? []).map((n) => [n, MATERIAL_SYMBOLS[n]]))}
                <p className="basis-full text-xs text-gray-500 dark:text-gray-400 break-keep">{r.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-8 text-[11px] text-gray-400 dark:text-gray-500 break-keep">
        Font Awesome Free 7.3.1 (아이콘 CC BY 4.0) · Material Icons, Material Symbols by Google (Apache 2.0). 이 페이지에만 그림을 복사해 두었고 패키지는 설치하지 않았습니다.
      </p>
    </div>
  );
}
