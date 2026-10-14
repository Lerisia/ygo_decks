import { useState } from "react";
import { Link } from "react-router-dom";
import { RECORDER_DOWNLOAD_URL } from "@/lib/siteMenu";
import { isWindows } from "@/lib/platform";

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
// Phones get nothing: the recorder is Windows-only (특이점 2026-10-08).
// Worded as the record pages' recorder card, the download on Windows only, the rest on /recorder (참혈 2026-10-15).
export default function DatabaseTrackerPromo() {
  const [hidden, setHidden] = useState(readDismissed);

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
    <div className="hidden sm:block mb-4 max-w-2xl w-full mx-auto text-left border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">
            YGO Decks 레코더 <span className="text-xs font-normal text-blue-600 dark:text-blue-300">무료</span>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            랭크·레이팅·듀얼리스트 컵 듀얼이 끝나면 전적 시트에 자동으로 저장합니다.
          </div>
          <div className="text-sm font-medium text-blue-700 dark:text-blue-300 mt-0.5">전적을 기록할 때마다 포인트를 드립니다!</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/recorder"
            className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            자세히
          </Link>
          {isWindows() && (
            <a
              href={RECORDER_DOWNLOAD_URL}
              download
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition"
            >
              다운로드
            </a>
          )}
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
    </div>
  );
}
