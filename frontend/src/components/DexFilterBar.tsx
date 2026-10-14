import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronUp, Plus, RotateCw, X } from "lucide-react";
import {
  type DexField, type DexValues, type TopChip,
  chipText, fitCount, hasResettable, normalizeValues, resetValues, toggleValue, topChips, valueText,
} from "@/utils/dexFilter";

const NARROW = "(max-width: 639px)";   // below sm the filters open in a modal

type Look = "on" | "base" | "off" | "disabled";
// a border and py-0 on every look, so a chip drawn as a button (index.css pads and borders buttons) measures as its
// hidden copy; a little tighter on a phone, where the row is short of room
const CHIP_BOX = "inline-flex items-center h-9 py-0 border rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 transition";
const CHIP = `${CHIP_BOX} gap-0.5 sm:gap-1 px-2 sm:px-3`;
const CARET = "w-3.5 h-3.5 sm:w-4 sm:h-4 -mr-0.5 sm:-mr-1 shrink-0";
// each look keeps its border under the mouse (index.css outlines every hovered button in purple)
const LOOKS: Record<Look, string> = {
  on: "border-transparent hover:border-transparent bg-blue-600 text-white hover:bg-blue-700",
  base: "border-gray-300 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700",
  off: "border-transparent hover:border-transparent bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600",
  disabled: "border-transparent hover:border-transparent bg-gray-100 dark:bg-gray-700/40 text-gray-400 dark:text-gray-500 cursor-not-allowed",
};
// a chip in use is two buttons (참혈 2026-10-12 round 2): its value opens the choices, the ✕ clears it; the whole
// chip darkens under the mouse, not each half (참혈 2026-10-12)
const IN_USE = `${CHIP_BOX} overflow-hidden border-transparent bg-blue-600 text-white transition hover:bg-blue-700`;
const HALF = "h-full flex items-center p-0 border-0 rounded-none bg-transparent text-white font-semibold";
const OPTION = "h-8 px-3 rounded-lg hover:border-transparent text-sm font-semibold whitespace-nowrap break-keep transition";
const optionLook = (on: boolean) =>
  on ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600";
const CLOSE_BTN = "h-9 px-4 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition";
const APPLY_BTN = "h-9 px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition";
const HEADING = "h-7 flex items-center gap-1 text-sm font-semibold text-gray-700 dark:text-gray-200";
const PLUS = `${CHIP_BOX} justify-center w-8 sm:w-9 ${LOOKS.base}`;

/** Where a chip is drawn: the top row (a phone's opens the modal), the modal, or the hidden copy that measures the row. */
type Where = "row" | "phone" | "modal" | "measure";
const chipId = (c: TopChip) => (c.value === undefined ? c.field.key : `${c.field.key}:${c.value}`);

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

/** A chip's choices, dropped under it and kept inside the screen. Placed from the chip on every render, so it follows a
 *  chip the row moves; once the chip goes (its last value unpicked) the choices stay where they were. */
