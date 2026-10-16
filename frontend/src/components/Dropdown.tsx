import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { dropPlace, listKey, scrollToShow } from "@/lib/dropdown";

/** label: in the open list; shown: in the closed button (the label when none). */
export type DropdownOption<T extends string = string> = { value: T; label: ReactNode; shown?: ReactNode; title?: string };

const MAX_HEIGHT = 288;
const BOX = "relative inline-flex items-center gap-1 min-w-0 text-left font-semibold text-black dark:text-white bg-white dark:bg-gray-800 "
  + "border border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-colors "
  + "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:z-10 aria-expanded:ring-2 aria-expanded:ring-blue-500 aria-expanded:z-10";

/** The site's own drop-down in place of the system select (참혈 2026-10-16): a button showing the item picked and a list
 *  that opens over the page — drawn at the page's end so no box clips it, above the button when below has too little
 *  room, scrolling inside its most height with the item picked in sight, that item checked. Keys as a select's (↑ ↓
 *  Enter Space Esc Home End PageUp PageDown); a press outside closes it. The button's size, border and corners come
 *  from className (a plain 36px box when none); its text is the page's, small or not, so a phone doesn't zoom. */
export default function Dropdown<T extends string>({ value, options, onChange, label, title, caret = true, className = "h-9 px-3 rounded-lg text-sm", listClassName = "text-sm" }: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** what it picks, for screen readers (the button's and the list's name) */
  label: string;
  title?: string;
  /** a ▾ at the button's right end */
  caret?: boolean;
  className?: string;
  listClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const centre = useRef(false);   // just opened: the item picked to the middle
  const keyed = useRef(false);   // the mark moved by a key: the list follows it
  const id = useId();
  const selected = options.findIndex((o) => o.value === value);
  const picked = options[selected];

  const close = () => {
    setOpen(false);
    setPlace(null);
  };
  const toggle = () => {
    if (open) return close();
    centre.current = true;
    setActive(selected);
    setOpen(true);
  };
  const pick = (i: number) => {
    close();
    if (options[i] && options[i].value !== value) onChange(options[i].value);
  };

  // placed before it is painted, and again as the page scrolls or the window changes size
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const b = button.current?.getBoundingClientRect();
      const l = list.current;
      if (!b || !l) return;
      const border = l.offsetHeight - l.clientHeight;
      const p = dropPlace({
        anchor: b, list: { width: l.offsetWidth, height: l.scrollHeight + border },
        view: { width: document.documentElement.clientWidth, height: window.innerHeight }, max: MAX_HEIGHT,
      });
      setPlace({ top: p.top, bottom: p.bottom, left: p.left, minWidth: p.minWidth, maxHeight: p.maxHeight });
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [open]);
  // the item picked in the middle as it opens; then the mark kept in sight as keys move it
  const placed = place !== null;
  useLayoutEffect(() => {
    const l = list.current;
    const item = l?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!placed || !l || !item) return;
    if (centre.current || keyed.current) {
      l.scrollTop = scrollToShow({ scrollTop: l.scrollTop, height: l.clientHeight }, { top: item.offsetTop, height: item.offsetHeight }, centre.current);
    }
    centre.current = keyed.current = false;
  }, [placed, active]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) close();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    const r = listKey(e.key, { open, active, count: options.length, selected });
    if (!r) return;
    if (r.prevent) e.preventDefault();
    // Esc and the rest stop here, not at the page's own keys (the editor's Esc, its undo)
    if (open) e.stopPropagation();
    if (r.pick !== undefined) return pick(r.pick);
    if (!r.open) return close();
    if (open) keyed.current = true;
    else centre.current = true;
    setActive(r.active);
    setOpen(true);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        title={title}
        onClick={toggle}
        onKeyDown={onKey}
        // a Space let through would press the button again once the list has opened
        onKeyUp={(e) => e.key === " " && e.preventDefault()}
        className={`${BOX} ${className}`}
      >
        <span className="min-w-0 truncate">{picked ? (picked.shown ?? picked.label) : ""}</span>
        {caret && <ChevronDown aria-hidden className={`ml-auto shrink-0 w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && createPortal(
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          // a menu at the page's end: whatever holds the button and closes on a press outside it leaves this alone
          data-dex-overlay
          // a press on the list keeps the focus on the button
          onMouseDown={(e) => e.preventDefault()}
          style={place ? { position: "fixed", ...place } : { position: "fixed", top: 0, left: 0, maxHeight: MAX_HEIGHT, visibility: "hidden" }}
          className={`z-[60] m-0 py-1 list-none w-max max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg text-left ${listClassName}`}
        >
          {options.map((o, i) => {
            const on = i === selected;
            return (
              <li
                key={o.value}
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={on}
                title={o.title}
                onClick={() => pick(i)}
                onPointerMove={(e) => e.pointerType === "mouse" && i !== active && setActive(i)}
                className={`flex items-center gap-1.5 min-h-9 sm:min-h-8 pl-2 pr-3 cursor-pointer whitespace-nowrap tabular-nums ${
                  i === active ? "bg-blue-50 dark:bg-gray-700" : ""
                } ${on ? "font-semibold text-blue-700 dark:text-blue-300" : "text-gray-800 dark:text-gray-100"}`}
              >
                <Check aria-hidden className={`shrink-0 w-3.5 h-3.5 ${on ? "" : "invisible"}`} />
                {o.label}
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </>
  );
}
