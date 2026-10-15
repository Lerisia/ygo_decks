import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Camera } from "lucide-react";
import SearchForm from "./SearchForm";
import ImageCardSearch from "./ImageCardSearch";
import { cardTag } from "@/lib/cardTag";
import { type RecentSearch, clearRecent, forgetSearch, loadRecent, recentId, rememberSearch } from "@/lib/recentCardSearches";
import type { ComboItem } from "./ComboBox";
import { EMPTY_FILTERS, listCards, type CardFilters, type CardListItem } from "@/api/cardDexApi";
import { chipQuery, useGroupSuggestions } from "@/hooks/useGroupSuggestions";
import { orderSuggestions, type RankedSuggestion } from "@/lib/suggestionOrder";
import { matchRank, nameKeys } from "@/utils/hangul";

const GROUPS_SHOWN = 6;
const CARDS_SHOWN = 6;
const SHOWN = 10;
type Suggestion = RankedSuggestion & {
  key: string; name: string; tag: string; sub?: string; group?: ComboItem; card?: CardListItem;
};

/** One box for the card book's name search and its 카드군·서포트 pick (/dev/cards, a trial — 참혈 2026-10-14). What is
 *  typed searches the card names when Enter is pressed (the list no longer follows the typing there, 참혈 10/14).
 *  Under the box drop down what matches the typing: the 카드군 and cards with a support list (name or 초성, the whole
 *  name, then its start, first) — picking one puts it in the box as a chip, the typing cleared — then the cards whose
 *  names match, as the card book's search ranks them, each tagged 몬스터 / 마법 / 함정 or its extra deck kind
 *  (참혈 2026-10-14) — picking one opens its page. Enter searches the names, or picks the suggestion marked with the
 *  arrow keys; Backspace in an empty box takes the chip off. The camera at the box's right end opens the drop-down on
 *  AI 이미지 검색 instead (ImageCardSearch, 참혈 2026-10-14); typing goes back to the suggestions. The filter chips
 *  narrow the suggestions too: the cards are searched under them, and a 카드군 or support list shows only with cards
 *  left, counted under them (참혈 2026-10-14). */
