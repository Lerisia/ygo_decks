import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import SearchForm from "./SearchForm";
import type { ComboItem } from "./ComboBox";
import { EMPTY_FILTERS, listCards, type CardListItem } from "@/api/cardDexApi";
import { makeMatcher, nameKeys } from "@/utils/hangul";

const GROUPS_SHOWN = 5;
const CARDS_SHOWN = 6;
const EXTRA_KINDS = [["fusion", "융합"], ["synchro", "싱크로"], ["xyz", "엑시즈"], ["link", "링크"]] as const;

/** A card's tag in the suggestions (참혈 2026-10-14): 몬스터 / 마법 / 함정, an extra deck monster by its kind. */
const cardTag = (c: Pick<CardListItem, "category" | "frame">) =>
  c.category === "spell" ? "마법" : c.category === "trap" ? "함정"
    : EXTRA_KINDS.find(([frame]) => c.frame.startsWith(frame))?.[1] ?? (c.frame === "token" ? "토큰" : "몬스터");

type Suggestion = { key: string; name: string; tag: string; sub?: string; group?: ComboItem; card?: CardListItem };

/** One box for the card book's name search and its 카드군·서포트 pick (/dev/cards, a trial — 참혈 2026-10-14). What is
 *  typed searches the card names when Enter is pressed (the list no longer follows the typing there, 참혈 10/14).
 *  Under the box drop down what matches the typing: the 카드군 and cards with a support list (name or 초성, the whole
 *  name, then its start, first) — picking one puts it in the box as a chip, the typing cleared — then the cards whose
 *  names match, as the card book's search ranks them, each tagged 몬스터 / 마법 / 함정 or its extra deck kind
 *  (참혈 2026-10-14) — picking one opens its page. Enter searches the names, or picks the suggestion marked with the
 *  arrow keys; Backspace in an empty box takes the chip off. */
export default function UnifiedCardSearch({ query, onQueryChange, onSubmit, items, chosen, onPick, onPickCard, onClear }: {
  query: string;
  onQueryChange: (q: string) => void;
  /** search the names at once (Enter) */
  onSubmit: () => void;
  items: ComboItem[];
  chosen: ComboItem | undefined;
  onPick: (key: string) => void;
  /** a card picked from the suggestions */
  onPickCard: (id: number) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);   // -1: no suggestion marked, Enter searches the names
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const keyed = useMemo(() => items.map((it) => ({ it, k: nameKeys(it.name) })), [items]);
  const typed = useDeferredValue(query.trim());
  const groups = useMemo(() => {
    const q = nameKeys(typed).jamo;
    if (!q) return [];
    const match = makeMatcher(typed);
    const rank = (k: { jamo: string }) => (k.jamo === q ? 0 : k.jamo.startsWith(q) ? 1 : 2);
    return keyed
      .filter(({ k }) => match(k))
      .map((x, i) => [rank(x.k), i, x.it] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, GROUPS_SHOWN)
      .map((x) => x[2]);
  }, [keyed, typed]);

  // the cards come from the server's name search a moment after the typing stops
  const [cards, setCards] = useState<CardListItem[]>([]);
  useEffect(() => {
    if (!typed) {
      setCards([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      listCards({ ...EMPTY_FILTERS, q: typed }, 1, ctrl.signal)
        .then((r) => setCards(r.results.slice(0, CARDS_SHOWN)))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [typed]);

  const suggestions: Suggestion[] = useMemo(() => [
    ...groups.map((g) => ({ key: g.key, name: g.name, tag: g.tag === "카드" ? "서포트" : "카드군", sub: g.sub, group: g })),
    ...(typed ? cards : []).map((c) => ({ key: `card${c.id}`, name: c.name, tag: cardTag(c), card: c })),
  ], [groups, cards, typed]);
  const shown = open && suggestions.length > 0;

  const pick = (it: Suggestion) => {
    if (it.group) onPick(it.group.key);
    else if (it.card) onPickCard(it.card.id);
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
            placeholder="카드 검색"
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
          aria-label="검색 추천"
          // a press on the list must not blur the box before the pick lands
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
        >
          <li className="px-3 pt-1 pb-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            Enter: 카드 이름으로 검색 · 카드군·서포트는 고르면 거르기, 카드는 문서 열기
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
                  {it.tag}
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
