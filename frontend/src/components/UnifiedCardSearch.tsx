import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { Camera } from "lucide-react";
import SearchForm from "./SearchForm";
import ImageCardSearch from "./ImageCardSearch";
import { cardTag } from "@/lib/cardTag";
import type { ComboItem } from "./ComboBox";
import { EMPTY_FILTERS, listCards, type CardListItem } from "@/api/cardDexApi";
import { makeMatcher, matchRank, nameKeys } from "@/utils/hangul";

const GROUPS_SHOWN = 6;
const CARDS_SHOWN = 6;
const SHOWN = 10;
// among suggestions that answer the typing as closely, cards come first, then 카드군, then 서포트 (참혈 2026-10-14)
const KIND_ORDER = { card: 0, group: 1, support: 2 } as const;

type Suggestion = {
  key: string; name: string; tag: string; sub?: string; group?: ComboItem; card?: CardListItem;
  rank: number; kind: keyof typeof KIND_ORDER; order: number;
};

/** One box for the card book's name search and its 카드군·서포트 pick (/dev/cards, a trial — 참혈 2026-10-14). What is
 *  typed searches the card names when Enter is pressed (the list no longer follows the typing there, 참혈 10/14).
 *  Under the box drop down what matches the typing: the 카드군 and cards with a support list (name or 초성, the whole
 *  name, then its start, first) — picking one puts it in the box as a chip, the typing cleared — then the cards whose
 *  names match, as the card book's search ranks them, each tagged 몬스터 / 마법 / 함정 or its extra deck kind
 *  (참혈 2026-10-14) — picking one opens its page. Enter searches the names, or picks the suggestion marked with the
 *  arrow keys; Backspace in an empty box takes the chip off. The camera at the box's right end opens the drop-down on
 *  AI 이미지 검색 instead (ImageCardSearch, 참혈 2026-10-14); typing goes back to the suggestions. */
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
  const [imageSearch, setImageSearch] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // the image search stays open while the box is left (a file picker takes the focus): a press outside it closes it
  useEffect(() => {
    if (!imageSearch) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setImageSearch(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setImageSearch(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [imageSearch]);
  const [active, setActive] = useState(-1);   // -1: no suggestion marked, Enter searches the names
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const keyed = useMemo(() => items.map((it) => ({ it, k: nameKeys(it.name) })), [items]);
  const typed = useDeferredValue(query.trim());
  const groups = useMemo(() => {
    if (!nameKeys(typed).jamo) return [];
    const match = makeMatcher(typed);
    const rank = matchRank(typed);
    return keyed
      .filter(({ k }) => match(k))
      .map((x, i) => ({ it: x.it, rank: rank(x.k), order: i }))
      .sort((a, b) => a.rank - b.rank || a.order - b.order)
      .slice(0, GROUPS_SHOWN);
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

  // one list, the closest answers first whatever they are (참혈 2026-10-14); a card found by its Japanese or English
  // name counts as answering anywhere
  const suggestions: Suggestion[] = useMemo(() => {
    const rank = matchRank(typed);
    return [
      ...groups.map(({ it, rank, order }) => {
        const support = it.tag === "카드";
        return {
          key: it.key, name: it.name, tag: support ? "서포트" : "카드군", group: it, rank, order,
          kind: support ? "support" as const : "group" as const,
          sub: support ? it.sub?.replace(/^서포트\s*/, "") : it.sub,   // the tag already says 서포트: the count alone
        };
      }),
      ...(typed ? cards : []).map((c, i) => ({
        key: `card${c.id}`, name: c.name, tag: cardTag(c), card: c, rank: rank(nameKeys(c.name)), kind: "card" as const, order: i,
      })),
    ]
      .sort((a, b) => a.rank - b.rank || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.order - b.order)
      .slice(0, SHOWN);
  }, [groups, cards, typed]);
  const shown = open && !imageSearch && suggestions.length > 0;

  const pick = (it: Suggestion) => {
    if (it.group) onPick(it.group.key);
    else if (it.card) onPickCard(it.card.id);
    setOpen(false);
    setActive(-1);
    input.current?.blur();
  };

  return (
    <div ref={root} className="relative text-left">
      <SearchForm
        onSearch={() => {
          if (shown && suggestions[active]) pick(suggestions[active]);
          else {
            onSubmit();
            setOpen(false);
          }
        }}
      >
        <div className="flex items-center gap-1.5 h-9 w-full rounded-md border border-input bg-transparent pl-1.5 pr-1 shadow-sm focus-within:ring-1 focus-within:ring-ring">
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
              setImageSearch(false);
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
          <button
            type="button"
            onClick={() => {
              setImageSearch((v) => !v);
              setOpen(false);
            }}
            aria-label="사진으로 카드 찾기"
            aria-expanded={imageSearch}
            title="사진으로 카드 찾기"
            className={`shrink-0 w-8 h-7 grid place-items-center rounded-md transition ${
              imageSearch ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30" : "text-gray-500 dark:text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            <Camera size={18} aria-hidden />
          </button>
        </div>
      </SearchForm>
      {imageSearch && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          <ImageCardSearch
            onPickCard={(id) => {
              setImageSearch(false);
              onPickCard(id);
            }}
            onClose={() => setImageSearch(false)}
          />
        </div>
      )}
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
