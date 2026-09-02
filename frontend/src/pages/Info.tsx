import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getLatestChangelog, type ChangelogEntry } from "@/api/changelogApi";

const features = [
  { to: "/recommend", icon: "🔍", title: "성향 테스트", desc: "나와 맞는 덱은?" },
  { to: "/database", icon: "📚", title: "덱 도감", desc: "덱 상세 정보" },
  { to: "/records", icon: "📝", title: "전적 시트", desc: "승률 및 통계 관리" },
  { to: "/playground", icon: "🎮", title: "놀이터", desc: "여러 가지 미니게임" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DISMISSED_KEY = "dismissed_changelog_id";
// YouTube promo tile: hideable per browser, and gone for everyone after this date (KST).
const PROMO_DISMISSED_KEY = "dismissed_youtube_promo";
const PROMO_UNTIL = new Date("2026-10-31T23:59:59+09:00");

function Info() {
  const navigate = useNavigate();
  const [latest, setLatest] = useState<ChangelogEntry | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [promoDismissed, setPromoDismissed] = useState(() => localStorage.getItem(PROMO_DISMISSED_KEY) === "1");
  const promoActive = !promoDismissed && new Date() <= PROMO_UNTIL;
  const handlePromoDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    setPromoDismissed(true);
  };

  useEffect(() => {
    getLatestChangelog()
      .then((d) => {
        setLatest(d.entry);
        if (d.entry) {
          setDismissed(localStorage.getItem(DISMISSED_KEY) === String(d.entry.id));
        }
      })
      .catch(() => {});
  }, []);

  const handleDismiss = () => {
    if (!latest) return;
    localStorage.setItem(DISMISSED_KEY, String(latest.id));
    setDismissed(true);
  };

  return (
    <div className="flex flex-col px-2 py-4 sm:px-6 sm:py-6 md:p-10 h-auto min-h-screen max-w-xl md:max-w-2xl mx-auto text-gray-900 dark:text-white">
      {promoActive && (
        <section className="order-2 sm:order-1 mb-4 md:mb-5">
          <a
            href="https://www.youtube.com/@MD_Elite_Duelists"
            target="_blank"
            rel="noopener noreferrer"
            className="relative block bg-pink-50 dark:bg-pink-900/20 border border-pink-100 dark:border-pink-800/40 rounded-xl shadow-sm p-4 md:p-5 pr-10 hover:bg-pink-100 dark:hover:bg-pink-900/30 transition"
          >
            <button
              type="button"
              onClick={handlePromoDismiss}
              aria-label="홍보 배너 닫기"
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-pink-100 dark:hover:bg-pink-800/30 transition"
            >
              ×
            </button>
            <div className="flex items-center gap-3 min-w-0">
              <span className="shrink-0 w-9 h-9 rounded-full bg-red-600 text-white flex items-center justify-center text-sm">▶</span>
              <p className="text-sm md:text-base font-semibold truncate">마스터 듀얼 종합 정보 확인하기</p>
            </div>
          </a>
        </section>
      )}
      {latest && !dismissed && (
        <section className="order-2 sm:order-1 mb-6 md:mb-8">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-base md:text-lg font-semibold">📢 최근 업데이트</h2>
            <Link to="/changelog" className="text-sm text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
              더 보기 →
            </Link>
          </div>
          <article className="relative bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-xl shadow-sm p-4 md:p-5">
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="공지 닫기"
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-800/30 transition"
            >
              ×
            </button>
            <header className="mb-2 pr-6">
              <h3 className="text-sm md:text-base font-semibold">{latest.title}</h3>
              <time className="text-xs md:text-sm text-gray-500">
                {formatDate(latest.published_at)}
              </time>
            </header>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{latest.body}</ReactMarkdown>
            </div>
          </article>
        </section>
      )}
      {latest && dismissed && (
        <div className="order-2 sm:order-1 mb-6 md:mb-8 flex">
          <Link
            to="/changelog"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
          >
            📢 공지사항 보러가기 →
          </Link>
        </div>
      )}

      <div className="order-1 sm:order-2 text-center mb-8 md:mb-10">
        <img src="/images/logo_big.png" alt="YGO Decks" className="h-28 sm:hidden mx-auto mb-2 dark:invert" />
        <h1 className="text-2xl md:text-4xl font-bold hidden sm:block">YGO Decks</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 md:text-lg">유희왕 마스터 듀얼 전적 관리 및 덱 추천</p>
      </div>

      <div className="order-3 grid grid-cols-2 gap-4 md:gap-6 mb-8">
        {features.map((f) => (
          <button
            key={f.to}
            onClick={() => navigate(f.to)}
            className="flex flex-col items-center justify-center px-3 py-4 md:p-8 bg-white dark:bg-gray-800 rounded-xl shadow hover:shadow-md transition text-center"
          >
            <span className="text-3xl md:text-5xl mb-2">{f.icon}</span>
            <span className="font-semibold md:text-lg">{f.title}</span>
            <span className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{f.desc}</span>
          </button>
        ))}
      </div>

      <div className="order-4 flex justify-center gap-4 text-sm md:text-base">
        <a
          href="https://open.kakao.com/o/sDIT5F2c"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 dark:text-gray-400 hover:text-blue-500 transition"
        >
          💬 문의
        </a>
        <a
          href="https://www.buymeacoffee.com/elyss"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 dark:text-gray-400 hover:text-red-500 transition"
        >
          ☕ 후원
        </a>
      </div>
    </div>
  );
}

export default Info;
