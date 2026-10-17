import { Link } from "react-router-dom";
import type { CardListItem } from "@/api/cardDexApi";
import { usePressCard } from "@/hooks/usePressCard";
import CardKindTag from "@/components/CardKindTag";
import { type BanLimit, type BanRule, banOf } from "@/lib/banlists";
import {
  type CardLook, type DeckDraft, type DeckLooks, type DeckZone, ZONES, ZONE_LABEL, kindCounts, notOutCards, overLimit,
  sortedCopies,
} from "@/lib/deckDrafts";
import CopyFace from "./DeckFinish";

// While a deck is built each zone keeps room for this many rows of cards before any is in (참혈 2026-10-14): the main
// deck two on phones and tablets and three from lg, the extra deck one (deck-zone-reserve in index.css).
const RESERVE: Record<DeckZone, string> = { main: "[--rows:2] lg:[--rows:3]", extra: "[--rows:1]" };
const BAN_LABEL = { forbidden: "금지", limited: "제한", semi_limited: "준제한" } as const;
// what a zone lacks or holds too many of, by its title, in yellow (참혈 2026-10-16)

/** A card's picture as the card book draws it — a copy in the deck in its own print and finish (look, the finish
 *  moving: DeckFinish) — its 금제 in the corner: the deck's list's (ban), today's Master Duel one (on the card) when
 *  none is given. */
export function DeckCardFace({ card, look, dim = false, ban = card.ban }: { card: CardListItem; look?: CardLook | null; dim?: boolean; ban?: BanLimit | "" }) {
  return (
    <span className="relative block">
      <CopyFace card={card} look={look} className="w-full aspect-[704/1024] object-contain card-corner" tone={`transition ${dim ? "opacity-40" : "group-hover:opacity-75"}`} />
      {card.unreleased ? (
        <span className="absolute top-[3%] left-[4%] rounded px-1 py-px text-[10px] font-bold leading-4 bg-amber-500/90 text-white drop-shadow">미출시</span>
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

const TILE_BLANK = "block w-full aspect-[704/1024] card-corner bg-gray-200 dark:bg-gray-700";

function Zone({ zone, ids, looks, order, cards, loading, rule, onRemove, onShow, reserve, picking, marks }: {
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
}) {
  const counts = kindCounts(ids, cards);
  const press = usePressCard();
  // while it is built, cards over the deck's 금제 (one saved before it) and cards not out yet then are ringed in the
  // zone; no count warnings by the title, the pages' line under the name has them (참혈 2026-10-16)
  const ringed = new Set(onRemove ? [...overLimit(ids, cards, rule), ...notOutCards(ids, cards, rule)].map((o) => o.card.id) : []);
  return (
    <section className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4 transition-shadow ${picking ? "ring-2 ring-blue-500/70" : ""}`}>
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
      <div className={`deck-zone ${reserve ? RESERVE[zone] : ""}`}>
      {ids.length ? (
        <div className={`deck-zone-grid ${reserve ? "deck-zone-reserve" : ""}`}>
          {/* each copy in the 디폴트 순, pressed or shown as itself: its look, its 대표 카드 mark (참혈 2026-10-16) */}
          {sortedCopies(ids, order).map((at) => {
            const id = ids[at];
            const card = cards.get(id);
            if (!card) {
              return <span key={`${id}-${at}`} className={`${TILE_BLANK} ${loading ? "animate-pulse" : ""}`} />;
            }
            const mark = marks?.get(at);
            return onRemove ? (
              <button
                key={`${id}-${at}`}
                type="button"
                {...press(() => onRemove(at), () => onShow?.(card, at))}
                title={picking ? `${card.name} (눌러서 대표 카드로)` : `${card.name} (눌러서 빼기, 길게 누르거나 오른쪽 클릭으로 보기)`}
                aria-label={picking ? `${card.name} 대표 카드로` : `${card.name} 1장 빼기`}
                className={`group relative block ${picking ? "cursor-copy" : ""}`}
              >
                <DeckCardFace card={card} look={looks[at]} ban={banOf(card, rule)} />
                {ringed.has(id) && <span className="absolute inset-0 card-corner ring-2 ring-inset ring-amber-400 pointer-events-none" />}
                {mark !== undefined && (
                  <span className="absolute top-0.5 right-0.5 w-4 h-4 grid place-items-center rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none shadow">
                    {mark}
                  </span>
                )}
              </button>
            ) : (
              <Link key={`${id}-${at}`} to={`/cards/${id}`} title={card.name} className="group block">
                <DeckCardFace card={card} look={looks[at]} ban={banOf(card, rule)} />
              </Link>
            );
          })}
        </div>
      ) : (
        <p className={`${reserve ? "deck-zone-reserve" : "h-16"} m-0 flex items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 break-keep`}>
          {onRemove ? "검색에서 카드를 누르면 여기에 들어갑니다." : "카드가 없습니다."}
        </p>
      )}
      </div>
    </section>
  );
}

/** A deck's main and extra decks, each card in the 디폴트 순 (order: the server's); shown on its page and while it is
 *  built. With onRemove (building) a card pressed comes out and the zones keep room for their first rows; without, a
 *  card opens its page. */
export default function DeckZones({ deck, cards, order, loading, rule, onRemove, onShow, picking, marks }: {
  deck: Pick<DeckDraft, DeckZone> & { looks: DeckLooks };
  cards: Map<number, CardListItem>;
  order: Map<number, number>;
  loading: boolean;
  /** The deck's 금제 (lib/banlists; today's Master Duel list when none). */
  rule?: BanRule;
  /** Building: the copy pressed, by its place in the zone as kept. */
  onRemove?: (zone: DeckZone, at: number) => void;
  /** Building: a copy held or right-clicked is shown. */
  onShow?: (card: CardListItem, zone: DeckZone, at: number) => void;
  /** Building, a 대표 카드 being set: a card pressed goes there (onRemove) instead of out; marks: each zone's places
   *  holding one, with their slot. */
  picking?: boolean;
  marks?: Record<DeckZone, Map<number, number>>;
}) {
  return (
    <div className="flex flex-col gap-3 min-w-0">
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
        />
      ))}
    </div>
  );
}
