import { useState } from "react";

const DOWNLOAD_URL = "/media/tracker/mdtracker.exe";

// Desktop-only card on the record-sheet list: download + how-to for the PC Master Duel tracker.
export default function PcTrackerBanner() {
  const [open, setOpen] = useState(false);
  return (
    <div className="hidden sm:block mb-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">PC 마스터듀얼 트래커 <span className="text-xs font-normal text-blue-600 dark:text-blue-300">베타</span></div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            랭크·레이팅 게임이 끝날 때마다 결과·코인·선후공·랭크·덱을 자동으로 기록합니다. Windows 전용, 설치 불필요.
          </div>
          <div className="text-sm font-medium text-blue-700 dark:text-blue-300 mt-0.5">
            트래커로 '승리'를 기록할 때마다 <b>5P</b>, 패배도 <b>1P</b>를 드립니다!!
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {open ? "사용법 접기" : "사용법"}
          </button>
          <a
            href={DOWNLOAD_URL}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            다운로드
          </a>
        </div>
      </div>
      {open && (
        <ol className="mt-3 text-sm text-gray-700 dark:text-gray-200 list-decimal pl-5 space-y-1">
          <li>
            <b>mdtracker.exe</b>를 받아 실행합니다. Windows가 "확인되지 않은 앱"이라고 막으면 <b>추가 정보 → 실행</b>을 누르세요
            (아직 코드 서명이 없어서 뜨는 안내입니다).
          </li>
          <li>ygodecks.com 계정으로 로그인하고 <b>기록할 시트</b>를 고릅니다. 창을 닫아도 트레이에서 계속 돌아갑니다.</li>
          <li>마스터듀얼은 <b>창모드 또는 테두리 없는 창모드</b>로 두세요. 전체화면이면 확인 창이 게임 위에 보이지 않습니다.</li>
          <li>
            게임이 끝나면 게임 위에 확인 창이 뜹니다. 내 덱·상대 덱이 자동으로 채워지니 맞으면 그대로, 틀리면 고쳐서 <b>저장</b>.
            20초 동안 두면 자동 저장됩니다. 잘못 기록된 건 시트에서 언제든 수정할 수 있습니다.
          </li>
          <li>게임 메모리를 읽기만 할 뿐 게임 파일이나 동작을 바꾸지 않습니다. 랭크·레이팅 외의 모드는 기록하지 않습니다.</li>
        </ol>
      )}
    </div>
  );
}
