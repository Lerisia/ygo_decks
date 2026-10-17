import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Camera, Redo2, Undo2 } from "lucide-react";
import SearchForm from "@/components/SearchForm";
import CardFilterBar from "@/components/CardFilterBar";
import CardSortControl from "@/components/CardSortControl";
import { ScanInfoRow, ScanState } from "@/components/ImageCardSearch";
import { EMPTY_FILTERS, getCardOptions, listCards, type CardFilters, type CardListItem, type CardOptions } from "@/api/cardDexApi";
import { barFilters, groupItems } from "@/lib/cardFilterBar";
import { CARD_SORTS, rememberSort, rememberedSort } from "@/lib/cardSorts";
import ComboBox from "@/components/ComboBox";
import { type BanRule, banOf } from "@/lib/banlists";
import { type DeckDraft, type DeckZone, COPIES_MAX, copiesOf } from "@/lib/deckDrafts";
import { usePressCard } from "@/hooks/usePressCard";
import { MOUSE_QUERY, draggingDeckCard, droppedDeckCard, startCardDrag } from "@/lib/deckDrag";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { type ScanFound, useImageScan } from "@/hooks/useImageScan";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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
 *  초성), the newest cards first; a card pressed goes into the deck (onPick). With it, as in /dev/cards' search
 *  (참혈 2026-10-15): the filter chips a size smaller, and the 카드군·서포트 picked in the card book's own search
 *  drop-down (엘리스 2026-10-18: the same search as the book, the chips that answered the typing gone). From lg the
 *  box, the 카드군·서포트, the chips and the cards go down in that order; below lg they go up from the box: the chips,
 *  the 카드군·서포트 (its matches opening upward), the cards. Cards whose name is in the deck 3 times,
 *  and tokens, are dimmed. notice: a short line on why a card didn't go in. From lg it stands to the right of the
 *  deck, as tall as the screen. On phones and tablets it floats over the bottom of the deck (참혈 2026-10-13): a
 *  rounded see-through card, the box at its bottom and the results one row above it, the row folded away until
 *  something is typed. The page keeps DECK_EDITOR_ROOM under the deck for it at its tallest. With the keyboard up it
 *  rides on top of the keyboard, gliding up and down with it, and pressing the box does not scroll the page to it
 *  (참혈 2026-10-14). The camera right of the box, on a blue ground (참혈 2026-10-17), turns it to AI 이미지 검색, as in /dev/cards (참혈 2026-10-16):
 *  the chips and the 카드군·서포트 make way for one row with the picture, how many cards were read and 다른 사진, and
 *  the cards read take the cards' place, pressed to leave them out of 전체 투입 (참혈 2026-10-17); typing goes back. The picture
 *  and its cards stay while the search goes back and forth. */
export type DeckUndo = { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };

const STEP_BUTTON = "w-7 h-7 p-0 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:text-gray-300 dark:disabled:text-gray-600 disabled:bg-white dark:disabled:bg-gray-800 disabled:cursor-not-allowed";

/** 되돌리기 · 다시 실행 for the deck being built (참혈 2026-10-16), at the end of the filter chip row. */
function UndoButtons({ canUndo, canRedo, onUndo, onRedo }: DeckUndo) {
  return (
    <span className="flex items-center gap-1">
      <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" className={STEP_BUTTON}>
        <Undo2 className="w-4 h-4" aria-hidden />
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" className={STEP_BUTTON}>
        <Redo2 className="w-4 h-4" aria-hidden />
      </button>
    </span>
  );
}

