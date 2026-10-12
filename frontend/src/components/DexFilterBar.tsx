import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, Filter, Plus, RotateCw, X } from "lucide-react";
import {
  type DexField, type DexValues,
  chipText, fitCount, hasResettable, normalizeValues, resetValues, toggleValue,
} from "@/utils/dexFilter";

const NARROW = "(max-width: 639px)";   // below sm the filters open in a modal

type Look = "on" | "base" | "off" | "disabled";
// a border and py-0 on every look, so a chip drawn as a button (index.css pads and borders buttons) measures as its
// span copy; a little tighter on a phone, where the row is short of room
const CHIP_BOX = "inline-flex items-center h-9 py-0 border rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 transition";
const CHIP = `${CHIP_BOX} gap-0.5 sm:gap-1 px-2 sm:px-3`;
const CARET = "w-3.5 h-3.5 sm:w-4 sm:h-4 -mr-0.5 sm:-mr-1 shrink-0";
const LOOKS: Record<Look, string> = {
  on: "border-transparent bg-blue-600 text-white hover:bg-blue-700",
  base: "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700",
  off: "border-transparent bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600",
  disabled: "border-transparent bg-gray-100 dark:bg-gray-700/40 text-gray-400 dark:text-gray-500 cursor-not-allowed",
};
const OPTION = "h-8 px-3 rounded-lg text-sm font-semibold whitespace-nowrap break-keep transition";
const optionLook = (on: boolean) =>
  on ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600";
const CLOSE_BTN = "h-9 px-4 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition";
const APPLY_BTN = "h-9 px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition";
const HEADING = "h-7 flex items-center gap-1 text-sm font-semibold text-gray-700 dark:text-gray-200";

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const m = window.matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

