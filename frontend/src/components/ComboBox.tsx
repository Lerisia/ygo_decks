import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import SearchForm from "./SearchForm";
import { Input } from "./ui/input";
import { makeMatcher, nameKeys } from "@/utils/hangul";

/** tag: a word before the name saying what it is; searchOnly: listed only once something is typed. */
export type ComboItem = { key: string; name: string; sub?: string; tag?: string; searchOnly?: boolean };

const STEP = 60;   // rows drawn at a time: drawing all of a long list at once stalls a phone (엘리스 10/12)

/** Choosing one of many without a modal (엘리스 2026-10-12, the 카드군 filter): the box is a search box, its matches
 *  (name or 초성, matched jamo by jamo so a half-typed syllable keeps them; the whole name, then its start, first)
 *  drop down under it, drawn a screenful at a time as the list scrolls, and a tap picks one. The box answers each key
 *  at once and the list follows. Arrow keys move through them; Enter — the phone keyboard's 검색 key — picks the one
 *  marked and puts the keyboard away. */
export default function ComboBox({ items, value, onPick, onClear, placeholder, label, emptyText, loading = false }: {
  items: ComboItem[]; value: string; onPick: (key: string) => void; onClear: () => void;
  placeholder: string; label: string; emptyText: string; loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(STEP);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const chosen = items.find((it) => it.key === value);
  const keyed = useMemo(() => items.map((it) => ({ it, k: nameKeys(it.name) })), [items]);
  const typed = useDeferredValue(query);
  const matches = useMemo(() => {
    const match = makeMatcher(typed);
    const q = nameKeys(typed).jamo;
    const found = keyed.filter(({ it, k }) => (q || !it.searchOnly) && match(k));
    if (!q) return found.map((x) => x.it);
    const rank = (k: { jamo: string }) => (k.jamo === q ? 0 : k.jamo.startsWith(q) ? 1 : 2);
    return found.map((x, i) => [rank(x.k), i, x.it] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  }, [keyed, typed]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const restart = (q: string) => {
    setQuery(q);
    setActive(0);
    setLimit(STEP);
    setOpen(true);
  };

  const pick = (it: ComboItem | undefined) => {
    if (!it) return;
    onPick(it.key);
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="relative text-left">
      <SearchForm onSearch={() => open && pick(matches[active])}>
        <Input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && matches[active] ? `${id}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder={chosen ? chosen.name : placeholder}
          value={open ? query : chosen?.name ?? ""}
          onFocus={() => restart("")}
          onBlur={() => setOpen(false)}
          onChange={(e) => restart(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              const next = Math.max(0, Math.min(matches.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
              setActive(next);
              if (next >= limit) setLimit(limit + STEP);
            } else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
          enterKeyHint="search"
          className={`${chosen ? "pr-9" : ""} ${chosen && !open ? "font-semibold text-blue-700 dark:text-blue-300" : ""}`}
        />
      </SearchForm>
      {chosen && !open && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`${label} 지우기`}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs"
        >
          ✕
        </button>
      )}
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          // a press on the list must not blur the box before the pick lands
          onMouseDown={(e) => e.preventDefault()}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (limit < matches.length && el.scrollTop + el.clientHeight > el.scrollHeight - 200) setLimit(limit + STEP);
          }}
          className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
        >
          {loading ? (
            <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">불러오는 중…</li>
          ) : matches.length ? (
            matches.slice(0, limit).map((it, i) => (
              <li
                key={it.key}
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={it.key === value}
                onClick={() => pick(it)}
                onMouseEnter={() => setActive(i)}
                className={`px-3 py-2 flex items-center justify-between gap-3 text-sm cursor-pointer ${
                  i === active ? "bg-blue-50 dark:bg-gray-700" : ""
                } ${it.key === value ? "font-semibold text-blue-700 dark:text-blue-300" : ""}`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {it.tag && (
                    <span className="shrink-0 w-10 text-center rounded text-[11px] leading-5 font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      {it.tag}
                    </span>
                  )}
                  <span className="break-keep">{it.name}</span>
                </span>
                {it.sub && <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{it.sub}</span>}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{emptyText}</li>
          )}
        </ul>
      )}
    </div>
  );
}
