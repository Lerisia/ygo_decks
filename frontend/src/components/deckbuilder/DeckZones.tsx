import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CardListItem } from "@/api/cardDexApi";
import { usePressCard } from "@/hooks/usePressCard";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { MOUSE_QUERY, draggedCardZone, droppedCard, startDeckCardDrag } from "@/lib/deckDrag";
import { cardFrom, flyOut, spotAt } from "@/lib/deckMotion";
import { useDeckFlip } from "@/hooks/useDeckFlip";
import CardKindTag from "@/components/CardKindTag";
import { type BanLimit, type BanRule, banOf, notOut, unreleasedUnder } from "@/lib/banlists";
import {
  type CardLook, type DeckDraft, type DeckLooks, type DeckZone, ZONES, ZONE_LABEL, copyRank, kindCounts, overLimit, sortedCopies,
} from "@/lib/deckDrafts";
import CopyFace from "./DeckFinish";

// While a deck is built each zone keeps room for this many rows of cards before any is in (참혈 2026-10-14): the main
// deck two on phones and tablets and three from lg, the extra deck one (deck-zone-reserve in index.css).
const RESERVE: Record<DeckZone, string> = { main: "[--rows:2] lg:[--rows:3]", extra: "[--rows:1]" };
const BAN_LABEL = { forbidden: "금지", limited: "제한", semi_limited: "준제한" } as const;
// a card held more often than the deck's 금제 allows, ringed by how it is limited (참혈 2026-10-17)
const OVER_RING: Record<BanLimit, string> = { forbidden: "ring-red-500", limited: "ring-orange-500", semi_limited: "ring-yellow-400" };

/** A card's picture as the card book draws it — a copy in the deck in its own print and finish (look, the finish
 *  moving: DeckFinish) — its 금제 in the corner: the deck's list's (ban), today's Master Duel one (on the card) when
 *  none is given; 미출시 in its place for a card not out under the rule (not in Master Duel, or not out yet by the
 *  list's day). */
export function DeckCardFace({ card, look, dim = false, ban = card.ban, rule }: { card: CardListItem; look?: CardLook | null; dim?: boolean; ban?: BanLimit | ""; rule?: BanRule }) {
  return (
    <span className="relative block">
      <CopyFace card={card} look={look} className="w-full aspect-[704/1024] object-contain card-corner" tone={`transition ${dim ? "opacity-40" : "group-hover:opacity-75"}`} />
      {unreleasedUnder(card, rule) || (rule && notOut(card, rule)) ? (
        <span className="absolute bottom-[7%] left-[4%] rounded px-1 py-px text-[10px] font-bold leading-4 bg-amber-500/90 text-white drop-shadow">미출시</span>
      ) : ban && (
        <img
          src={`/media/md_ui/info/limit/${ban}.webp`}
          alt={BAN_LABEL[ban]}
          className="absolute top-[3%] left-[4%] w-[22%] h-auto drop-shadow"
        />
      )}
    </span>
  );
}

function OverRing({ ban }: { ban?: BanLimit }) {
  return ban ? <span className={`absolute inset-0 card-corner ring-[3px] ring-inset ${OVER_RING[ban]} pointer-events-none`} /> : null;
}

const TILE_BLANK = "block w-full aspect-[704/1024] card-corner bg-gray-200 dark:bg-gray-700";

