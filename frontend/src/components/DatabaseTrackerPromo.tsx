import { useState } from "react";

const DOWNLOAD_URL = "/media/tracker/mdtracker.exe";
const DISMISS_KEY = "database_tracker_promo_dismissed";

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

// Tracker promo for the deck database, the busiest page on the site.
// Deliberately API-free: /database is open to logged-out visitors, and the
// client-status endpoint (used by PcTrackerBanner) requires authentication.
// Mobile gets a one-line strip that expands in place — the tracker is Windows-only,
// so there is nothing to download there, only awareness to build.
export default function DatabaseTrackerPromo() {
  const [hidden, setHidden] = useState(readDismissed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [howtoOpen, setHowtoOpen] = useState(false);

  if (hidden) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode: just hide for this visit */
    }
    setHidden(true);
  };

  return (
    <>
      {/* Mobile: one-line strip. No negative margin — the page gutter is not a
          clean -mx-4 (px-0 and p-4 collide), and overshooting adds a scrollbar. */}
      <div className="sm:hidden mb-4">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          className="w-full px-4 py-2 bg-blue-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <span>PC 트래커로 마스터듀얼 전적 자동 기록</span>
          <span className="opacity-70">{mobileOpen ? "▲" : "▼"}</span>
        </button>

        {mobileOpen && (
          <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 text-left text-sm text-gray-700 dark:text-gray-200 space-y-1.5">
            <p>
              랭크·레이팅 게임이 끝날 때마다 <b>결과·코인·선후공·랭크·덱</b>이 자동으로 기록됩니다.
            </p>
            <p className="text-blue-700 dark:text-blue-300 font-medium">
              승리를 기록할 때마다 <b>5P</b>, 패배도 <b>1P</b>를 드립니다.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Windows 전용입니다. PC에서 ygodecks.com에 접속하면 내려받을 수 있습니다.
            </p>
            <button
              type="button"
              onClick={dismiss}
              className="text-xs text-gray-500 dark:text-gray-400 underline underline-offset-2"
            >
              다시 보지 않기
            </button>
          </div>
        )}
      </div>

      {/* Desktop: full card with the download button */}
      <div className="hidden sm:block mb-4 max-w-2xl w-full mx-auto text-left border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">
              PC 마스터듀얼 트래커{" "}
              <span className="text-xs font-normal text-blue-600 dark:text-blue-300">베타</span>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              랭크·레이팅 게임이 끝날 때마다 결과·코인·선후공·랭크·덱을 자동으로 기록합니다. Windows 전용.
            </div>
            <div className="text-sm font-medium text-blue-700 dark:text-blue-300 mt-0.5">
              트래커로 '승리'를 기록할 때마다 <b>5P</b>, 패배도 <b>1P</b>를 드립니다!!
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setHowtoOpen((v) => !v)}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {howtoOpen ? "사용법 접기" : "사용법"}
            </button>
            <a
              href={DOWNLOAD_URL}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition"
            >
              다운로드
            </a>
            <button
              type="button"
              aria-label="닫기"
              onClick={dismiss}
              className="px-2 py-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ✕
            </button>
          </div>
        </div>

        {howtoOpen && (
          <ol className="mt-3 text-sm text-gray-700 dark:text-gray-200 list-decimal pl-5 space-y-1">
            <li>
              <b>mdtracker.exe</b>를 받아 실행합니다. Windows가 "확인되지 않은 앱"이라고 막으면{" "}
              <b>추가 정보 → 실행</b>을 누르세요 (아직 코드 서명이 없어서 뜨는 안내입니다).
            </li>
            <li>ygodecks.com 계정으로 로그인하고 <b>기록할 시트</b>를 고릅니다. 창을 닫아도 트레이에서 계속 돌아갑니다.</li>
            <li>마스터듀얼은 <b>창모드 또는 테두리 없는 창모드</b>로 두세요. 전체화면이면 확인 창이 게임 위에 보이지 않습니다.</li>
            <li>
              게임이 끝나면 게임 위에 확인 창이 뜹니다. 내 덱·상대 덱이 자동으로 채워지니 맞으면 그대로, 틀리면 고쳐서{" "}
              <b>저장</b>. 10초 동안 두면 자동 저장됩니다.
            </li>
            <li>게임 메모리를 읽기만 할 뿐 게임 파일이나 동작을 바꾸지 않습니다. 랭크·레이팅 외의 모드는 기록하지 않습니다.</li>
          </ol>
        )}
      </div>
    </>
  );
}
