import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isAuthenticated } from "@/api/accountApi";
import { getRecorderStats, type RecorderStats } from "@/api/recorderApi";
import { getTrackerClientStatus, type TrackerClientStatus } from "@/api/trackerPendingApi";
import { RECORDER_DOWNLOAD_URL } from "@/lib/siteMenu";

/** /recorder on the web: what the PC recorder does, how to set it up, and the download. */
export default function PcRecorder() {
  const loggedIn = isAuthenticated();
  const [stats, setStats] = useState<RecorderStats | null>(null);
  const [status, setStatus] = useState<TrackerClientStatus | null>(null);

  useEffect(() => {
    getRecorderStats().then(setStats).catch(() => {});
    if (loggedIn) getTrackerClientStatus().then(setStatus).catch(() => {});
  }, [loggedIn]);

  const outdated = !!status?.outdated;
  const updatable = !outdated && !!status?.update_available;

  return (
    <div className="min-h-screen px-4 py-6 md:py-10 max-w-2xl mx-auto flex flex-col gap-6 text-gray-900 dark:text-white">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-bold tracking-wide text-amber-700 dark:text-amber-400">Windows PC 프로그램 · 무료</span>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">YGO Decks 레코더</h1>
        <p className="text-gray-600 dark:text-gray-300">
          마스터 듀얼을 하면 듀얼이 끝날 때마다 전적이 자동으로 기록됩니다. 손으로 적을 필요가 없습니다.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 min-h-[20px]">
          {stats && (
            <><b className="text-gray-900 dark:text-white tabular-nums">{stats.users.toLocaleString()}</b>명이{" "}
            <b className="text-gray-900 dark:text-white tabular-nums">{stats.games.toLocaleString()}</b>판을 기록했어요 · 최신 버전 {stats.version}</>
          )}
        </p>
      </header>

      {outdated && (
        <div className="rounded-xl px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 text-sm">
          쓰고 계신 버전({status?.version ?? "베타"})은 더 이상 기록되지 않습니다. 아래에서 정식 버전 {status?.latest}을 받아 바꿔 주세요.
        </div>
      )}
      {updatable && (
        <div className="rounded-xl px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm">
          새 버전 {status?.latest}이 나왔어요. 쓰고 계신 버전은 {status?.version}입니다.
        </div>
      )}

      <section className="rounded-2xl p-5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 flex flex-col gap-3">
        <a
          href={RECORDER_DOWNLOAD_URL}
          download
          className="hidden sm:block text-center py-3 rounded-lg font-extrabold bg-amber-400 hover:bg-amber-500 text-amber-950 transition"
        >
          Windows용 내려받기{stats ? ` (${stats.version})` : ""}
        </a>
        <p className="sm:hidden text-sm font-semibold">
          Windows PC용 프로그램입니다. PC에서 ygodecks.com/recorder 를 열어 내려받아 주세요.
        </p>
        <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
          레코더로 기록한 듀얼마다 승리 <b>5P</b>, 패배 <b>1P</b>를 드립니다.
        </p>
      </section>

      <section aria-labelledby="rec-does" className="flex flex-col gap-2">
        <h2 id="rec-does" className="text-lg font-bold">하는 일</h2>
        <ul className="list-disc pl-5 flex flex-col gap-1.5 text-gray-700 dark:text-gray-300">
          <li>랭크·레이팅 듀얼이 끝나면 결과, 코인, 선후공, 랭크, 덱을 전적 시트에 자동으로 저장합니다.</li>
          <li>상대가 보여 준 카드로 상대 덱을 판독해 채워 둡니다. 틀리면 저장 전에 고칠 수 있습니다.</li>
          <li>듀얼 중에는 그 상대 덱을 만났을 때의 내 전적을 보여 줍니다.</li>
        </ul>
      </section>

      <section aria-labelledby="rec-how" className="flex flex-col gap-2">
        <h2 id="rec-how" className="text-lg font-bold">쓰는 법</h2>
        <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-gray-700 dark:text-gray-300">
          <li>
            <b>YGODecksRecorder.exe</b>를 받아 실행합니다. Windows가 "확인되지 않은 앱"이라고 막으면 <b>추가 정보 → 실행</b>을 누르세요.
            아직 코드 서명이 없어서 뜨는 안내입니다.
          </li>
          <li>ygodecks.com 계정으로 로그인하고 <b>기록할 시트</b>를 고릅니다. 창을 닫아도 트레이에서 계속 돌아갑니다.</li>
          <li>마스터 듀얼은 <b>창 모드</b>나 <b>테두리 없는 창 모드</b>로 두세요. 전체 화면이면 확인 창이 게임 위에 보이지 않습니다.</li>
          <li>듀얼이 끝나면 게임 위에 확인 창이 뜹니다. 내 덱과 상대 덱이 채워져 있으니 맞으면 그대로, 틀리면 고쳐서 <b>저장</b>하세요. 10초 동안 두면 자동으로 저장됩니다.</li>
          <li>잘못 기록된 판은 <Link to="/records" className="text-blue-600 dark:text-blue-400 underline">전적 시트</Link>에서 언제든 고칠 수 있습니다.</li>
        </ol>
      </section>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        레코더는 게임 메모리를 읽기만 하고 게임 파일이나 동작은 바꾸지 않습니다. 랭크·레이팅이 아닌 듀얼은 기록하지 않습니다.
      </p>
    </div>
  );
}