function Zone({ zone, ids, looks, order, cards, loading, rule, onRemove, onShow, reserve, picking, marks, mouse, lit }: {
  zone: DeckZone;
  /** as kept: an id once per copy, in the order they went in */
  ids: number[];
  looks: (CardLook | null)[];
  order: Map<number, number>;
  cards: Map<number, CardListItem>;
  loading: boolean;
  rule?: BanRule;
  /** `at`: the copy pressed, by its place in ids */
  onRemove?: (at: number) => void;
  onShow?: (card: CardListItem, at: number) => void;
  reserve: boolean;
  picking?: boolean;
  /** the 대표 카드 slot (1–3) of the copy at each place marked */
  marks?: Map<number, number>;
  /** a mouse: copies drag out, and the titles say so */
  mouse?: boolean;
  /** a card from the search is being dragged over the deck and belongs here */
  lit?: boolean;
}) {
  const counts = kindCounts(ids, cards);
  const press = usePressCard();
  // the cards move as the game's do while the deck is built (엘리스 2026-10-18): a new one flies in, the others slide
  const box = useRef<HTMLDivElement>(null);
  useDeckFlip(box, ids.join(","), !!onRemove);
  // every copy of a card over the deck's 금제 ringed in its colour, while it is built and on its page (참혈 2026-10-17);
  // a card not out yet then wears 미출시 (DeckCardFace); no count warnings by the title, the line under the name has
  // them (참혈 2026-10-16)
  const over = new Map(overLimit(ids, cards, rule).map((o) => [o.card.id, o.ban]));
  return (
    <section className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4 transition-shadow ${picking || lit ? "ring-2 ring-blue-500/70" : ""}`}>
      {/* the zone on the left, how many of each kind on the right, on a phone too (참혈 2026-10-16) */}
      <header className="mb-2 flex items-start justify-between gap-2 sm:gap-3">
        <h2 className="m-0 h-6 flex items-baseline gap-2 shrink-0 whitespace-nowrap text-base">
          <span className="font-bold">{ZONE_LABEL[zone]}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">{ids.length}장</span>
        </h2>
        <p className="m-0 min-w-0 min-h-6 flex flex-wrap items-center justify-end gap-x-1.5 sm:gap-x-2.5 gap-y-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300 tabular-nums">
          {loading && ids.length ? (
            <span className="inline-block h-3.5 w-44 rounded bg-gray-200 dark:bg-gray-700 animate-pulse align-middle" />
          ) : (
            // each kind tagged as the card search tags it, in its frame colour (참혈 2026-10-16)
            counts.map(({ label, count }) => (
              <span key={label} className="inline-flex items-center gap-0.5 sm:gap-1 whitespace-nowrap">
                <CardKindTag tag={label} compact />
                {count}장
              </span>
            ))
          )}
          {/* an empty zone's line still has a baseline, so the header is as tall as with cards in */}
          {!counts.length && !(loading && ids.length) && "\u200b"}
        </p>
      </header>
      {/* close together, as Master Duel lays out a deck (deck-zone in index.css) */}
      <div ref={box} className={`deck-zone ${reserve ? RESERVE[zone] : ""}`}>
      {ids.length ? (
        <div className={`deck-zone-grid ${reserve ? "deck-zone-reserve" : ""}`}>
          {/* each copy in the 디폴트 순, pressed or shown as itself: its look, its 대표 카드 mark (참혈 2026-10-16) */}
          {sortedCopies(ids, order).map((at) => {
            const id = ids[at];
            const card = cards.get(id);
            // keyed by the copy's rank among its card's, so a copy keeps its element (and its motion) as others go
            const flipKey = `${id}-${copyRank(ids, at)}`;
            if (!card) {
              return <span key={flipKey} data-flip={flipKey} className={`${TILE_BLANK} ${loading ? "animate-pulse" : ""}`} />;
            }
            const mark = marks?.get(at);
            return onRemove ? (
              <button
                key={flipKey}
                data-flip={flipKey}
                type="button"
                {...press((el) => {
                  if (!picking) flyOut(el);   // the copy flies back toward the search as it goes
                  onRemove(at);
                }, () => onShow?.(card, at), picking)}
                // a mouse drags a copy out, onto the search (엘리스 2026-10-18: as the game's PC editor)
                draggable={mouse && !picking}
                onDragStart={(e) => startDeckCardDrag(e, zone, at)}
                title={picking ? `${card.name} (눌러서 대표 카드로)`
                  : mouse ? `${card.name} (오른쪽 클릭이나 검색 쪽으로 끌어서 빼기, 눌러서 보기)` : `${card.name} (눌러서 빼기, 길게 누르면 보기)`}
                aria-label={picking ? `${card.name} 대표 카드로` : `${card.name} 1장 빼기`}
                className={`group relative block ${picking ? "cursor-copy" : ""} ${mouse && !picking ? "card-lift" : ""}`}
              >
                <DeckCardFace card={card} look={looks[at]} ban={banOf(card, rule)} rule={rule} />
                <OverRing ban={over.get(id)} />
                {mark !== undefined && (
                  <span className="absolute top-0.5 right-0.5 w-4 h-4 grid place-items-center rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none shadow">
                    {mark}
                  </span>
                )}
              </button>
            ) : (
              <Link key={flipKey} to={`/cards/${id}`} title={card.name} className="group relative block">
                <DeckCardFace card={card} look={looks[at]} ban={banOf(card, rule)} rule={rule} />
                <OverRing ban={over.get(id)} />
              </Link>
            );
          })}
        </div>
      ) : (
        <p className={`${reserve ? "deck-zone-reserve" : "h-16"} m-0 flex items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 break-keep`}>
          {onRemove ? (mouse ? "검색에서 카드를 오른쪽 클릭하거나 끌어다 놓으면 여기에 들어갑니다." : "검색에서 카드를 누르면 여기에 들어갑니다.") : "카드가 없습니다."}
        </p>
      )}
      </div>
    </section>
  );
}

/** A deck's main and extra decks, each card in the 디폴트 순 (order: the server's); shown on its page and while it is
 *  built. With onRemove (building) a card pressed comes out and the zones keep room for their first rows; without, a
 *  card opens its page. */
export default function DeckZones({ deck, cards, order, loading, rule, onRemove, onShow, onDrop, picking, marks }: {
  deck: Pick<DeckDraft, DeckZone> & { looks: DeckLooks };
  cards: Map<number, CardListItem>;
  order: Map<number, number>;
  loading: boolean;
  /** The deck's 금제 (lib/banlists; today's Master Duel list when none). */
  rule?: BanRule;
  /** Building: the copy pressed, by its place in the zone as kept. */
  onRemove?: (zone: DeckZone, at: number) => void;
  /** Building: a copy held (a finger) or clicked (a mouse) is shown. */
  onShow?: (card: CardListItem, zone: DeckZone, at: number) => void;
  /** Building: a card from the search dropped on the deck with a mouse goes in (엘리스 2026-10-18). */
  onDrop?: (card: CardListItem) => void;
  /** Building, a 대표 카드 being set: a card pressed goes there (onRemove) instead of out; marks: each zone's places
   *  holding one, with their slot. */
  picking?: boolean;
  marks?: Record<DeckZone, Map<number, number>>;
}) {
  const mouse = useMediaQuery(MOUSE_QUERY);
  // the zone a card being dragged over the deck belongs in, lit while it is (counted in and out of the children)
  const [drag, setDrag] = useState<{ zone: DeckZone; depth: number } | null>(null);
  return (
    <div
      className="flex flex-col gap-3 min-w-0"
      onDragEnter={(e) => {
        const zone = onDrop && draggedCardZone(e);
        if (zone) setDrag((d) => ({ zone, depth: (d?.depth ?? 0) + 1 }));
      }}
      onDragOver={(e) => {
        if (!onDrop || !draggedCardZone(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (onDrop && draggedCardZone(e)) setDrag((d) => (d && d.depth > 1 ? { ...d, depth: d.depth - 1 } : null));
      }}
      onDrop={(e) => {
        setDrag(null);
        const card = onDrop && droppedCard(e);
        if (!card) return;
        e.preventDefault();
        cardFrom(spotAt(e.clientX, e.clientY));   // it flies on from where it was let go
        onDrop(card);
      }}
    >
      {ZONES.map((z) => (
        <Zone
          key={z}
          zone={z}
          ids={deck[z]}
          looks={deck.looks[z]}
          order={order}
          cards={cards}
          loading={loading}
          rule={rule}
          onRemove={onRemove && ((at) => onRemove(z, at))}
          onShow={onShow && ((card, at) => onShow(card, z, at))}
          reserve={!!onRemove}
          picking={picking}
          marks={marks?.[z]}
          mouse={mouse && !!onRemove}
          lit={drag?.zone === z}
        />
      ))}
    </div>
  );
}
