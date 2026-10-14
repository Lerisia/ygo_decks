import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import SearchForm from "./SearchForm";
import type { ComboItem } from "./ComboBox";
import { makeMatcher, nameKeys } from "@/utils/hangul";

const SUGGESTED = 8;

/** One box for the card book's name search and its 카드군·서포트 pick (/dev/cards, a trial — 참혈 2026-10-14). What is
 *  typed searches the card names as before, the list following the typing; under the box the 카드군 and cards with a
 *  support list that match the typing drop down (name or 초성, the whole name, then its start, first), and picking
 *  one puts it in the box as a chip, the typing cleared. Enter searches the names, or picks the suggestion marked
 *  with the arrow keys; Backspace in an empty box takes the chip off. */
export default function UnifiedCardSearch({ query, onQueryChange, onSubmit, items, chosen, onPick, onClear }: {
  query: string;
  onQueryChange: (q: string) => void;
  /** search the names at once (Enter) */
  onSubmit: () => void;
  items: ComboItem[];
  chosen: ComboItem | undefined;
  onPick: (key: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);   // -1: no suggestion marked, Enter searches the names
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const keyed = useMemo(() => items.map((it) => ({ it, k: nameKeys(it.name) })), [items]);
  const typed = useDeferredValue(query.trim());
  const suggestions = useMemo(() => {
    const q = nameKeys(typed).jamo;
    if (!q) return [];
    const match = makeMatcher(typed);
    const rank = (k: { jamo: string }) => (k.jamo === q ? 0 : k.jamo.startsWith(q) ? 1 : 2);
    return keyed
      .filter(({ k }) => match(k))
      .map((x, i) => [rank(x.k), i, x.it] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, SUGGESTED)
      .map((x) => x[2]);
  }, [keyed, typed]);
  const shown = open && suggestions.length > 0;

  const pick = (it: ComboItem) => {
    onPick(it.key);
    setOpen(false);
    setActive(-1);
    input.current?.blur();
  };

  return (
    <div className="relative text-left">
      <SearchForm
        onSearch={() => {
          if (shown && suggestions[active]) pick(suggestions[active]);
          else {
            onSubmit();
            setOpen(false);
          }
        }}
      >
        <div className="flex items-center gap-1.5 h-9 w-full rounded-md border border-input bg-transparent pl-1.5 pr-3 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          {chosen && (
            <span className="shrink-0 max-w-[55%] inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-md bg-blue-600 text-white text-xs font-semibold">
              <span className="opacity-80">{chosen.tag === "카드" ? "서포트" : "카드군"}</span>
              <span className="truncate">{chosen.name}</span>
              <button
                type="button"
                onClick={onClear}
                aria-label={`${chosen.name} 지우기`}
                className="shrink-0 w-5 h-5 rounded leading-none hover:bg-white/20"
              >
                ✕
              </button>
            </span>
          )}
          <input
            ref={input}
            role="combobox"
            aria-label="카드 검색"
            aria-expanded={shown}
            aria-controls={`${id}-list`}
            aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder={chosen ? "카드 이름으로 더 좁히기" : "카드 이름·카드군·서포트 검색 (초성도 돼요)"}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (!suggestions.length) return;
                e.preventDefault();
                setOpen(true);
                setActive(Math.max(-1, Math.min(suggestions.length - 1, active + (e.key === "ArrowDown" ? 1 : -1))));
              } else if (e.key === "Escape") {
                setOpen(false);
              } else if (e.key === "Backspace" && !query && chosen) {
                onClear();
              }
            }}
            enterKeyHint="search"
            className="min-w-0 flex-1 h-full bg-transparent text-base md:text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </SearchForm>
      {shown && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="카드군·서포트 추천"
          // a press on the list must not blur the box before the pick lands
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
        >
          <li className="px-3 pt-1 pb-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            Enter: 카드 이름으로 검색 · 아래에서 고르면 카드군·서포트로 거르기
          </li>
          {suggestions.map((it, i) => (
            <li
              key={it.key}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onClick={() => pick(it)}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 flex items-center justify-between gap-3 text-sm cursor-pointer ${i === active ? "bg-blue-50 dark:bg-gray-700" : ""}`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0 w-10 text-center rounded text-[11px] leading-5 font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  {it.tag === "카드" ? "서포트" : "카드군"}
                </span>
                <span className="break-keep">{it.name}</span>
              </span>
              {it.sub && <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{it.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