function OptionList({ field, chosen, onPick }: { field: DexField; chosen: string[]; onPick: (value: string | null) => void }) {
  return (
    <div role="listbox" aria-label={field.label} aria-multiselectable={field.multi || undefined} className="flex flex-wrap gap-1.5">
      {[{ value: null, label: "전체" }, ...field.options].map((o) => {
        const on = o.value === null ? !chosen.length : chosen.includes(o.value);
        return (
          <button key={o.value ?? ""} type="button" role="option" aria-selected={on} onClick={() => onPick(o.value)} className={`${OPTION} ${optionLook(on)}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A chip's choices, dropped under it and kept inside the screen. */
function Popover({ field, chosen, onPick }: { field: DexField; chosen: string[]; onPick: (value: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const over = r.right - (document.documentElement.clientWidth - 8);
    if (over > 0) setShift(-Math.min(over, Math.max(0, r.left - 8)));
  }, []);
  return (
    <div
      ref={ref}
      style={shift ? { transform: `translateX(${shift}px)` } : undefined}
      className="absolute left-0 top-full mt-1 z-30 w-max max-w-[min(22rem,calc(100vw-1rem))] max-h-80 overflow-y-auto overscroll-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-2 text-left"
    >
      {field.multi && <p className="px-0.5 pb-1.5 text-xs text-gray-500 dark:text-gray-400">여러 개 선택 가능</p>}
      <OptionList field={field} chosen={chosen} onPick={onPick} />
    </div>
  );
}

/** The deck book's and card book's filters (참혈 2026-10-12): a funnel, the base chip (종류 / 파워) and the chips in use
 *  on one row, a + that unfolds the rest (필터링 항목, then 그 외 toggles) with 닫기·적용, the page's own control at the
 *  row's right end. A chip opens its choices under it; folded, a pick applies at once, unfolded it waits for 적용.
 *  Chips that don't fit the row fold into "그 외 n종". Below sm the row opens the same thing as a modal. */
export default function DexFilterBar({ fields, extras, values, onChange, isDisabled, right, active = true }: {
  /** The chips, the primary (base) one first. */
  fields: DexField[];
  /** 그 외: each option a toggle. */
  extras: DexField[];
  values: DexValues;
  onChange: (values: DexValues) => void;
  /** An item that doesn't fit the others (몬스터 형태 for 마법): greyed, no choices, its value cleared. */
  isDisabled?: (key: string, values: DexValues) => boolean;
  /** The row's right end: the sort, the 덱 파워 switch. */
  right?: ReactNode;
  /** False while the page is kept hidden behind a document: everything folds. */
  active?: boolean;
}) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DexValues>(values);
  // the chip whose choices are open stays where it was (top row or not) until they close
  const [popup, setPopup] = useState<{ key: string; top: boolean } | null>(null);
  const [pending, setPending] = useState<string[]>([]);   // the modal's popup, until 확인
  const [fit, setFit] = useState(Number.POSITIVE_INFINITY);
  const areaRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const popupWrap = useRef<HTMLSpanElement>(null);

  const shown = open ? draft : values;
  const vals = (key: string) => shown[key] ?? [];
  const off = (f: DexField) => !!isDisabled?.(f.key, shown);
  const onTop = (f: DexField) => (popup?.key === f.key ? popup.top : !!f.primary || vals(f.key).length > 0);
  const topFields = fields.filter(onTop);
  const listFields = fields.filter((f) => !onTop(f));
  const extraOn = extras.flatMap((e) => e.options.filter((o) => vals(e.key).includes(o.value)).map((o) => ({ e, o })));
  const topCount = topFields.length + extraOn.length;
  const wide = open && !narrow;   // unfolded on a wide screen: the top row shows every chip, wrapping
  const showPlus = !wide;
  const shownCount = wide ? topCount : Math.min(fit, topCount);
  const popupField = popup ? fields.find((f) => f.key === popup.key) : undefined;

  const set = (key: string, next: string[]) => {
    const v = normalizeValues(fields, { ...shown, [key]: next }, isDisabled);
    if (open) setDraft(v);
    else onChange(v);
  };
  const unfold = () => {
    setDraft(values);
    setPopup(null);
    setOpen(true);
  };
  const fold = () => {
    setOpen(false);
    setPopup(null);
  };
  const apply = () => {
    onChange(draft);
    fold();
  };
  const openPopup = (f: DexField) => {
    if (off(f) && !vals(f.key).length) return;
    if (popup?.key === f.key) return setPopup(null);
    setPending(vals(f.key));
    setPopup({ key: f.key, top: onTop(f) });
  };
  const pick = (f: DexField, value: string | null) => {
    set(f.key, value === null ? [] : f.multi ? toggleValue(vals(f.key), value, true) : [value]);
    if (!f.multi) setPopup(null);
  };
  const pickPending = (f: DexField, value: string | null) =>
    setPending((p) => (value === null ? [] : f.multi ? toggleValue(p, value, true) : [value]));

  useEffect(() => setPopup(null), [narrow]);
  useEffect(() => {
    if (!active) fold();
  }, [active]);

  useEffect(() => {
    if (!popup || narrow) return;
    const onDown = (e: PointerEvent) => {
      if (!popupWrap.current?.contains(e.target as Node)) setPopup(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [popup, narrow]);

  const modal = open && narrow && active;
  useEffect(() => {
    if (!popup && !modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (popup) setPopup(null);
      else fold();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popup, modal]);

  useEffect(() => {
    if (!modal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [modal]);

  // How many top chips fit, from a hidden copy of the row: funnel, every chip, "그 외 n종", +.
  const measure = useCallback(() => {
    const area = areaRef.current;
    const m = measureRef.current;
    const kids = Array.from(m?.children ?? []) as HTMLElement[];
    if (!area || !m || !area.clientWidth || kids.length < 3) return;
    const gap = parseFloat(getComputedStyle(m).columnGap) || 0;
    const widths = kids.slice(1, -2).map((k) => k.offsetWidth);
    const fixed = kids[0].offsetWidth + (showPlus ? gap + kids[kids.length - 1].offsetWidth : 0);
    setFit(fitCount(widths, kids[kids.length - 2].offsetWidth, fixed, gap, area.clientWidth));
  }, [showPlus]);
  useLayoutEffect(measure);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (areaRef.current) ro.observe(areaRef.current);
    if (measureRef.current) ro.observe(measureRef.current);
    return () => ro.disconnect();
  }, [measure, narrow]);

  const fieldChip = (f: DexField, live: boolean) => {
    const v = vals(f.key);
    const disabled = !v.length && off(f);
    const look: Look = v.length ? "on" : f.primary ? "base" : disabled ? "disabled" : "off";
    const body = (
      <>
        {chipText(f, v)}
        <ChevronDown className={CARET} aria-hidden />
      </>
    );
    if (!live) return <span key={f.key} className={`${CHIP} ${LOOKS[look]}`}>{body}</span>;
    const isOpen = popup?.key === f.key;
    return (
      <span key={f.key} ref={isOpen ? popupWrap : undefined} className="relative shrink-0">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={v.length ? `${f.label}: ${chipText(f, v)}` : f.label}
          onClick={() => openPopup(f)}
          className={`${CHIP} ${LOOKS[look]}`}
        >
          {body}
        </button>
        {isOpen && !narrow && <Popover field={f} chosen={v} onPick={(value) => pick(f, value)} />}
      </span>
    );
  };
  const extraChip = ({ e, o }: (typeof extraOn)[number], live: boolean) => {
    const key = `${e.key}:${o.value}`;
    const body = (
      <>
        {o.label}
        <X className={CARET} aria-hidden />
      </>
    );
    if (!live) return <span key={key} className={`${CHIP} ${LOOKS.on}`}>{body}</span>;
    return (
      <button
        key={key}
        type="button"
        aria-label={`${o.label} 빼기`}
        onClick={() => set(e.key, vals(e.key).filter((x) => x !== o.value))}
        className={`${CHIP} ${LOOKS.on}`}
      >
        {body}
      </button>
    );
  };
  const topChips = (live: boolean, count = topCount) =>
    [...topFields.map((f) => fieldChip(f, live)), ...extraOn.map((x) => extraChip(x, live))].slice(0, count);

  const funnel = (
    <span className="shrink-0 flex items-center text-gray-500 dark:text-gray-400">
      <Filter className="w-[18px] h-[18px] sm:w-5 sm:h-5" aria-hidden />
    </span>
  );
  const moreText = (n: number) => `그 외 ${n}종`;
  const plus = <Plus className="w-5 h-5" aria-hidden />;
  const PLUS = `${CHIP_BOX} justify-center w-8 sm:w-9 ${LOOKS.base}`;
  const hidden = topCount - shownCount;

  const sections = (
    <>
      <div className={HEADING}>
        필터링 항목
        {hasResettable(fields, extras, shown) && (
          <button
            type="button"
            onClick={() => {
              setDraft(resetValues(fields, extras));
              setPopup(null);
            }}
            aria-label="필터 초기화"
            title="필터 초기화"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          >
            <RotateCw className="w-4 h-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {listFields.length ? (
          listFields.map((f) => fieldChip(f, true))
        ) : (
          <span className="h-9 flex items-center text-sm text-gray-400 dark:text-gray-500">없음</span>
        )}
      </div>
      {extras.length > 0 && (
        <>
          <div className={`mt-3 ${HEADING}`}>그 외</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
            {extras.map((e) => (
              <div key={e.key} className="flex flex-wrap gap-1.5">
                {e.options.map((o) => {
                  const on = vals(e.key).includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set(e.key, toggleValue(vals(e.key), o.value, e.multi))}
                      className={`${CHIP} break-keep ${on ? LOOKS.on : LOOKS.off}`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={fold} className={CLOSE_BTN}>닫기</button>
      <button type="button" onClick={apply} className={APPLY_BTN}>적용</button>
    </div>
  );

  return (
    <div className="text-left">
      <div className="relative flex items-start gap-1.5 sm:gap-2">
        {narrow ? (
          // on a phone the whole row is one button: it opens the modal
          <button
            type="button"
            ref={areaRef as RefObject<HTMLButtonElement>}
            onClick={unfold}
            aria-label="필터 열기"
            className="flex-1 min-w-0 flex items-center gap-1 p-0 border-0 rounded-none bg-transparent text-left"
          >
            {funnel}
            {topChips(false, shownCount)}
            {hidden > 0 && <span className={`${CHIP} ${LOOKS.base}`}>{moreText(hidden)}</span>}
            <span className={PLUS}>{plus}</span>
          </button>
        ) : (
          <div ref={areaRef as RefObject<HTMLDivElement>} className={`flex-1 min-w-0 flex items-center gap-1.5 ${wide ? "flex-wrap" : ""}`}>
            {funnel}
            {topChips(true, shownCount)}
            {hidden > 0 && (
              <button type="button" onClick={unfold} className={`${CHIP} ${LOOKS.base}`}>{moreText(hidden)}</button>
            )}
            {showPlus && (
              <button type="button" onClick={unfold} aria-label="필터 항목 더 보기" title="필터 항목 더 보기" className={PLUS}>
                {plus}
              </button>
            )}
          </div>
        )}
        {right && <div className="shrink-0 flex items-center h-9">{right}</div>}
        <div aria-hidden className="absolute inset-x-0 top-0 h-0 overflow-hidden invisible pointer-events-none">
          <div ref={measureRef} className="flex w-max gap-1 sm:gap-1.5">
            {funnel}
            {topChips(false)}
            <span className={`${CHIP} ${LOOKS.base}`}>{moreText(topCount)}</span>
            <span className={PLUS}>{plus}</span>
          </div>
        </div>
      </div>

      {wide && (
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          {sections}
          <div className="mt-3">{footer}</div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[55] bg-black/60 flex items-center justify-center p-4" onClick={fold}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="필터"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm max-h-[85svh] flex flex-col rounded-xl bg-white dark:bg-gray-800 text-left shadow-xl"
          >
            <div className="px-4 pt-4 pb-2 flex items-center gap-1.5 font-semibold">
              <Filter className="w-5 h-5 text-gray-500 dark:text-gray-400" aria-hidden />
              필터
            </div>
            <div className="px-4 pb-3 min-h-0 overflow-y-auto overscroll-contain">
              <div className="flex flex-wrap gap-1.5">{topChips(true)}</div>
              <div className="mt-3">{sections}</div>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">{footer}</div>
          </div>
          {popupField && (
            <div
              className="fixed inset-0 z-[56] bg-black/40 flex items-center justify-center p-4"
              onClick={(e) => {
                e.stopPropagation();
                setPopup(null);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={popupField.label}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm max-h-[80svh] flex flex-col rounded-xl bg-white dark:bg-gray-800 p-4 text-left shadow-xl"
              >
                <p className="font-semibold">{popupField.label}</p>
                {popupField.multi && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">여러 개 선택 가능</p>}
                <div className="mt-3 min-h-0 overflow-y-auto overscroll-contain">
                  <OptionList field={popupField} chosen={pending} onPick={(value) => pickPending(popupField, value)} />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    set(popupField.key, pending);
                    setPopup(null);
                  }}
                  className={`mt-4 w-full ${APPLY_BTN}`}
                >
                  확인
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
