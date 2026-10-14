import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getTrackerClientStatus } from "@/api/trackerPendingApi";
import type { TrackerClientStatus } from "@/api/trackerPendingApi";
import RecorderDownload from "@/components/RecorderDownload";

const DISMISS_KEY = "pc_tracker_banner_dismissed";

// The recorder card on the record pages, drawn as the home page's recorder pillar and as wide as the meta stats above
// it (참혈 2026-10-14). Short, since the home page already tells what it does; the rest (how to set it up, how many
// points) is on /recorder behind 자세히, and the download shows on Windows only (참혈 2026-10-15).
// `dismissible` is used on the sheet detail page, where it would otherwise sit above the form every visit.
export default function PcTrackerBanner({ dismissible = false, className = "" }: { dismissible?: boolean; className?: string }) {
  const [hidden, setHidden] = useState(() => dismissible && localStorage.getItem(DISMISS_KEY) === "1");
  const [status, setStatus] = useState<TrackerClientStatus | null>(null);

  useEffect(() => {
    getTrackerClientStatus().then(setStatus).catch(() => {});
  }, []);

  const outdated = !!status?.outdated;
  const updatable = !outdated && !!status?.update_available;
  if (hidden && !outdated) return null;   // an out-of-date recorder is worth showing even if dismissed
  return (
    <section
      aria-labelledby="pc-recorder-banner"
      className={`relative w-full rounded-xl pl-5 py-4 ${dismissible && !outdated ? "pr-12" : "pr-5"} bg-amber-50 dark:bg-amber-900/10 border ${outdated ? "border-red-300 dark:border-red-800" : "border-amber-200 dark:border-amber-800/50"} ${className}`}
    >
      {dismissible && !outdated && (
        <button
          type="button"
          aria-label="닫기"
          onClick={() => { localStorage.setItem(DISMISS_KEY, "1"); setHidden(true); }}
          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center p-0 border-0 rounded-full bg-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-amber-100 dark:hover:bg-amber-900/30"
        >
          ✕
        </button>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {(outdated || updatable) && (
            <span className={`text-xs font-bold tracking-wide ${outdated ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
              {outdated ? "베타 버전 사용 중 — 정식 버전으로 교체해 주세요" : `새 버전 ${status?.latest} 나옴`}
            </span>
          )}
          <h2 id="pc-recorder-banner" className="text-lg md:text-xl font-extrabold tracking-tight">YGO Decks 레코더</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 break-keep">
            {outdated
              ? `쓰고 계신 버전(${status?.version ?? "베타"})은 베타 버전이라 더 이상 기록되지 않습니다. 정식 버전으로 교체해 주세요.`
              : updatable
                ? `쓰고 계신 버전은 ${status?.version}입니다. 새 버전을 받아 바꾸면 최신 기능을 쓸 수 있어요.`
                : "랭크·레이팅·듀얼리스트 컵 듀얼이 끝나면 전적 시트에 자동으로 저장합니다."}
          </p>
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">전적을 기록할 때마다 포인트를 드립니다!</p>
        </div>
        <div className="shrink-0 sm:w-40 flex flex-col items-stretch gap-1.5">
          <RecorderDownload />
          <span className="self-center text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            무료{status?.latest ? ` · ${status.latest}` : ""}
            <Link to="/recorder" className="ml-2 underline">자세히</Link>
          </span>
        </div>
      </div>
    </section>
  );
}
