import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import SearchForm from "@/components/SearchForm";
import { EMPTY_FILTERS, listCards, type CardFilters, type CardListItem } from "@/api/cardDexApi";
import { type DeckDraft, type DeckZone, copiesAllowed, copiesOf } from "@/lib/deckDrafts";
import { usePressCard } from "@/hooks/usePressCard";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { DeckCardFace } from "./DeckZones";

// Below lg the results are one row that scrolls sideways (a card 64px wide on a phone, 72px on a tablet, the row a
// little taller for the scroll bar); from lg a grid of three that scrolls down.
const ROW = "h-24 sm:h-[108px] lg:h-auto";
const TILE = "w-16 sm:w-[72px] shrink-0 lg:w-auto";

function TileSkeleton() {
  return (
    <div className={TILE}>
      <div className="w-full aspect-[704/1024] card-corner bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="hidden lg:flex mt-0.5 h-8 items-start justify-center">
        <div className="mt-1 h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
    </div>
  );
}

/** The card search beside a deck being built: the card book's own search (names in Korean, Japanese or English, or
 *  초성), the newest cards first; a card pressed goes into the deck (onPick). Cards whose name is in the deck 3 times,
 *  and tokens, are dimmed. notice: a short line on why a card didn't go in. From lg it stands to the right of the
 *  deck, as tall as the screen. On phones and tablets it floats over the bottom of the deck (참혈 2026-10-13): a
 *  rounded see-through card, the box at its bottom and the results one row above it, the row folded away until
 *  something is typed. The page keeps DECK_EDITOR_ROOM under the deck for it at its tallest. With the keyboard up it
 *  rides on top of the keyboard, gliding up and down with it, and pressing the box does not scroll the page to it
 *  (참혈 2026-10-14). */
