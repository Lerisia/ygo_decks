import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getLatestChangelog, type ChangelogEntry } from "@/api/changelogApi";
import { getPopularDecks, type PopularDeck } from "@/api/deckApi";
import { getRecorderStats, type RecorderStats } from "@/api/recorderApi";
import { CONTACT_URL, DONATE_URL, RECORDER_DOWNLOAD_URL } from "@/lib/siteMenu";
import DeckPickerModal from "@/components/DeckPickerModal";

// Home (redesign 2026-10): two pillars, 덱 도감 then 레코더; the rest as small tiles; 문의·후원 at the bottom.

const COLLAGE = 6;   // phone shows the first 4

const tiles: { to?: string; title: string; desc: string; soon?: boolean }[] = [
  { to: "/records", title: "전적 시트", desc: "메타 통계·내 전적" },
  { to: "/playground", title: "놀이터", desc: "퀴즈·미니게임" },
  { to: "/tier-list-maker", title: "티어표 만들기", desc: "만들고 이미지로" },
  { to: "/deck-scanner", title: "AI 덱 스캔", desc: "사진으로 덱 알아보기" },
  { to: "/icon-shop", title: "아이콘 샵", desc: "포인트로 아이콘 사기" },
  { title: "대회", desc: "준비 중", soon: true },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DISMISSED_KEY = "dismissed_changelog_id";

function Info() {
  const navigate = useNavigate();
  const [latest, setLatest] = useState<ChangelogEntry | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [popular, setPopular] = useState<{ total: number; decks: PopularDeck[] } | null>(null);
  const [rec, setRec] = useState<RecorderStats | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    getLatestChangelog()
      .then((d) => {
        setLatest(d.entry);
        if (d.entry) setDismissed(localStorage.getItem(DISMISSED_KEY) === String(d.entry.id));
      })
      .catch(() => {});
    getPopularDecks(COLLAGE).then(setPopular).catch(() => setPopular({ total: 0, decks: [] }));
    getRecorderStats().then(setRec).catch(() => {});
  }, []);

  const handleDismiss = () => {
    if (!latest) return;
    localStorage.setItem(DISMISSED_KEY, String(latest.id));
    setDismissed(true);
  };

  const decks = popular?.decks ?? [];

  return (
    <div className="min-h-screen px-4 py-5 md:py-8 max-w-lg md:max-w-3xl lg:max-w-6xl mx-auto flex flex-col gap-4 md:gap-5 text-gray-900 dark:text-white">
      <h1 className="sr-only">YGO Decks · 유희왕 마스터 듀얼 덱 도감과 전적 기록</h1>
      <DeckPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(id) => navigate(`/database/${id}`)} />

      <div className="grid gap-4 md:gap-5 lg:grid-cols-[2fr_1fr]">
        {/* Pillar 1: the deck book */}
        <section aria-labelledby="home-dex" className="rounded-2xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <div className="relative grid grid-cols-4 md:grid-cols-6 h-28 md:h-40 bg-gray-200 dark:bg-gray-700">
            {Array.from({ length: COLLAGE }, (_, i) => {
              const d = decks[i];
              const cls = `${i >= 4 ? "hidden md:block" : ""} w-full h-full`;
              return d ? (
                <img key={d.id} src={d.cover_image} alt="" className={`${cls} object-cover`} />
              ) : (
                <div key={i} className={`${cls} ${popular ? "" : "animate-pulse"} bg-gray-200 dark:bg-gray-700`} />
              );
            })}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/70 to-white dark:via-gray-800/70 dark:to-gray-800" />
          </div>
          <div className="relative -mt-7 md:-mt-9 px-4 md:px-6 pb-5 flex flex-col gap-3">
            <span className="text-xs font-bold tracking-wide text-blue-600 dark:text-blue-400">덱 도감</span>
            <h2 id="home-dex" className="text-xl md:text-3xl font-extrabold tracking-tight">
              마스터 듀얼 덱{" "}
              {popular ? <span className="tabular-nums">{popular.total || ""}</span> : <span className="inline-block w-10 h-6 align-middle rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />}
              개, 한곳에서
            </h2>
            {/* Opens a picker of real decks: choosing one goes straight to its page, so no search can miss. */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 w-full text-left border rounded-lg px-3 py-2.5 bg-white dark:bg-gray-900 dark:border-gray-600 text-gray-400 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            >
              <span aria-hidden="true">🔍</span>
              <span className="flex-1">덱 이름으로 찾기</span>
              <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">목록에서 고르기</span>
            </button>
            <div className="flex flex-wrap items-center gap-1.5 text-sm min-h-[30px]">
              <span className="text-gray-500 dark:text-gray-400 mr-1">많이 보는 덱</span>
              {decks.slice(0, 5).map((d, i) => (
                <Link
                  key={d.id}
                  to={`/database/${d.id}`}
                  className={`${i >= 3 ? "hidden md:inline-flex" : "inline-flex"} items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 font-semibold transition`}
                >
                  <img src={d.cover_image} alt="" className="w-6 h-6 rounded-full object-cover" />
                  {d.name}
                </Link>
              ))}
            </div>
            <Link
              to="/recommend"
              className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-dashed border-blue-400 dark:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
            >
              <span className="text-sm">어떤 덱을 할지 모르겠다면</span>
              <span className="text-sm font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">덱 성향 테스트 →</span>
            </Link>
          </div>
        </section>

        {/* Pillar 2: the recorder */}
        <section aria-labelledby="home-rec" className="rounded-2xl p-5 md:p-6 flex flex-col gap-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50">
          <span className="text-xs font-bold tracking-wide text-amber-700 dark:text-amber-400">YGO Decks 레코더 · PC</span>
          <h2 id="home-rec" className="text-xl md:text-2xl font-extrabold tracking-tight">게임만 하세요. 전적은 저절로 쌓입니다</h2>
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
            <a
              href={RECORDER_DOWNLOAD_URL}
              download
              className="hidden sm:block flex-1 text-center py-3 rounded-lg font-extrabold bg-amber-400 hover:bg-amber-500 text-amber-950 transition"
            >
              Windows용 내려받기
            </a>
            <Link
              to="/recorder"
              className="sm:hidden flex-1 text-center py-3 rounded-lg font-extrabold bg-amber-400 hover:bg-amber-500 text-amber-950 transition"
            >
              레코더 알아보기
            </Link>
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              무료{rec ? ` · ${rec.version}` : ""}
              <Link to="/recorder" className="hidden sm:inline ml-2 underline">자세히</Link>
            </span>
          </div>
          <p className="sm:hidden text-xs text-gray-500 dark:text-gray-400">Windows PC용 프로그램이라 PC에서 받아 주세요.</p>
        </section>
      </div>

      {latest && !dismissed && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 text-sm">
          <Link to="/changelog" className="flex-1 min-w-0 truncate hover:underline">
            📢 <b>{latest.title}</b> <span className="text-gray-500">· {formatDate(latest.published_at)}</span>
          </Link>
          <button type="button" onClick={handleDismiss} aria-label="공지 닫기" className="shrink-0 w-6 h-6 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-800/30">×</button>
        </div>
      )}

      <section aria-labelledby="home-more">
        <div className="flex items-baseline justify-between mb-2">
          <h2 id="home-more" className="text-base md:text-lg font-bold">더 둘러보기</h2>
          <Link to="/all" className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600">전체 메뉴 →</Link>
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">버그나 제안은 오픈채팅으로 알려 주세요. 서버비는 후원으로 함께해 주시면 큰 힘이 됩니다.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:w-80">
          <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" className="py-3 text-center rounded-lg font-semibold border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-400 transition">
            💬 문의하기
          </a>
          <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" className="py-3 text-center rounded-lg font-semibold bg-rose-600 hover:bg-rose-700 text-white transition">
            ☕ 후원하기
          </a>
        </div>
      </section>
    </div>
  );
}

export default Info;
