import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { countInRange, moveHandle, pickHandle } from "../utils/recommendFlow";

// A question answered on a bar (deck power, 특이점 2026-10-11; difficulty, 특이점 2026-10-15): the tiers left to right,
// two points mark the tiers the result may come from; both on one tier picks just that tier. Each tier label shows
// whether any candidate is left there, and the tier under the cursor or just chosen is told under the bar.
export default function TierRangePicker({
  question,
  hint,
  tiers,
  notes,
  noteSuffix = "",
  ends,
  newcomerFrom,
  tierCounts,
  onConfirm,
}: {
  question: string;
  hint: string;
  tiers: string[];
  /** what each tier means */
  notes: string[];
  /** after a tier's name over its note (하위 → 하위권) */
  noteSuffix?: string;
  /** the two points' names, left then right */
  ends: [string, string];
  /** from this tier on, a band marks them 입문자 비추천, and a range reaching it says so (deck power, 특이점 2026-10-15) */
  newcomerFrom?: number;
  tierCounts: number[] | null;
  onConfirm: (lo: number, hi: number) => void;
}) {
  const LAST = tiers.length - 1;
  const pct = (step: number) => `${(step / LAST) * 100}%`;
  // the track spans the label columns' centres
  const inset = `${50 / tiers.length}%`;
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
  // a range reaching into the band says so once more, under the range (특이점 2026-10-15); not while it is the
  // whole bar, which is no choice yet
  const warn = newcomerFrom !== undefined && !whole && hi >= newcomerFrom;
  const rangeLabel = lo === hi ? tiers[lo] : `${tiers[lo]} ~ ${tiers[hi]}`;

  const handle = (which: "lo" | "hi", step: number) => (
    <span
      role="slider"
      tabIndex={0}
      aria-label={which === "lo" ? ends[0] : ends[1]}
      aria-valuemin={0}
      aria-valuemax={LAST}
      aria-valuenow={step}
      aria-valuetext={tiers[step]}
      onKeyDown={onKey(which)}
      className="absolute top-1/2 w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-[3px] border-blue-600 shadow-md cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      style={{ left: pct(step), zIndex: which === "lo" && lo === LAST ? 3 : 2 }}
    />
  );

  return (
    <div className="mb-6 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{question}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 break-keep">{hint}</p>

      <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-2 pt-4 pb-2">
        <div className="relative">
          {/* behind the bar and the labels, the columns of the tiers not for newcomers, named at the band's top */}
          {newcomerFrom !== undefined && (
            <div
              className="pointer-events-none absolute -top-3 bottom-0 right-0 rounded-lg bg-orange-500/10 dark:bg-orange-400/10"
              style={{ left: `${(newcomerFrom / tiers.length) * 100}%` }}
            >
              <span className="absolute inset-x-0 top-0.5 text-center text-[10px] sm:text-[11px] leading-3 font-semibold text-orange-600 dark:text-orange-300">
                입문자 비추천
              </span>
            </div>
          )}
          {/* The track spans the centres of the six label columns, so each point sits right over its label. */}
          <div
            className="relative h-10 touch-none select-none cursor-pointer"
            style={{ marginLeft: inset, marginRight: inset }}
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
            {tiers.map((_, i) => (
              <span
                key={i}
                className={`absolute top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${i >= lo && i <= hi ? "bg-blue-600" : "bg-gray-400 dark:bg-gray-500"}`}
                style={{ left: pct(i) }}
              />
            ))}
            {handle("lo", lo)}
            {handle("hi", hi)}
          </div>
          <div className="grid mt-1 text-center text-xs sm:text-sm break-keep" style={{ gridTemplateColumns: `repeat(${tiers.length}, minmax(0, 1fr))` }}>
            {tiers.map((label, i) => {
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
                <span className="font-semibold text-gray-900 dark:text-white mr-1.5">{tiers[shownNote]}{noteSuffix}</span>
                {notes[shownNote]}
              </>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">단계를 누르거나 점을 움직이면 그 단계의 설명이 여기에 나옵니다.</span>
            )}
          </span>
        </p>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <p className="text-sm text-right break-keep">
          <span className="font-semibold text-gray-900 dark:text-white">{whole ? "전체 (상관 없음)" : rangeLabel}</span>
          {count !== null && (
            <span className={count === 0 ? "text-red-500 ml-1.5" : "text-gray-500 dark:text-gray-400 ml-1.5"}>
              {count === 0 ? "· 남은 덱 없음" : `· 덱 ${count.toLocaleString()}개`}
            </span>
          )}
        </p>
        {/* its line is always kept, so the button below never moves */}
        {newcomerFrom !== undefined && (
          <p
            aria-hidden={!warn}
            className={`h-4 text-xs leading-4 text-right break-keep text-orange-600 dark:text-orange-300 transition-opacity duration-200 motion-reduce:transition-none ${warn ? "opacity-100" : "opacity-0"}`}
          >
            ⚠ {tiers[newcomerFrom]}{noteSuffix} 이하는 입문자에게 추천하지 않아요
          </p>
        )}
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
