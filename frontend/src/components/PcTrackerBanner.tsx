import { useEffect, useState } from "react";
import { getTrackerClientStatus } from "@/api/trackerPendingApi";
import type { TrackerClientStatus } from "@/api/trackerPendingApi";
import { RECORDER_DOWNLOAD_URL } from "@/lib/siteMenu";

const DISMISS_KEY = "pc_tracker_banner_dismissed";

// Desktop-only card on the record pages: download + how-to for the PC Master Duel recorder, drawn as the home page's
// recorder pillar and as wide as the meta stats above it (참혈 2026-10-14).
// `dismissible` is used on the sheet detail page, where it would otherwise sit above the form every visit.
export default function PcTrackerBanner({ dismissible = false, className = "" }: { dismissible?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
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
      className={`hidden sm:block relative w-full rounded-xl pl-5 py-4 ${dismissible && !outdated ? "pr-12" : "pr-5"} bg-amber-50 dark:bg-amber-900/10 border ${outdated ? "border-red-300 dark:border-red-800" : "border-amber-200 dark:border-amber-800/50"} ${className}`}
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
      <div className="flex items-center gap-5">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className={`text-xs font-bold tracking-wide ${outdated ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            {outdated ? "베타 버전 사용 중 — 정식 버전으로 교체해 주세요" : updatable ? `새 버전 ${status?.latest} 나옴` : "정식 출시"}
          </span>
          <h2 id="pc-recorder-banner" className="text-lg md:text-xl font-extrabold tracking-tight">PC 마스터듀얼 레코더</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 break-keep">
            {outdated
              ? `쓰고 계신 버전(${status?.version ?? "베타"})은 베타 버전이라 더 이상 기록되지 않습니다. 정식 버전 ${status?.latest}로 교체해 주세요.`
              : updatable
                ? `쓰고 계신 버전은 ${status?.version}입니다. 새 버전 ${status?.latest}을 받아 바꾸면 최신 기능을 쓸 수 있어요.`
                : "랭크·레이팅 게임이 끝날 때마다 결과·코인·선후공·랭크·덱을 자동으로 기록합니다. Windows 전용."}
          </p>
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
            레코더로 '승리'를 기록할 때마다 <b>5P</b>, 패배도 <b>1P</b>를 드립니다!!
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-stretch gap-1.5">
          <a
            href={RECORDER_DOWNLOAD_URL}
            download
            className="block text-center px-6 py-3 rounded-lg font-extrabold bg-amber-400 hover:bg-amber-500 text-amber-950 transition"
          >
            {outdated ? "정식 버전 받기" : updatable ? "새 버전 받기" : "다운로드"}
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="self-center h-6 px-1 p-0 border-0 bg-transparent text-xs text-gray-500 dark:text-gray-400 underline hover:text-gray-800 dark:hover:text-gray-200"
          >
            {open ? "사용법 접기" : "사용법"}
          </button>
        </div>
      </div>
      {open && (
        <ol className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800/50 text-sm text-gray-700 dark:text-gray-200 break-keep list-decimal pl-5 space-y-1">
          <li>
            <b>YGODecksRecorder.exe</b>를 받아 실행합니다. Windows가 "확인되지 않은 앱"이라고 막으면 <b>추가 정보 → 실행</b>을 누르세요
            (아직 코드 서명이 없어서 뜨는 안내입니다).
          </li>
          <li>ygodecks.com 계정으로 로그인하고 <b>기록할 시트</b>를 고릅니다. 창을 닫아도 트레이에서 계속 돌아갑니다.</li>
          <li>마스터듀얼은 <b>창모드 또는 테두리 없는 창모드</b>로 두세요. 전체화면이면 확인 창이 게임 위에 보이지 않습니다.</li>
          <li>
            게임이 끝나면 게임 위에 확인 창이 뜹니다. 내 덱·상대 덱이 자동으로 채워지니 맞으면 그대로, 틀리면 고쳐서 <b>저장</b>.
            10초 동안 두면 자동 저장됩니다. 잘못 기록된 건 시트에서 언제든 수정할 수 있습니다.
          </li>
          <li>게임 메모리를 읽기만 할 뿐 게임 파일이나 동작을 바꾸지 않습니다. 랭크·레이팅 외의 모드는 기록하지 않습니다.</li>
        </ol>
      )}
    </section>
  );
}
