import { useState } from "react";

// 덱 스탯 정의 (특이점 작성, 2026-09-13)
export const STAT_DESCRIPTIONS: { label: string; text: string }[] = [
  { label: "안정성", text: "전체적인 초동률, 패말림, 관통력 등 자신의 플랜을 얼마나 안정적인 확률로 성공시킬 수 있는지를 나타내는 수치" },
  { label: "견제력", text: "자신의 플랜이 성공했을 경우 또는 타협 빌드를 세웠을 경우 얼마나 상대를 잘 견제할 수 있는지를 나타내는 수치" },
  { label: "돌파력", text: "공격권, 상대의 풀빌드 및 착지 빌드를 밀어내는 힘, 나아가서 밀어낸 후 게임을 굳히는 능력 및 킬 결정력을 나타내는 수치" },
  { label: "복구력", text: "게임이 장기화될 경우, 자신의 플랜을 재현할 수 있는지, 고갈되지는 않는지를 종합적으로 평가하는 수치" },
  { label: "덱 스페이스", text: "덱을 빌드할 때, 덱에 기본적으로 필요한 카드를 넣고 나서 패트랩 등의 범용 카드를 얼마나 넣을 수 있는지를 나타내는 수치" },
];

/** 차트 구석의 (i) 버튼. 마우스를 올리거나(데스크톱) 누르면(모바일) 스탯 설명이 뜬다. */
export default function StatInfoButton({ className = "" }: { className?: string }) {
  const [pinned, setPinned] = useState(false);
  return (
    <div className={`group ${className}`}>
      <button
        type="button"
        aria-label="스탯 설명 보기"
        aria-expanded={pinned}
        onClick={() => setPinned((v) => !v)}
        onBlur={() => setPinned(false)}
        className="w-6 h-6 rounded-full border border-gray-400 dark:border-gray-500 text-gray-500 dark:text-gray-400 text-xs font-bold leading-none flex items-center justify-center bg-white/80 dark:bg-gray-900/80 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-100 transition"
      >
        i
      </button>
      <div
        role="tooltip"
        className={`absolute right-0 top-8 z-30 w-72 sm:w-80 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3 text-left text-xs leading-relaxed ${
          pinned ? "block" : "hidden group-hover:block"
        }`}
      >
        <p className="font-bold text-sm text-gray-900 dark:text-gray-100 mb-2">스탯 설명</p>
        <dl className="space-y-2">
          {STAT_DESCRIPTIONS.map((s) => (
            <div key={s.label}>
              <dt className="font-semibold text-gray-800 dark:text-gray-200">{s.label}</dt>
              <dd className="text-gray-600 dark:text-gray-400">{s.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