function Popover({ field, chosen, onPick, anchor, root, box }: {
  field: DexField;
  chosen: string[];
  onPick: (value: string | null) => void;
  anchor: string;
  root: RefObject<HTMLDivElement | null>;
  box: RefObject<HTMLDivElement | null>;
}) {
  useLayoutEffect(() => {
    const place = () => {
      const b = box.current;
      const r = root.current;
      const a = Array.from(r?.querySelectorAll<HTMLElement>("[data-chip]") ?? []).find((el) => el.dataset.chip === anchor);
      if (!b || !r || !a) return;
      const rr = r.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const maxLeft = document.documentElement.clientWidth - 8 - b.offsetWidth;
      b.style.left = `${Math.max(8, Math.min(ar.left, maxLeft)) - rr.left}px`;
      b.style.top = `${ar.bottom - rr.top + 4}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
  return (
    <div
      ref={box}
      className="absolute left-0 top-full z-30 w-max max-w-[min(22rem,calc(100vw-1rem))] max-h-80 overflow-y-auto overscroll-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-2 text-left"
    >
      {field.multi && <p className="px-0.5 pb-1.5 text-xs text-gray-500 dark:text-gray-400">여러 개 선택 가능</p>}
      <OptionList field={field} chosen={chosen} onPick={onPick} />
    </div>
  );
}

/** The deck book's and card book's filters (참혈 2026-10-12): the base chip (종류 / 파워) and the chips in use on one
 *  row, a + that unfolds the rest (필터링 항목, then 그 외 toggles), the page's own control at the row's right end.
 *  A chip in use carries a ✕ that clears it; a multi item's values are a chip each. On a wide screen every pick
 *  applies at once; below sm the row opens a modal whose picks wait for 적용. Chips that don't fit fold into "그 외 n종". */
export default function DexFilterBar({ fields, extra, values, onChange, isDisabled, right, active = true }: {
  /** The chips, the primary (base) one first. */
  fields: DexField[];
  /** 그 외: several toggles in one group. */
  extra?: DexField;
  values: DexValues;
  onChange: (values: DexValues) => void;
  /** An item that doesn't fit the others (몬스터 for 마법): greyed, no choices, its value cleared. */
  isDisabled?: (key: string, values: DexValues) => boolean;
  /** The row's right end: the sort, the 덱 파워 switch. */
  right?: ReactNode;
  /** False while the page is kept hidden behind a document: everything folds. */
  active?: boolean;
}) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DexValues | null>(null);   // the modal's picks, until 적용
  const [popup, setPopup] = useState<{ key: string; anchor: string } | null>(null);
  const [pending, setPending] = useState<string[]>([]);   // the modal's popup, until 확인
  const [fit, setFit] = useState(Number.POSITIVE_INFINITY);
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const popBox = useRef<HTMLDivElement>(null);

  const modal = open && narrow && active;
  const shown = modal && draft ? draft : values;
  const vals = (key: string) => shown[key] ?? [];
  const off = (f: DexField) => !!isDisabled?.(f.key, shown);
  const top = topChips(fields, extra, shown);
  const listFields = fields.filter((f) => f.multi || (!f.primary && !vals(f.key).length));
  const wide = open && !narrow;   // unfolded on a wide screen: the top row shows every chip, wrapping
  const shownCount = wide ? top.length : Math.min(fit, top.length);
  const hidden = top.length - shownCount;
  const popupField = popup ? [...fields, ...(extra ? [extra] : [])].find((f) => f.key === popup.key) : undefined;

  const commit = (v: DexValues) => (modal ? setDraft(v) : onChange(v));
  const set = (key: string, next: string[]) => commit(normalizeValues(fields, { ...shown, [key]: next }, isDisabled));
  const unfold = () => {
    setDraft(null);
    setPopup(null);
    setOpen(true);
  };
  const fold = () => {
    setOpen(false);
    setPopup(null);
    setDraft(null);
  };
  const apply = () => {
    if (draft) onChange(draft);
    fold();
  };
  const openChip = (f: DexField, id: string) => {
    if (narrow && !modal) return unfold();
    if (off(f) && !vals(f.key).length) return;
    if (popup?.anchor === id) return setPopup(null);
    setPending(vals(f.key));
    setPopup({ key: f.key, anchor: id });
  };
  const clearChip = (c: TopChip) => {
    set(c.field.key, c.value === undefined ? [] : vals(c.field.key).filter((x) => x !== c.value));
    if (popup?.anchor === chipId(c)) setPopup(null);
  };
  const pick = (f: DexField, value: string | null) => {
    set(f.key, value === null ? [] : f.multi ? toggleValue(vals(f.key), value, true) : [value]);
    if (!f.multi) setPopup(null);
  };
  const pickPending = (f: DexField, value: string | null) =>
    setPending((p) => (value === null ? [] : f.multi ? toggleValue(p, value, true) : [value]));

  // Across sm the modal and the unfolded rows turn into each other: narrowing starts the modal on what is applied,
  // widening applies the modal's picks, as the rows apply every pick.
  const wasNarrow = useRef(narrow);
  useLayoutEffect(() => {
    if (wasNarrow.current === narrow) return;
    wasNarrow.current = narrow;
    setPopup(null);
    if (!narrow && draft) onChange(draft);
    setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);
  useEffect(() => {
    if (!active) fold();
  }, [active]);

  useEffect(() => {
    if (!popup || narrow) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (popBox.current?.contains(t) || t.closest?.("[data-chip]")?.getAttribute("data-chip") === popup.anchor) return;
      setPopup(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [popup, narrow]);

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

  // How many top chips fit, from a hidden copy of the row: every chip, "그 외 n종", +.
  const measure = useCallback(() => {
    const area = areaRef.current;
    const m = measureRef.current;
    const kids = Array.from(m?.children ?? []) as HTMLElement[];
    if (!area || !m || !area.clientWidth || kids.length < 2) return;
    const gap = parseFloat(getComputedStyle(m).columnGap) || 0;
    const widths = kids.slice(0, -2).map((k) => k.offsetWidth);
    setFit(fitCount(widths, kids[kids.length - 2].offsetWidth, kids[kids.length - 1].offsetWidth, gap, area.clientWidth));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (areaRef.current) ro.observe(areaRef.current);
    if (measureRef.current) ro.observe(measureRef.current);
    return () => ro.disconnect();
  }, [measure]);

  /** A top chip: in use it is its value and a ✕; the base chip at 전체 is its name and a caret. The hidden copy
   *  that measures the row is the same buttons, left unnamed and out of reach. */
  const topChip = (c: TopChip, where: Where) => {
    const id = chipId(c);
    const f = c.field;
    const text = c.value === undefined ? chipText(f, vals(f.key)) : valueText(f, c.value);
    const live = (props: object) => (where === "measure" ? {} : props);
    const anchor = live({ "data-chip": id });
    const body = (label: string) =>
      live({
        "aria-label": label,
        "aria-haspopup": where === "phone" ? "dialog" : "listbox",
        "aria-expanded": where === "phone" ? undefined : popup?.anchor === id,
        onClick: () => openChip(f, id),
      });
    if (c.value === undefined && !vals(f.key).length) {
      return (
        <button key={id} type="button" {...anchor} {...body(f.label)} className={`${CHIP} ${LOOKS.base}`}>
          {text}
          <ChevronDown className={CARET} aria-hidden />
        </button>
      );
    }
    const name = c.value === undefined ? f.label : `${f.label} ${text}`;   // 종류 필터 지우기, 기믹 드로우 필터 지우기
    return (
      <span key={id} {...anchor} className={IN_USE}>
        <button type="button" {...body(`${f.label}: ${text}`)} className={`${HALF} pl-2 sm:pl-3 pr-0.5`}>
          {text}
        </button>
        <button
          type="button"
          {...live({
            "aria-label": `${name} 필터 지우기`,
            title: "지우기",
            onClick: (e: MouseEvent) => {
              e.stopPropagation();
              clearChip(c);
            },
          })}
          className={`${HALF} justify-center w-7 sm:w-8`}
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </span>
    );
  };
  /** A chip of 필터링 항목: an item at 전체 (or a multi one, to pick more), greyed when it doesn't fit. */
  const listChip = (f: DexField) => {
    const disabled = !vals(f.key).length && off(f);
    return (
      <button
        key={f.key}
        type="button"
        data-chip={f.key}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={popup?.anchor === f.key}
        aria-label={f.label}
        onClick={() => openChip(f, f.key)}
        className={`${CHIP} ${LOOKS[disabled ? "disabled" : "off"]}`}
      >
        {f.label}
        <ChevronDown className={CARET} aria-hidden />
      </button>
    );
  };

  const moreText = (n: number) => `그 외 ${n}종`;

  const sections = (
    <>
      <div className={HEADING}>
        필터링 항목
        {hasResettable(fields, extra, shown) && (
          <button
            type="button"
            onClick={() => {
              commit(resetValues(fields, extra));
              setPopup(null);
            }}
            aria-label="필터 초기화"
            title="필터 초기화"
            className="w-7 h-7 flex items-center justify-center p-0 border-0 rounded-lg bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          >
            <RotateCw className="w-4 h-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {listFields.length ? (
          listFields.map(listChip)
        ) : (
          <span className="h-9 flex items-center text-sm text-gray-400 dark:text-gray-500">없음</span>
        )}
      </div>
      {extra && (
        <>
          <div className={`mt-3 ${HEADING}`}>{extra.label}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {extra.options.map((o) => {
              const on = vals(extra.key).includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set(extra.key, toggleValue(vals(extra.key), o.value, extra.multi))}
                  className={`${CHIP} break-keep ${on ? LOOKS.on : LOOKS.off}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );

  return (
    <div ref={rootRef} className="relative text-left">
      {/* data-dex-row: what a .dex-compact wrapper draws smaller (the chip row and its unfolded items, not the menus) */}
      <div data-dex-row className="relative flex items-start gap-1.5 sm:gap-2">
        {/* on a phone the whole row opens the modal, but a ✕ clears its chip at once */}
        <div
          ref={areaRef}
          onClick={narrow ? unfold : undefined}
          className={`flex-1 min-w-0 flex items-center gap-1 sm:gap-1.5 ${wide ? "flex-wrap" : ""}`}
        >
          {top.slice(0, shownCount).map((c) => topChip(c, narrow ? "phone" : "row"))}
          {hidden > 0 && (
            <button type="button" onClick={unfold} className={`${CHIP} ${LOOKS.base}`}>{moreText(hidden)}</button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (wide) fold();
              else unfold();
            }}
            aria-expanded={open}
            aria-label={narrow ? "필터 열기" : wide ? "필터 항목 접기" : "필터 항목 더 보기"}
            title={narrow ? "필터 열기" : wide ? "필터 항목 접기" : "필터 항목 더 보기"}
            className={PLUS}
          >
            {wide ? <ChevronUp className="w-5 h-5" aria-hidden /> : <Plus className="w-5 h-5" aria-hidden />}
          </button>
        </div>
        {right && <div className="shrink-0 flex items-center h-9">{right}</div>}
        <div aria-hidden className="absolute inset-x-0 top-0 h-0 overflow-hidden invisible pointer-events-none">
          <div ref={measureRef} className="flex w-max gap-1 sm:gap-1.5">
            {top.map((c) => topChip(c, "measure"))}
            <span className={`${CHIP} ${LOOKS.base}`}>{moreText(top.length)}</span>
            <span className={PLUS} />
          </div>
        </div>
      </div>

      {wide && <div data-dex-row className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">{sections}</div>}

      {popup && popupField && !narrow && (
        <Popover
          field={popupField}
          chosen={vals(popupField.key)}
          onPick={(value) => pick(popupField, value)}
          anchor={popup.anchor}
          root={rootRef}
          box={popBox}
        />
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
            <div className="px-4 pt-4 pb-2 font-semibold">필터</div>
            <div className="px-4 pb-3 min-h-0 overflow-y-auto overscroll-contain">
              <div className="flex flex-wrap gap-1.5">{top.map((c) => topChip(c, "modal"))}</div>
              <div className="mt-3">{sections}</div>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button type="button" onClick={fold} className={CLOSE_BTN}>닫기</button>
              <button type="button" onClick={apply} className={APPLY_BTN}>적용</button>
            </div>
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
