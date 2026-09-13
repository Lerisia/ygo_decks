import { useEffect, useRef, useState } from "react";

// 덱 스탯 정의 (특이점 작성, 2026-09-13)
export const STAT_DESCRIPTIONS: { label: string; text: string }[] = [
  { label: "안정성", text: "전체적인 초동률, 패말림, 관통력 등 자신의 플랜을 얼마나 안정적인 확률로 성공시킬 수 있는지를 나타내는 수치" },
  { label: "견제력", text: "자신의 플랜이 성공했을 경우 또는 타협 빌드를 세웠을 경우 얼마나 상대를 잘 견제할 수 있는지를 나타내는 수치" },
  { label: "돌파력", text: "공격권, 상대의 풀빌드 및 착지 빌드를 밀어내는 힘, 나아가서 밀어낸 후 게임을 굳히는 능력 및 킬 결정력을 나타내는 수치" },
  { label: "복구력", text: "게임이 장기화될 경우, 자신의 플랜을 재현할 수 있는지, 고갈되지는 않는지를 종합적으로 평가하는 수치" },
  { label: "덱 스페이스", text: "덱을 빌드할 때, 덱에 기본적으로 필요한 카드를 넣고 나서 패트랩 등의 범용 카드를 얼마나 넣을 수 있는지를 나타내는 수치" },
];

type Pos = { top: number; right: number };

/** 차트 구석의 (i) 버튼. 올리면(데스크톱) 또는 누르면(모바일) 스탯 설명이 뜬다.
 *  설명 창은 fixed 로 띄워서 카드의 overflow 에 잘리지 않고 왼쪽으로 넓게 펼쳐진다. */
export default function StatInfoButton({ className = "" }: { className?: string }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const open = pinned || hover;

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if ((document.getElementById("stat-info-popover")?.contains(t) ?? false)) return;
      setPinned(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [pinned]);

  return (
    <div className={className} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        ref={btnRef}
        type="button"
        aria-label="스탯 설명 보기"
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
        className="w-6 h-6 rounded-full border border-gray-400 dark:border-gray-500 text-gray-500 dark:text-gray-400 text-xs font-bold leading-none flex items-center justify-center bg-white/80 dark:bg-gray-900/80 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-100 transition"
      >
        i
      </button>
      {open && pos && (
        <div
          id="stat-info-popover"
          role="tooltip"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-[60] w-[min(92vw,20rem)] sm:w-[40rem] max-w-[92vw] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl p-3 sm:p-4 text-left text-xs sm:text-sm leading-relaxed"
        >
          <p className="font-bold text-sm sm:text-base text-gray-900 dark:text-gray-100 mb-2">스탯 설명</p>
          <dl className="space-y-2 sm:space-y-2.5">
            {STAT_DESCRIPTIONS.map((s) => (
              <div key={s.label} className="sm:grid sm:grid-cols-[6rem_1fr] sm:gap-3">
                <dt className="font-semibold text-gray-800 dark:text-gray-200">{s.label}</dt>
                <dd className="text-gray-600 dark:text-gray-400">{s.text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700 text-[11px] sm:text-xs text-gray-500 dark:text-gray-400">
            *해당 스탯 그래프 및 덱 파워는 개발자의 주관이 들어간 수치이며, 객관성이 결여되어 있으므로 참고용으로만 사용해 주시면 감사드리겠습니다.
          </p>
        </div>
      )}
    </div>
  );
}
