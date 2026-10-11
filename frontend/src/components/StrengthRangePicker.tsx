import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { STRENGTH_TIERS, countInRange, moveHandle, pickHandle } from "../utils/recommendFlow";

const LAST = STRENGTH_TIERS.length - 1;
const pct = (step: number) => `${(step / LAST) * 100}%`;

// Deck power as a bar (특이점 2026-10-11): stronger to the left, two points mark the tiers the result may come from.
// "한 단계만" leaves a single point. Each tier label shows whether any candidate is left there.
export default function StrengthRangePicker({
  question,
  tierCounts,
  onConfirm,
}: {
  question: string;
  tierCounts: number[] | null;
  onConfirm: (lo: number, hi: number) => void;
}) {
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(LAST);
  const [single, setSingle] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  // "either": both points sit on the pressed tier, so the first move decides which one follows
  const dragging = useRef<"lo" | "hi" | "either" | null>(null);

  const stepAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * LAST);
  };
  const place = (handle: "lo" | "hi", step: number) => {
    if (single) {
      setLo(step);
      setHi(step);
      return;
    }
    const [nlo, nhi] = moveHandle(handle, step, lo, hi);
    setLo(nlo);
    setHi(nhi);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const step = stepAt(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!single && lo === hi && step === lo) {
      dragging.current = "either";
      return;
    }
    dragging.current = pickHandle(step, lo, hi);
    place(dragging.current, step);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const step = stepAt(e.clientX);
    if (dragging.current === "either") {
      if (step === lo) return;
      dragging.current = step < lo ? "lo" : "hi";
    }
    place(dragging.current, step);
  };
  const onPointerUp = () => {
    dragging.current = null;
  };
  const onKey = (handle: "lo" | "hi") => (e: KeyboardEvent<HTMLSpanElement>) => {
    const delta = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const from = handle === "lo" ? lo : hi;
    place(handle, Math.min(LAST, Math.max(0, from + delta)));
  };
  const toggleSingle = () => {
    if (!single) setHi(lo);
    setSingle(!single);
  };

  const count = tierCounts ? countInRange(tierCounts, lo, hi) : null;
  const whole = lo === 0 && hi === LAST;
  const rangeLabel = lo === hi ? STRENGTH_TIERS[lo] : `${STRENGTH_TIERS[lo]} ~ ${STRENGTH_TIERS[hi]}`;

  const handle = (which: "lo" | "hi", step: number) => (
    <span
      role="slider"
      tabIndex={0}
      aria-label={single ? "덱 파워" : which === "lo" ? "가장 강한 쪽" : "가장 약한 쪽"}
      aria-valuemin={0}
      aria-valuemax={LAST}
      aria-valuenow={step}
      aria-valuetext={STRENGTH_TIERS[step]}
      onKeyDown={onKey(which)}
      className="absolute top-1/2 w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-[3px] border-blue-600 shadow-md cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      style={{ left: pct(step), zIndex: which === "lo" && lo === LAST ? 3 : 2 }}
    />
  );

  return (
    <div className="mb-6 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{question}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 break-keep">
        {single ? "점을 움직여 원하는 덱 파워를 고르세요." : "두 점을 움직여 원하는 덱 파워의 범위를 정하세요."} 왼쪽일수록 강한 덱입니다.
      </p>

      <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-2 pt-4 pb-3">
        {/* The track spans the centres of the six label columns, so each point sits right over its label. */}
        <div
          className="relative h-10 mx-[8.333%] touch-none select-none cursor-pointer"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div ref={trackRef} className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-300 dark:bg-gray-600" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-600"
            style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }}
          />
          {STRENGTH_TIERS.map((_, i) => (
            <span
              key={i}
              className={`absolute top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${i >= lo && i <= hi ? "bg-blue-600" : "bg-gray-400 dark:bg-gray-500"}`}
              style={{ left: pct(i) }}
            />
          ))}
          {handle("lo", lo)}
          {!single && handle("hi", hi)}
        </div>
        <div className="grid grid-cols-6 mt-1 text-center text-xs sm:text-sm break-keep">
          {STRENGTH_TIERS.map((label, i) => {
            const inRange = i >= lo && i <= hi;
            const empty = tierCounts ? tierCounts[i] === 0 : false;
            return (
              <span
                key={label}
                className={`${inRange ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-gray-500 dark:text-gray-400"} ${empty ? "opacity-40" : ""}`}
                title={empty ? "남은 덱 없음" : undefined}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer select-none">
          <input type="checkbox" checked={single} onChange={toggleSingle} className="w-4 h-4 accent-blue-600" />
          한 단계만 고르기
        </label>
        <p className="text-sm text-right break-keep">
          <span className="font-semibold text-gray-900 dark:text-white">{whole ? "전체 (상관 없음)" : rangeLabel}</span>
          {count !== null && (
            <span className={count === 0 ? "text-red-500 ml-1.5" : "text-gray-500 dark:text-gray-400 ml-1.5"}>
              {count === 0 ? "· 남은 덱 없음" : `· 덱 ${count.toLocaleString()}개`}
            </span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onConfirm(lo, hi)}
        disabled={count === 0}
        className={`w-full py-2.5 rounded-lg font-semibold transition ${
          count === 0
            ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 text-white"
        }`}
      >
        다음
      </button>
    </div>
  );
}
