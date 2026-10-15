import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getLatestChangelog, type ChangelogEntry } from "@/api/changelogApi";
import { getPopularDecks, type PopularDeck } from "@/api/deckApi";
import { getRecorderStats, type RecorderStats } from "@/api/recorderApi";
import { getPackShowcase, type PackShowcase } from "@/api/packApi";
import { CONTACT_PATH, DONATE_URL } from "@/lib/siteMenu";
import RecorderDownload, { WindowsOnly } from "@/components/RecorderDownload";
import DeckPickerModal from "@/components/DeckPickerModal";
import CardPickerModal from "@/components/CardPickerModal";
import { useDexCounts } from "@/components/DexTabs";

// Home (redesign 2026-10): the pillars, the 도감 (decks and cards), 레코더 and the 팩깡 시뮬레이터 (as big as the 도감,
// 엘리스 2026-10-13); the rest as small tiles; 문의·후원 at the bottom.

const COLLAGE = 6;   // phone shows the first 4
// How far each picture in the strip overlaps the one before it, as a share of a picture's width
// (참혈 2026-10-12: 50 was too wide, the pictures barely showed clear; 10 only softened the seams, then 20).
const BLEND = 20;
const PACK_STRIP = 8;   // phone shows the first 4, tablet 6

// A picture in a strip: it reaches back over the one before and fades in across that overlap (see the deck strip).
const blendStyle = (i: number) => (i === 0 ? { left: 0, width: `calc(100% + ${BLEND / 2}%)` } : {
  left: `-${BLEND / 2}%`,
  width: `calc(100% + ${BLEND}%)`,
  maskImage: `linear-gradient(to right, transparent, #000 ${(BLEND / (100 + BLEND)) * 100}%)`,
  WebkitMaskImage: `linear-gradient(to right, transparent, #000 ${(BLEND / (100 + BLEND)) * 100}%)`,
});
const packLink = (p: { id: number; version: number | null }) => `/packs/${p.id}${p.version ? `?v=${p.version}` : ""}`;

const tiles: { to?: string; title: string; desc: string; soon?: boolean }[] = [
  { to: "/records", title: "전적 시트", desc: "메타 통계·내 전적" },
  { to: "/playground", title: "놀이터", desc: "퀴즈·미니게임" },
  { to: "/tier-list-maker", title: "티어표 만들기", desc: "만들고 이미지로" },
  { to: "/deck-scanner", title: "AI 덱 스캔", desc: "사진으로 덱 알아보기" },
  { to: "/icon-shop", title: "포인트 상점", desc: "포인트로 아이콘·프레임 사기" },
  { title: "대회", desc: "준비 중", soon: true },
];

const DISMISSED_KEY = "dismissed_changelog_id";
// The notice last fetched, shown at once on the next visit so the page does not drop down when it arrives.
const LATEST_KEY = "home_latest_notice";
type Notice = Pick<ChangelogEntry, "id" | "title" | "kind">;
const cachedNotice = (): Notice | null => {
  try {
    return JSON.parse(localStorage.getItem(LATEST_KEY) || "null");
  } catch {
    return null;
  }
};