export default function CardSearchPanel({ deck, cards, rule, onPick, onPickAll, onShow, onDropOut, notice, ready, history, overlay, picture = 0 }: {
  deck: Pick<DeckDraft, DeckZone>;
  cards: Map<number, CardListItem>;
  /** The deck's 금제 (참혈 2026-10-16): each card's mark. */
  rule?: BanRule;
  /** `from`: the tile pressed, for the card to fly from it (lib/deckMotion). */
  onPick: (card: CardListItem, from?: Element) => void;
  /** 전체 투입: every card a picture held, each as many times as it held it (참혈 2026-10-17). */
  onPickAll?: (found: ScanFound[]) => void;
  /** A card held (a finger) or clicked (a mouse) is shown. */
  onShow?: (card: CardListItem) => void;
  /** A copy of the deck dragged here with a mouse comes out, as Master Duel's PC editor has it (엘리스 2026-10-18). */
  onDropOut?: (zone: DeckZone, at: number) => void;
  notice: string;
  /** false while the deck's own cards are still coming (their names count toward 3). */
  ready: boolean;
  history?: DeckUndo;
  /** From lg, what takes the search's place for a while (a card shown, 참혈 2026-10-16): the search stays as it was
   *  underneath — its typing, chips and scroll — for when it goes. */
  overlay?: ReactNode;
  /** Counted up by the page to open the picture search and ask for a picture at once (the big 사진으로 덱 넣기 on an
   *  empty deck, the board's 사진으로 올리기; 엘리스 2026-10-18). */
  picture?: number;
}) {
  const press = usePressCard();
  const mouse = useMediaQuery(MOUSE_QUERY);
  // a copy of the deck being dragged over the search, to come out (counted in and out of the children)
  const [dropping, setDropping] = useState(0);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<CardOptions | null>(null);
  const [bar, setBar] = useState(() => barFilters({}));
  // the sort and its way, remembered with the card book's (엘리스 2026-10-18: one search, one filter, one sort)
  const [sorting, setSorting] = useState(() => rememberedSort(CARD_SORTS) ?? { sort: "new", dir: "" });
  const pickSort = (patch: Partial<typeof sorting>) => {
    const next = { ...sorting, ...patch };
    rememberSort(next);
    setSorting(next);
  };
  const [chosen, setChosen] = useState("");   // a 카드군 (g12) or a card's support list (c34) picked in the drop-down
  const [found, setFound] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const results = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const keyboard = useKeyboardInset(box);
  const [imaging, setImaging] = useState(false);
  const scan = useImageScan(imaging);
  // a picture asked for from outside: the picture search opens, and once its file box is there it is clicked (still
  // within the press that asked, so the browser lets it)
  const asked = useRef(0);
  const choosing = useRef(false);
  useEffect(() => {
    if (picture === asked.current) return;
    asked.current = picture;
    choosing.current = true;
    setImaging(true);
    box.current?.blur();
  }, [picture]);
  useEffect(() => {
    if (!imaging || !choosing.current) return;
    choosing.current = false;
    scan.choose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imaging]);
  // the cards read that 전체 투입 leaves out, pressed to keep them out (참혈 2026-10-17); a new picture starts with none
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  useEffect(() => setSkipped(new Set()), [scan.found]);
  const toPut = scan.found.filter((f) => !skipped.has(f.card.id));
  const putCount = toPut.reduce((n, f) => n + f.count, 0);
  const wide = useMediaQuery("(min-width: 1024px)");

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
  useEffect(() => {
    getCardOptions().then(setOptions).catch(() => setOptions(null));
  }, []);
  const items = useMemo(() => groupItems(options), [options]);
  const narrowed = JSON.stringify([bar, sorting]);   // the chips and the sort, as one key for the search to follow
  const filters: CardFilters = {
    ...EMPTY_FILTERS, ...bar, ...sorting, q,
    group: chosen[0] === "g" ? chosen.slice(1) : "", card: chosen[0] === "c" ? chosen.slice(1) : "",
  };
  const searching = !!(q || chosen || Object.values(bar).some(Boolean));
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
        setFound(r.results);
        setTotal(r.total);
        setPage(1);
        setHasMore(r.has_more);
        results.current?.scrollTo({ top: 0, left: 0 });
      })
      .catch((e) => id === request.current && e.name !== "AbortError" && setError("검색하지 못했습니다."))
      .finally(() => id === request.current && setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, narrowed, chosen]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    const id = request.current;
    setLoading(true);
    listCards(filters, page + 1)
      .then((r) => {
        if (id !== request.current) return;
        setFound((prev) => [...prev, ...r.results]);
        setPage(page + 1);
        setHasMore(r.has_more);
      })
      .catch(() => id === request.current && setError("더 불러오지 못했습니다."))
      .finally(() => id === request.current && setLoading(false));
  };

  // a card found: pressed it goes in, held or right-clicked it is shown; n/3 once the deck holds it — the deck's 금제
  // keeps none out (참혈 2026-10-17), its mark in the corner says it. A card read from a picture (scanned) is pressed
  // instead to leave it out of 전체 투입 or take it back, see-through while left out, and says how many the picture
  // held at its bottom right, after n/3 (참혈 2026-10-17).
  const tile = (c: CardListItem, scanned?: { times: number; skipped: boolean }) => {
    const n = copiesOf(deck, c.name, cards);
    const out = n >= COPIES_MAX || c.frame === "token";
    const onPress = scanned
      ? () => setSkipped((was) => {
          const next = new Set(was);
          if (!next.delete(c.id)) next.add(c.id);
          return next;
        })
      : (el: HTMLElement) => ready && onPick(c, el);
    return (
      <button
        key={c.id}
        type="button"
        {...press(onPress, () => onShow?.(c), !!scanned)}
        // a mouse drags it onto the deck (엘리스 2026-10-18: as the game's PC editor)
        draggable={mouse && !scanned && !out && ready}
        onDragStart={(e) => startCardDrag(e, c)}
        aria-disabled={scanned ? undefined : out || !ready}
        aria-pressed={scanned ? !scanned.skipped : undefined}
        title={scanned ? `${c.name} (눌러서 ${scanned.skipped ? "다시 투입" : "투입에서 빼기"}, 길게 누르면 보기)`
          : mouse ? `${c.name} (오른쪽 클릭이나 끌어서 넣기, 눌러서 보기)` : c.name}
        aria-label={scanned ? `${c.name} ${scanned.skipped ? "다시 투입" : "투입에서 빼기"}` : `${c.name} 넣기`}
        className={`group block text-center ${TILE} ${out && !scanned ? "cursor-not-allowed" : ""} ${mouse && !scanned && !out ? "card-lift" : ""}`}
      >
        <span className="relative block">
          <DeckCardFace card={c} dim={scanned ? scanned.skipped : out} ban={banOf(c, rule)} rule={rule} />
          {(n > 0 || (scanned && scanned.times > 1)) && (
            <span className={`absolute bottom-1 right-1 flex items-center gap-0.5 ${scanned?.skipped ? "opacity-40" : ""}`}>
              {n > 0 && <span className="rounded px-1 text-[10px] leading-4 font-bold bg-black/75 text-white tabular-nums">{n}/{COPIES_MAX}</span>}
              {scanned && scanned.times > 1 && (
                <span className="rounded px-1 text-[10px] leading-4 font-bold bg-blue-600/90 text-white tabular-nums">×{scanned.times}</span>
              )}
            </span>
          )}
        </span>
        <span className={`hidden lg:block mt-0.5 h-8 text-[11px] leading-4 line-clamp-2 break-keep ${scanned?.skipped ? "opacity-40" : ""}`}>{c.name}</span>
      </button>
    );
  };

  // the parts are in their desktop order; below lg, order-* stacks them up from the box: the chips, the 카드군·서포트,
  // the cards, and on top the line saying why a card didn't go in
  return (
    <aside
      aria-label="카드 검색"
      onDragEnter={(e) => draggingDeckCard(e) && setDropping((n) => n + 1)}
      onDragOver={(e) => {
        if (!draggingDeckCard(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => draggingDeckCard(e) && setDropping((n) => Math.max(0, n - 1))}
      onDrop={(e) => {
        setDropping(0);
        const copy = droppedDeckCard(e);
        if (!copy) return;
        e.preventDefault();
        onDropOut?.(copy.zone, copy.at);
      }}
      // above the keyboard while it is up, else above the bottom edge (and the home bar); gliding as the keyboard does
      style={{
        "--float-bottom": keyboard.inset ? `${keyboard.inset + 8}px` : "calc(0.75rem + env(safe-area-inset-bottom))",
        transition: keyboard.glide ? "bottom 250ms cubic-bezier(0.2, 0.8, 0.2, 1)" : undefined,
      } as CSSProperties}
      className={`fixed inset-x-3 sm:inset-x-4 bottom-[var(--float-bottom)] z-40 mx-auto max-w-3xl flex flex-col gap-1.5 rounded-2xl border border-gray-200/80 dark:border-gray-600/60 bg-white/75 dark:bg-gray-800/75 backdrop-blur-md shadow-xl p-2.5
        lg:absolute lg:inset-0 lg:z-auto lg:mx-0 lg:max-w-none lg:gap-0 lg:rounded-xl lg:border-gray-200 lg:dark:border-gray-700 lg:bg-white lg:dark:bg-gray-800 lg:backdrop-blur-none lg:shadow-none lg:p-3 ${dropping ? "ring-2 ring-red-400/70" : ""}`}
    >
      {overlay && <div className="hidden lg:block absolute inset-0 z-10 rounded-xl bg-white dark:bg-gray-800 p-3 pt-2">{overlay}</div>}
      {/* hidden, not taken away, while something stands in its place */}
      <div className={`contents ${overlay ? "lg:invisible" : ""}`}>
      {/* no 「카드 검색」 title over it: the box's placeholder says as much (참혈 2026-10-16) */}
      {/* the box, and at its right outside it the camera on a coloured ground, easier to see than an icon in the box
          (참혈 2026-10-17) */}
      <div className="order-5 flex items-center gap-1.5 lg:order-none">
        <SearchForm onSearch={() => setQ(qInput.trim())}>
          <div className="min-w-0 flex-1 flex items-center gap-1.5 h-10 lg:h-9 rounded-lg border border-input bg-white dark:bg-gray-900 pl-3 pr-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <input
              ref={box}
              aria-label="카드 검색"
              placeholder="카드 검색"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                setImaging(false);
              }}
              enterKeyHint="search"
              className="min-w-0 flex-1 h-full bg-transparent text-base md:text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </SearchForm>
        <button
          type="button"
          onClick={() => {
            setImaging((v) => !v);
            box.current?.blur();
          }}
          aria-label={imaging ? "사진 검색 닫기" : "사진으로 카드 찾기"}
          aria-pressed={imaging}
          title={imaging ? "사진 검색 닫기" : "사진으로 카드 찾기"}
          // while the picture search is open: gray, a ← to go back to the search (참혈 2026-10-17)
          className={`shrink-0 w-10 h-10 lg:w-9 lg:h-9 p-0 border-0 grid place-items-center rounded-lg text-white shadow-sm transition ${
            imaging ? "bg-gray-500 hover:bg-gray-600" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {imaging ? <ArrowLeft size={18} aria-hidden /> : <Camera size={18} aria-hidden />}
        </button>
      </div>
      {/* the card book's own filter bar and sort, a size smaller (엘리스 2026-10-18: the same search filters the same way);
          the sort at the row's right end below lg, and from lg on the line that counts the cards (참혈 2026-10-18), the
          column being too narrow for it beside the chips */}
      <div className={`order-4 dex-compact lg:order-none lg:mt-2 ${imaging ? "hidden" : ""}`}>
        <CardFilterBar
          options={options}
          filters={bar}
          onChange={(f) => setBar({ ...bar, ...f })}
          right={
            <div className="flex items-center gap-1.5">
              <span className="lg:hidden"><CardSortControl sorts={CARD_SORTS} filters={{ ...sorting, q }} onChange={pickSort} compact /></span>
              {history && <UndoButtons {...history} />}
            </div>
          }
        />
      </div>
      {imaging && scan.status.kind === "done" && (
        <ScanInfoRow
          scan={scan}
          compact={wide}
          // 전체 투입, or 「n장 투입」 once some are left out (참혈 2026-10-17)
          add={onPickAll && { label: skipped.size ? `${putCount}장 투입` : "전체 투입", count: putCount, onClick: () => ready && onPickAll(toPut) }}
          className="order-3 shrink-0 h-8 px-0.5 lg:order-none lg:mt-2 lg:h-9 lg:px-0 lg:border-b lg:border-gray-100 lg:dark:border-gray-700" />
      )}
      {/* the 카드군·서포트 as the card book picks them (엘리스 2026-10-18): the book's own search drop-down, its matches
          opening upward below lg where the box stands at the foot of the screen */}
      {!imaging && (
        <div className="order-3 lg:order-none lg:mt-1.5">
          <ComboBox
            label="카드군·서포트"
            placeholder="카드군·카드 서포트 검색 (이름·초성)"
            items={items}
            value={chosen}
            onPick={setChosen}
            onClear={() => setChosen("")}
            emptyText="맞는 카드군·카드가 없습니다."
            loading={!options}
            up={!wide}
          />
        </div>
      )}
      <div
        className={`order-1 h-5 px-0.5 text-xs lg:order-none lg:mt-1.5 lg:h-7 lg:px-0 lg:flex lg:items-center lg:gap-2 ${notice || (error && !imaging) ? "" : "hidden"}`}
      >
        <p className="m-0 min-w-0 flex-1 truncate" aria-live="polite">
          {notice ? (
            <span className="text-red-600 dark:text-red-400">{notice}</span>
          ) : imaging ? null : error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : (
            total !== null && <span className="text-gray-500 dark:text-gray-400 tabular-nums">카드 {total.toLocaleString()}장</span>
          )}
        </p>
        {!imaging && (
          <span className="hidden lg:block shrink-0">
            <CardSortControl sorts={CARD_SORTS} filters={{ ...sorting, q }} onChange={pickSort} compact />
          </span>
        )}
      </div>
      {imaging ? (
        <div className={`order-2 ${ROW} flex flex-col lg:order-none lg:mt-1 lg:flex-1 lg:min-h-0`} {...scan.drop}>
          <input {...scan.fileInput} />
          <ScanState scan={scan} small={!wide} className="flex-1 min-h-0" />
          {scan.status.kind === "done" && (
            scan.found.length ? (
              <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden overscroll-contain lg:overflow-x-hidden lg:overflow-y-auto">
                <div className="flex gap-1.5 w-max lg:w-auto lg:grid lg:grid-cols-3 lg:gap-2">{scan.found.map(({ card, count }) => tile(card, { times: count, skipped: skipped.has(card.id) }))}</div>
              </div>
            ) : (
              <p className="flex-1 m-0 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">사진에서 카드를 찾지 못했습니다.</p>
            )
          )}
        </div>
      ) : (
      <div
        ref={results}
        className={`order-2 ${noMatch ? "h-8" : ROW} overflow-x-auto overflow-y-hidden overscroll-contain lg:order-none lg:mt-1 lg:flex-1 lg:min-h-0 lg:h-auto lg:overflow-x-hidden lg:overflow-y-auto ${
          searching ? "" : "hidden lg:block"
        }`}
      >
        {noMatch ? (
          <p className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 lg:h-auto lg:py-10">맞는 카드가 없습니다.</p>
        ) : (
          <div
            className={`flex gap-1.5 w-max lg:w-auto lg:grid lg:grid-cols-3 lg:gap-2 transition-opacity ${
              loading && page === 1 && found.length ? "opacity-50" : ""
            }`}
          >
            {found.map((c) => tile(c))}
            {loading && (page > 1 || !found.length) && Array.from({ length: 12 }, (_, i) => <TileSkeleton key={`s${i}`} />)}
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
      )}
      </div>
    </aside>
  );
}