export default function UnifiedCardSearch({ query, onQueryChange, onSubmit, items, chosen, onPick, onPickCard, onClear, filterBar, filters, onSearchText }: {
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
  /** the card book's filter chips, drawn a size smaller at the top of the drop-down (참혈 2026-10-14) */
  filterBar?: ReactNode;
  /** what the chips have set, to narrow the suggestions */
  filters?: CardFilters;
  /** a recent search picked again: its words put back in the box and searched */
  onSearchText?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [imageSearch, setImageSearch] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // the box and its drop-down, and the filter chips' popups, which DexFilterBar puts at the page's end
  const inside = (t: EventTarget | null) =>
    !!root.current?.contains(t as Node) || !!(t instanceof Element && t.closest("[data-dex-overlay]"));
  // the image search stays open while the box is left (a file picker takes the focus): a press outside it closes it
  useEffect(() => {
    if (!imageSearch) return;
    const away = (e: MouseEvent) => !inside(e.target) && setImageSearch(false);
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
  const typed = useDeferredValue(query.trim());
  const chips = chipQuery(filters);
  const groups = useGroupSuggestions(items, typed, chips, GROUPS_SHOWN);

  // the cards come from the server's name search under the chips, a moment after the typing stops
  const [cards, setCards] = useState<CardListItem[]>([]);
  useEffect(() => {
    if (!typed) {
      setCards([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      listCards({ ...EMPTY_FILTERS, ...Object.fromEntries(new URLSearchParams(chips)), q: typed }, 1, ctrl.signal)
        .then((r) => setCards(r.results.slice(0, CARDS_SHOWN)))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [typed, chips]);

  // one list in orderSuggestions' order (the closest 카드군·서포트 on top, under cards named exactly, 참혈 2026-10-15);
  // a card found by its Japanese or English name counts as answering anywhere
  const suggestions: Suggestion[] = useMemo(() => {
    const rank = matchRank(typed);
    return orderSuggestions<Suggestion>([
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
    ], SHOWN);
  }, [groups, cards, typed]);
  // with the box empty, the recent searches in place of the suggestions (참혈 2026-10-14)
  const [recent, setRecent] = useState<RecentSearch[]>(loadRecent);
  const showingRecent = !query.trim();
  const rows: { key: string; name: string; tag: string; sub?: string; go: () => void; forget?: () => void }[] = showingRecent
    ? recent.map((r) => ({
        key: recentId(r),
        name: r.kind === "q" ? r.text : r.name,
        tag: r.kind === "q" ? "검색" : r.tag,
        go: () => (r.kind === "q" ? onSearchText?.(r.text) : r.kind === "group" ? onPick(r.key) : onPickCard(r.id)),
        forget: () => setRecent(forgetSearch(recentId(r))),
      }))
    : suggestions.map((it) => ({ key: it.key, name: it.name, tag: it.tag, sub: it.sub, go: () => pickSuggestion(it) }));
  // the drop-down opens with the box: the chips always, then the suggestions or the recent searches
  const shown = open && !imageSearch;

  const close = () => {
    setOpen(false);
    setActive(-1);
    input.current?.blur();
  };
  const pickSuggestion = (it: Suggestion) => {
    if (it.group) {
      setRecent(rememberSearch({ kind: "group", key: it.group.key, name: it.name, tag: it.tag }));
      onPick(it.group.key);
    } else if (it.card) {
      setRecent(rememberSearch({ kind: "card", id: it.card.id, name: it.name, tag: it.tag }));
      onPickCard(it.card.id);
    }
  };
  const go = (i: number) => {
    const row = rows[i];
    if (!row) return;
    row.go();
    close();
  };
  // a press anywhere outside closes it (the chips' own menus sit inside, so the box may lose the focus to them)
  useEffect(() => {
    if (!shown) return;
    const away = (e: MouseEvent) => !inside(e.target) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [shown]);

  return (
    <div ref={root} className="relative text-left">
      <SearchForm
        onSearch={() => {
          if (shown && rows[active]) go(active);
          else {
            const q = query.trim();
            if (q) setRecent(rememberSearch({ kind: "q", text: q }));
            onSubmit();
            close();
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
            aria-activedescendant={shown && active >= 0 && rows[active] ? `${id}-${active}` : undefined}
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
            onClick={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (!rows.length) return;
                e.preventDefault();
                setOpen(true);
                setActive(Math.max(-1, Math.min(rows.length - 1, active + (e.key === "ArrowDown" ? 1 : -1))));
              } else if (e.key === "Escape") {
                close();
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
        <div
          // a press inside must not take the focus from the box before it lands (the chips' menus keep theirs)
          onMouseDown={(e) => e.target instanceof HTMLElement && !e.target.closest("input, select, textarea") && e.preventDefault()}
          className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
        >
          {/* the filter chips where the Enter hint was, a size smaller, working as on the page (참혈 2026-10-14) */}
          {filterBar && <div className="dex-compact px-2 pt-1 pb-1.5 border-b border-gray-100 dark:border-gray-700">{filterBar}</div>}
          {showingRecent && (
            <div className="px-3 pt-1.5 pb-0.5 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
              <span>최근 검색</span>
              {recent.length > 0 && (
                <button type="button" onClick={() => setRecent(clearRecent())} className="h-5 px-1 rounded hover:text-gray-800 dark:hover:text-gray-200">
                  기록 지우기
                </button>
              )}
            </div>
          )}
          {rows.length ? (
            <ul id={`${id}-list`} role="listbox" aria-label={showingRecent ? "최근 검색" : "검색 추천"}>
              {rows.map((it, i) => (
                <li
                  key={it.key}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onClick={() => go(i)}
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
                  {it.forget && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        it.forget?.();
                      }}
                      aria-label={`${it.name} 기록 지우기`}
                      className="shrink-0 w-6 h-6 -mr-1 rounded text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              {showingRecent ? "최근 검색 기록이 없습니다." : "맞는 추천이 없습니다. Enter로 카드 이름을 검색합니다."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