export default function CardSearchPanel({ deck, cards, onPick, onShow, notice, ready }: {
  deck: Pick<DeckDraft, DeckZone>;
  cards: Map<number, CardListItem>;
  onPick: (card: CardListItem) => void;
  /** A card held (phone) or right-clicked (computer) is shown. */
  onShow?: (card: CardListItem) => void;
  notice: string;
  /** false while the deck's own cards are still coming (their names count toward 3). */
  ready: boolean;
}) {
  const press = usePressCard();
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const results = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const keyboard = useKeyboardInset(box);

  // A tap on the box lets the browser scroll the page to it, which below lg throws the deck far down. The tap is
  // taken over and the box focused without that scroll; a swipe that starts on the box stays a swipe. The page still
  // rises as the keyboard comes up, as the browser moves it (참혈 2026-10-14).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const tap = start && t && Math.abs(t.clientX - start.x) < 10 && Math.abs(t.clientY - start.y) < 10;
      if (!tap || document.activeElement === el || window.matchMedia("(min-width: 1024px)").matches) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, []);
  const filters: CardFilters = { ...EMPTY_FILTERS, q, sort: "new" };
  const noMatch = !loading && total === 0;

  // the results follow the typing a moment after it stops, as in the card book
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 150);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const id = ++request.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    listCards(filters, 1, ctrl.signal)
      .then((r) => {
        if (id !== request.current) return;
        setItems(r.results);
        setTotal(r.total);
        setPage(1);
        setHasMore(r.has_more);
        results.current?.scrollTo({ top: 0, left: 0 });
      })
      .catch((e) => id === request.current && e.name !== "AbortError" && setError("검색하지 못했습니다."))
      .finally(() => id === request.current && setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    const id = request.current;
    setLoading(true);
    listCards(filters, page + 1)
      .then((r) => {
        if (id !== request.current) return;
        setItems((prev) => [...prev, ...r.results]);
        setPage(page + 1);
        setHasMore(r.has_more);
      })
      .catch(() => id === request.current && setError("더 불러오지 못했습니다."))
      .finally(() => id === request.current && setLoading(false));
  };

  // the parts are in their desktop order; below lg, order-* puts the results first, the line next, the box last
  return (
    <aside
      aria-label="카드 검색"
      // above the keyboard while it is up, else above the bottom edge (and the home bar); gliding as the keyboard does
      style={{
        "--float-bottom": keyboard.inset ? `${keyboard.inset + 8}px` : "calc(0.75rem + env(safe-area-inset-bottom))",
        transition: keyboard.glide ? "bottom 250ms cubic-bezier(0.2, 0.8, 0.2, 1)" : undefined,
      } as CSSProperties}
      className={`fixed inset-x-3 sm:inset-x-4 bottom-[var(--float-bottom)] z-40 mx-auto max-w-3xl flex flex-col gap-1.5 rounded-2xl border border-gray-200/80 dark:border-gray-600/60 bg-white/75 dark:bg-gray-800/75 backdrop-blur-md shadow-xl p-2.5
        lg:absolute lg:inset-0 lg:z-auto lg:mx-0 lg:max-w-none lg:gap-0 lg:rounded-xl lg:border-gray-200 lg:dark:border-gray-700 lg:bg-white lg:dark:bg-gray-800 lg:backdrop-blur-none lg:shadow-none lg:p-3`}
    >
      <h2 className="hidden lg:block m-0 text-base font-bold">카드 검색</h2>
      <div className="order-3 lg:order-none lg:mt-2">
        <SearchForm onSearch={() => setQ(qInput.trim())}>
          <Input
            ref={box}
            placeholder="카드 이름 검색 (한국어·일본어·영어·초성)"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            enterKeyHint="search"
            className="h-10 rounded-lg bg-white dark:bg-gray-900 lg:h-9 lg:dark:bg-transparent"
          />
        </SearchForm>
      </div>
      <p
        className={`order-2 h-5 px-0.5 text-xs truncate lg:order-none lg:mt-1 lg:px-0 ${notice || error ? "" : "hidden lg:block"}`}
        aria-live="polite"
      >
        {notice ? (
          <span className="text-red-600 dark:text-red-400">{notice}</span>
        ) : error ? (
          <span className="text-red-600 dark:text-red-400">{error}</span>
        ) : (
          total !== null && <span className="text-gray-500 dark:text-gray-400 tabular-nums">카드 {total.toLocaleString()}장</span>
        )}
      </p>
      <div
        ref={results}
        className={`order-1 ${noMatch ? "h-8" : ROW} overflow-x-auto overflow-y-hidden overscroll-contain lg:order-none lg:mt-1 lg:flex-1 lg:min-h-0 lg:h-auto lg:overflow-x-hidden lg:overflow-y-auto ${
          q ? "" : "hidden lg:block"
        }`}
      >
        {noMatch ? (
          <p className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 lg:h-auto lg:py-10">맞는 카드가 없습니다.</p>
        ) : (
          <div
            className={`flex gap-1.5 w-max lg:w-auto lg:grid lg:grid-cols-3 lg:gap-2 transition-opacity ${
              loading && page === 1 && items.length ? "opacity-50" : ""
            }`}
          >
            {items.map((c) => {
              const n = copiesOf(deck, c.name, cards);
              const most = copiesAllowed(c);   // 3, or fewer on today's 금제
              const out = n >= most || c.frame === "token";
              return (
                <button
                  key={c.id}
                  type="button"
                  {...press(() => ready && onPick(c), () => onShow?.(c))}
                  aria-disabled={out || !ready}
                  title={c.name}
                  aria-label={`${c.name} 넣기`}
                  className={`group block text-center ${TILE} ${out ? "cursor-not-allowed" : ""}`}
                >
                  <span className="relative block">
                    <DeckCardFace card={c} dim={out} />
                    {n > 0 && (
                      <span className="absolute bottom-1 right-1 rounded px-1 text-[10px] leading-4 font-bold bg-black/75 text-white tabular-nums">
                        {n}/{most}
                      </span>
                    )}
                  </span>
                  <span className="hidden lg:block mt-0.5 h-8 text-[11px] leading-4 line-clamp-2 break-keep">{c.name}</span>
                </button>
              );
            })}
            {loading && (page > 1 || !items.length) && Array.from({ length: 12 }, (_, i) => <TileSkeleton key={`s${i}`} />)}
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className={`${TILE} aspect-[704/1024] lg:aspect-auto lg:col-span-3 lg:h-9 lg:mt-1 rounded-lg font-semibold text-sm break-keep transition bg-gray-500 hover:bg-gray-600 text-white disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed`}
              >
                더 보기
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