function Info() {
  const navigate = useNavigate();
  const [latest, setLatest] = useState<Notice | null>(cachedNotice);
  const [dismissed, setDismissed] = useState(() => latest !== null && localStorage.getItem(DISMISSED_KEY) === String(latest.id));
  const [popular, setPopular] = useState<{ total: number; decks: PopularDeck[] } | null>(null);
  const [rec, setRec] = useState<RecorderStats | null>(null);
  const [show, setShow] = useState<PackShowcase | null>(null);
  const counts = useDexCounts();
  const [picker, setPicker] = useState<"deck" | "card" | null>(null);
  // Desktop opens the search out in place; phones keep the modal (특이점 2026-10-08). Cards search the same way (엘리스 2026-10-11).
  const [searchInline, setSearchInline] = useState<"deck" | "card" | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  // The desktop search is a dropdown: a click anywhere outside it closes it.
  useEffect(() => {
    if (!searchInline) return;
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchInline(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [searchInline]);
  const openSearch = (kind: "deck" | "card") => {
    if (window.matchMedia("(min-width: 768px)").matches) setSearchInline(kind);
    else setPicker(kind);
  };

  useEffect(() => {
    getLatestChangelog()
      .then((d) => {
        const notice = d.entry && { id: d.entry.id, title: d.entry.title, kind: d.entry.kind };
        setLatest(notice);
        if (notice) {
          localStorage.setItem(LATEST_KEY, JSON.stringify(notice));
          setDismissed(localStorage.getItem(DISMISSED_KEY) === String(notice.id));
        } else {
          localStorage.removeItem(LATEST_KEY);
        }
      })
      .catch(() => {});
    getPopularDecks(COLLAGE).then(setPopular).catch(() => setPopular({ total: 0, decks: [] }));
    getRecorderStats().then(setRec).catch(() => {});
    getPackShowcase().then(setShow).catch(() => setShow({ count: 0, packs: [] }));
  }, []);

  const handleDismiss = () => {
    if (!latest) return;
    localStorage.setItem(DISMISSED_KEY, String(latest.id));
    setDismissed(true);
  };

  const decks = popular?.decks ?? [];

  return (
    <div className="min-h-screen px-4 pt-6 pb-5 md:pb-8 max-w-lg md:max-w-3xl lg:max-w-6xl mx-auto flex flex-col gap-4 md:gap-5 text-gray-900 dark:text-white">
      <h1 className="sr-only">YGO Decks · 유희왕 마스터 듀얼 덱 도감과 전적 기록</h1>
      <DeckPickerModal open={picker === "deck"} onClose={() => setPicker(null)} onPick={(id) => navigate(`/database/${id}`)} />
      <CardPickerModal open={picker === "card"} onClose={() => setPicker(null)} onPick={(id) => navigate(`/cards/${id}`)} />

      {/* The latest notice leads the page (특이점 2026-10-13; it sat under the pillars). */}
      {latest && !dismissed && (
        <div
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm ${
            latest.kind === "deck"
              ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50"
              : "bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/40"
          }`}
        >
          <Link to="/changelog" className="flex-1 min-w-0 truncate hover:underline">
            {latest.kind === "deck" ? "📦" : "📢"} <b>{latest.title}</b>
          </Link>
          <button type="button" onClick={handleDismiss} aria-label="공지 닫기" className="shrink-0 w-6 h-6 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-800/30">×</button>
        </div>
      )}

      <div className="grid gap-4 md:gap-5 lg:grid-cols-[2fr_1fr]">
        {/* Pillar 1: the deck book */}
        {/* Only the picture strip clips to the rounded corner, so the search dropdown can hang past the card. */}
        <section aria-labelledby="home-dex" className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          {/* The pictures fade out through a mask rather than under a white overlay: on fractional-scale screens (Galaxy Fold:
              2.2x, 2.625x) an overlay left the pictures' edge pixels and the row past their bottom showing as thin coloured
              lines (특이점 2026-10-07, 10-09). A mask fades those pixels with everything else. */}
          <div className="home-collage-fade relative grid grid-cols-4 md:grid-cols-6 h-28 md:h-40 rounded-t-[15px] overflow-hidden bg-gray-200 dark:bg-gray-700">
            {Array.from({ length: COLLAGE }, (_, i) => {
              const d = decks[i];
              const cls = `${i >= 4 ? "hidden md:block" : ""} relative w-full h-full`;
              // Each picture reaches back over the one before and fades in across that overlap, which stays solid
              // beneath it, so one picture turns into the next instead of meeting it at a hard edge (참혈 2026-10-12).
              return d ? (
                <div key={d.id} className={cls} style={{ zIndex: i }}>
                  <img
                    src={d.cover_image_phone || d.cover_image}
                    alt=""
                    className="absolute top-0 h-full max-w-none object-cover"
                    style={blendStyle(i)}
                  />
                </div>
              ) : (
                <div key={i} className={`${cls} ${popular ? "" : "animate-pulse"} bg-gray-200 dark:bg-gray-700`} />
              );
            })}
          </div>
          <div className="relative -mt-7 md:-mt-9 px-4 md:px-6 pb-5 flex flex-col gap-3">
            <span className="text-xs font-bold tracking-wide text-blue-600 dark:text-blue-400">도감</span>
            {/* 17px on phones keeps the line whole down to 360px-wide screens (특이점 2026-10-07). */}
            <h2 id="home-dex" className="text-[17px] leading-6 sm:text-2xl md:text-3xl font-extrabold tracking-tight">
              덱{" "}
              {counts ? <span className="tabular-nums">{counts.decks.toLocaleString()}</span> : <span className="inline-block w-10 h-6 align-middle rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />}
              개, 카드{" "}
              {counts ? <span className="tabular-nums">{counts.cards.toLocaleString()}</span> : <span className="inline-block w-14 h-6 align-middle rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />}
              장을 한 곳에서.
            </h2>
            {/* Opens a picker of real decks or cards: choosing one goes straight to its page, so no search can miss.
                On desktop it drops down over the page from the search box instead of growing the card (참혈 2026-10-10). */}
            <div ref={searchRef} className="relative grid grid-cols-2 gap-2">
              {([["deck", "덱 이름으로 찾기", "덱 찾기"], ["card", "카드 이름으로 찾기", "카드 찾기"]] as const).map(([kind, label, short]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => openSearch(kind)}
                  aria-expanded={searchInline === kind}
                  className="flex items-center gap-2 w-full text-left border rounded-lg px-3 py-2.5 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-400 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                >
                  <span aria-hidden="true">🔍</span>
                  <span className="flex-1 whitespace-nowrap"><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></span>
                </button>
              ))}
              {searchInline && (
                <div className="absolute inset-x-0 top-0 z-30 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 p-3 shadow-xl">
                  {searchInline === "deck" ? (
                    <DeckPickerModal inline open onClose={() => setSearchInline(null)} onPick={(id) => navigate(`/database/${id}`)} />
                  ) : (
                    <CardPickerModal inline open onClose={() => setSearchInline(null)} onPick={(id) => navigate(`/cards/${id}`)} />
                  )}
                </div>
              )}
            </div>
            {/* One line on any screen (엘리스 2026-10-12): the row is one chip tall and wraps, so a deck that does not
                fit whole drops out of sight instead of starting a second line. */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-4 text-[13px] sm:text-sm h-6 md:h-7 overflow-hidden">
              <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mr-0.5 md:mr-1">많이 보는 덱</span>
              {decks.slice(0, 5).map((d, i) => (
                <Link
                  key={d.id}
                  to={`/database/${d.id}`}
                  className={`${i >= 3 ? "hidden md:inline-flex" : "inline-flex"} items-center gap-1 md:gap-1.5 pl-0.5 md:pl-1 pr-2 md:pr-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 font-semibold whitespace-nowrap transition`}
                >
                  <img src={d.cover_image_phone || d.cover_image} alt="" className="w-5 h-5 md:w-6 md:h-6 rounded-full object-cover" />
                  {d.name}
                </Link>
              ))}
            </div>
            <Link
              to="/recommend"
              className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-dashed border-blue-400 dark:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
            >
              <span className="text-sm break-keep">어떤 덱을 할지 모르겠다면</span>
              <span className="text-sm font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">덱 성향 테스트 →</span>
            </Link>
          </div>
        </section>

        {/* Pillar 2: the recorder */}
        {/* Shown everywhere for the pitch, the download on Windows only (참혈 2026-10-15; phones skipped it from 특이점 10/08). */}
        <section aria-labelledby="home-rec" className="flex rounded-2xl p-5 md:p-6 flex-col gap-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50">
          <span className="text-xs font-bold tracking-wide text-amber-700 dark:text-amber-400">YGO Decks 레코더 · PC</span>
          <h2 id="home-rec" className="text-xl md:text-2xl font-extrabold tracking-tight">게임만 하세요. 전적은 저절로 쌓입니다<WindowsOnly /></h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 min-h-[20px]">
            {rec ? (
              <><b className="text-gray-900 dark:text-white tabular-nums">{rec.users.toLocaleString()}</b>명이 <b className="text-gray-900 dark:text-white tabular-nums">{rec.games.toLocaleString()}</b>판을 기록했어요</>
            ) : (
              <span className="inline-block w-48 h-4 rounded bg-amber-100 dark:bg-amber-900/30 animate-pulse align-middle" />
            )}
          </p>
          <ul className="text-sm text-gray-700 dark:text-gray-300 flex flex-col gap-1 list-disc pl-5">
            <li>듀얼이 끝나면 전적 시트에 자동으로 저장</li>
            <li>상대가 보여 준 카드로 상대 덱을 판독</li>
            <li>듀얼 중에 그 덱 상대 내 전적을 보여 줌</li>
          </ul>
          <div className="mt-auto pt-1 flex items-center gap-3">
            <RecorderDownload className="flex-1" />
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              무료{rec ? ` · ${rec.version}` : ""}
              <Link to="/recorder" className="ml-2 underline">자세히</Link>
            </span>
          </div>
        </section>

        {/* Pillar 3: the pack simulator, built as the deck book is (엘리스 2026-10-13: "크게 넣고 싶어요 도감처럼") */}
        <section aria-labelledby="home-packs" className="lg:col-span-2 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <Link to="/packs" tabIndex={-1} aria-hidden="true" className="home-collage-fade relative grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 h-28 md:h-40 rounded-t-[15px] overflow-hidden bg-gray-200 dark:bg-gray-700">
            {Array.from({ length: PACK_STRIP }, (_, i) => {
              const p = show?.packs[i];
              const cls = `${i >= 6 ? "hidden lg:block" : i >= 4 ? "hidden md:block" : ""} relative w-full h-full`;
              return p ? (
                <div key={`${p.id}-${p.version ?? 0}`} className={cls} style={{ zIndex: i }}>
                  {/* the pack's picture above its logo */}
                  <img src={p.image} alt="" className="absolute top-0 h-full max-w-none object-cover object-[50%_22%]" style={blendStyle(i)} />
                </div>
              ) : (
                <div key={i} className={`${cls} ${show ? "" : "animate-pulse"} bg-gray-200 dark:bg-gray-700`} />
              );
            })}
          </Link>
          <div className="relative -mt-7 md:-mt-9 px-4 md:px-6 pb-5 flex flex-col gap-3">
            <span className="text-xs font-bold tracking-wide text-violet-600 dark:text-violet-400">팩깡 시뮬레이터 · 베타</span>
            {/* 엘리스 2026-10-13 picked the line */}
            <h2 id="home-packs" className="text-[17px] leading-6 sm:text-2xl md:text-3xl font-extrabold tracking-tight break-keep">
              마스터 듀얼의 모든 팩을 뽑아 보세요!
            </h2>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-4 text-[13px] sm:text-sm h-6 md:h-7 overflow-hidden">
              <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mr-0.5 md:mr-1">새로 나온 팩</span>
              {(show?.packs ?? []).slice(0, 5).map((p, i) => (
                <Link
                  key={`${p.id}-${p.version ?? 0}`}
                  to={packLink(p)}
                  className={`${i >= 3 ? "hidden md:inline-flex" : "inline-flex"} items-center gap-1 md:gap-1.5 pl-0.5 md:pl-1 pr-2 md:pr-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 font-semibold whitespace-nowrap transition`}
                >
                  <img src={p.image} alt="" className="w-5 h-5 md:w-6 md:h-6 rounded-full object-cover object-[50%_22%]" />
                  {p.name}
                </Link>
              ))}
            </div>
            <Link
              to="/packs"
              className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-dashed border-violet-400 dark:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition"
            >
              <span className="text-sm break-keep">젬도 로그인도 필요 없어요</span>
              <span className="text-sm font-bold text-violet-600 dark:text-violet-400 whitespace-nowrap">팩 열러 가기 →</span>
            </Link>
          </div>
        </section>
      </div>

      <section aria-labelledby="home-more">
        <div className="flex items-baseline justify-between mb-2">
          <h2 id="home-more" className="text-base md:text-lg font-bold">더 둘러보기</h2>
          <Link to="/all" className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600">더보기 →</Link>
        </div>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
          {tiles.map((t) =>
            t.soon ? (
              <div key={t.title} className="p-3 md:p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex flex-col gap-1 min-h-[76px] text-gray-400 dark:text-gray-500">
                <span className="self-start text-[10px] font-bold px-1.5 rounded-full bg-gray-100 dark:bg-gray-700">준비 중</span>
                <b className="text-sm md:text-base">{t.title}</b>
              </div>
            ) : (
              <Link key={t.title} to={t.to!} className="p-3 md:p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition flex flex-col gap-1 min-h-[76px]">
                <b className="text-sm md:text-base">{t.title}</b>
                <span className="text-xs text-gray-500 dark:text-gray-400">{t.desc}</span>
              </Link>
            ),
          )}
        </div>
      </section>

      <section aria-labelledby="home-support" className="rounded-2xl p-4 md:p-6 bg-gray-100 dark:bg-gray-800/60 flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
        <div className="flex-1">
          <h2 id="home-support" className="text-base md:text-lg font-extrabold">YGO Decks는 작은 팀이 만들고 운영합니다</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">버그나 제안은 문의 게시판에 남겨 주세요. 서버비는 후원으로 함께해 주시면 큰 힘이 됩니다.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:w-80">
          <Link to={CONTACT_PATH} className="py-3 text-center rounded-lg font-semibold border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-400 transition">
            💬 문의하기
          </Link>
          <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" className="py-3 text-center rounded-lg font-semibold bg-rose-600 hover:bg-rose-700 text-white transition">
            ☕ 후원하기
          </a>
        </div>
      </section>
    </div>
  );
}

export default Info;
