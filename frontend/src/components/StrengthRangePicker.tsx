import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { STRENGTH_TIERS, countInRange, moveHandle, pickHandle } from "../utils/recommendFlow";

const LAST = STRENGTH_TIERS.length - 1;
const pct = (step: number) => `${(step / LAST) * 100}%`;

// The tiers from 중하위 down carry a band marking them 입문자 비추천, always shown (특이점 2026-10-15).
const NOT_FOR_NEWCOMERS = 3;

// What each tier means, shown under the bar for the tier under the cursor or the one just chosen (특이점 2026-10-11).
const TIER_NOTES = [
  "현재 기준으로 마스터 듀얼에서 맹활약중인, 가장 강력한 최상위 티어 덱",
  "티어 덱만큼은 아니지만, 분명한 강점이 존재해 티어 게임에서 고를 가치가 있는 덱",
  "티어 게임에서는 다소 사용하기 힘들지만, 강점이 뚜렷하고 준수한 성능을 보여주는 덱",
  "체급이 다소 부족하지만, 무난하고 자신만의 개성이 존재하는 덱",
  "덱 파워가 약하여 개인적인 애정이 없다면 플레이하기 어려운 덱",
  "사용에 도전 정신이 필요할 정도로 매우 약한 덱",
];

// Deck power as a bar (특이점 2026-10-11): stronger to the left, two points mark the tiers the result may come from;
// both on one tier picks just that tier. Each tier label shows whether any candidate is left there.
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
  const [hovered, setHovered] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // "either": both points sit on the pressed tier, so the first move decides which one follows
  const dragging = useRef<"lo" | "hi" | "either" | null>(null);

  const stepAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * LAST);
  };
  const place = (handle: "lo" | "hi", step: number) => {
    setChosen(step);
    const [nlo, nhi] = moveHandle(handle, step, lo, hi);
    setLo(nlo);
    setHi(nhi);
  };

  const press = (step: number) => {
    if (lo === hi && step === lo) {
      setChosen(step);
      return "either" as const;
    }
    const which = pickHandle(step, lo, hi);
    place(which, step);
    return which;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setHovered(null); // while a point is held, the note follows it, not the tier hovered before
    dragging.current = press(stepAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) {
      if (e.pointerType === "mouse") setHovered(stepAt(e.clientX));
      return;
    }
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

  const count = tierCounts ? countInRange(tierCounts, lo, hi) : null;
  const note = hovered ?? chosen;

  // The note fades out, changes, and fades back in, so sweeping across the bar doesn't flicker through every tier.
  const [shownNote, setShownNote] = useState(note);
  const [noteVisible, setNoteVisible] = useState(true);
  useEffect(() => {
    if (note === shownNote) {
      setNoteVisible(true);
      return;
    }
    setNoteVisible(false);
    const timer = setTimeout(() => {
      setShownNote(note);
      setNoteVisible(true);
    }, 180);
    return () => clearTimeout(timer);
  }, [note, shownNote]);
  const whole = lo === 0 && hi === LAST;
  const rangeLabel = lo === hi ? STRENGTH_TIERS[lo] : `${STRENGTH_TIERS[lo]} ~ ${STRENGTH_TIERS[hi]}`;

  const handle = (which: "lo" | "hi", step: number) => (
    <span
      role="slider"
      tabIndex={0}
      aria-label={which === "lo" ? "가장 강한 쪽" : "가장 약한 쪽"}
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
        두 점을 움직여 원하는 덱 파워의 범위를 정하세요. 왼쪽일수록 강한 덱이고, 두 점을 겹치면 그 단계만 고릅니다.
      </p>

      <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-2 pt-4 pb-2">
        <div className="relative">
          {/* behind the bar and the labels, the columns of the tiers not for newcomers, named at the band's top */}
          <div
            className="pointer-events-none absolute -top-3 bottom-0 right-0 rounded-lg bg-orange-500/10 dark:bg-orange-400/10"
            style={{ left: `${(NOT_FOR_NEWCOMERS / STRENGTH_TIERS.length) * 100}%` }}
          >
            <span className="absolute inset-x-0 top-0.5 text-center text-[10px] sm:text-[11px] leading-3 font-semibold text-orange-600 dark:text-orange-300">
              입문자 비추천
            </span>
          </div>
          {/* The track spans the centres of the six label columns, so each point sits right over its label. */}
          <div
            className="relative h-10 mx-[8.333%] touch-none select-none cursor-pointer"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHovered(null)}
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
            {handle("hi", hi)}
          </div>
          <div className="grid grid-cols-6 mt-1 text-center text-xs sm:text-sm break-keep">
            {STRENGTH_TIERS.map((label, i) => {
              const inRange = i >= lo && i <= hi;
              const empty = tierCounts ? tierCounts[i] === 0 : false;
              return (
                <span
                  key={label}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => press(i)}
                  className={`cursor-pointer ${inRange ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-gray-500 dark:text-gray-400"} ${empty ? "opacity-40" : ""}`}
                  title={empty ? "남은 덱 없음" : undefined}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>
        {/* Room for the longest note — two lines on a phone, one on a wider screen — so nothing moves as notes change. */}
        <p className="mt-2 px-1 min-h-[2.5rem] sm:min-h-[1.25rem] text-xs leading-5 break-keep text-gray-600 dark:text-gray-300" aria-live="polite">
          <span className={`transition-opacity duration-200 motion-reduce:transition-none ${noteVisible ? "opacity-100" : "opacity-0"}`}>
            {shownNote !== null ? (
              <>
                <span className="font-semibold text-gray-900 dark:text-white mr-1.5">{STRENGTH_TIERS[shownNote]}권</span>
                {TIER_NOTES[shownNote]}
              </>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">단계를 누르거나 점을 움직이면 그 단계의 설명이 여기에 나옵니다.</span>
            )}
          </span>
        </p>
      </div>

      <div className="flex items-center justify-end gap-3">
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
