import { Link } from "react-router-dom";
import type { CardListItem } from "@/api/cardDexApi";
import { usePressCard } from "@/hooks/usePressCard";
import CardKindTag from "@/components/CardKindTag";
import {
  type CardLook, type DeckDraft, type DeckLooks, type DeckZone, MAIN_MIN, ZONES, ZONE_LABEL, kindCounts, lookThumb, overLimit, sortedCopies,
} from "@/lib/deckDrafts";

// While a deck is built each zone keeps room for this many rows of cards before any is in (참혈 2026-10-14): the main
// deck two on phones and tablets and three from lg, the extra deck one (deck-zone-reserve in index.css).
const RESERVE: Record<DeckZone, string> = { main: "[--rows:2] lg:[--rows:3]", extra: "[--rows:1]" };
const BAN_LABEL = { forbidden: "금지", limited: "제한", semi_limited: "준제한" } as const;
// what a zone lacks or holds too many of, by its title, in yellow (참혈 2026-10-16)
const WARN = "text-xs font-semibold text-amber-600 dark:text-amber-400";

const FINISH_LABEL = { shine: "샤인", royal: "로얄" } as const;

/** A copy in 샤인 or 로얄 on a small card (참혈 2026-10-16): a still sheen over it and a small gem in the corner, not
 *  the shader, which a deck's worth of would weigh too much (card-sheen in index.css). */
export function FinishMark({ finish }: { finish: CardLook["finish"] | undefined }) {
  if (finish !== "shine" && finish !== "royal") return null;
  return (
    <>
      <span className={`card-sheen card-sheen-${finish} absolute inset-0 card-corner pointer-events-none`} aria-hidden />
      <span className={`card-gem card-gem-${finish} absolute bottom-[3%] left-[5%] pointer-events-none`} title={FINISH_LABEL[finish]} aria-label={FINISH_LABEL[finish]} />
    </>
  );
}

/** A card's picture as the card book draws it — a copy in the deck in its own print and finish (look) — its 금제 in
 *  the corner. */
export function DeckCardFace({ card, look, dim = false }: { card: CardListItem; look?: CardLook | null; dim?: boolean }) {
  return (
    <span className="relative block">
      <img
        loading="lazy"
        decoding="async"
        src={lookThumb(card, look)}
        alt={card.name}
        className={`w-full aspect-[704/1024] object-contain card-corner transition ${dim ? "opacity-40" : "group-hover:opacity-75"}`}
      />
      <FinishMark finish={look?.finish} />
      {card.ban && (
        <img
          src={`/media/md_ui/info/limit/${card.ban}.webp`}
          alt={BAN_LABEL[card.ban]}
          className="absolute top-[3%] left-[4%] w-[22%] h-auto drop-shadow"
        />
      )}
    </span>
  );
}

const TILE_BLANK = "block w-full aspect-[704/1024] card-corner bg-gray-200 dark:bg-gray-700";

function Zone({ zone, ids, looks, order, cards, loading, onRemove, onShow, reserve, picking, marks }: {
  zone: DeckZone;
  /** as kept: an id once per copy, in the order they went in */
  ids: number[];
  looks: (CardLook | null)[];
  order: Map<number, number>;
  cards: Map<number, CardListItem>;
  loading: boolean;
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
  // while it is built, cards over today's 금제 (one saved before it) are ringed in the zone; the editor shows no count
  // warnings by the title (참혈 2026-10-16), a deck being looked at still says it is short
  const over = onRemove ? overLimit(ids, cards) : [];
  const overIds = new Set(over.map((o) => o.card.id));
  return (
    <section className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4 transition-shadow ${picking ? "ring-2 ring-blue-500/70" : ""}`}>
      {/* the zone on the left, how many of each kind on the right, on a phone too (참혈 2026-10-16) */}
      <header className="mb-2 flex items-start justify-between gap-2 sm:gap-3">
        <h2 className="m-0 h-6 flex items-baseline gap-2 shrink-0 whitespace-nowrap text-base">
          <span className="font-bold">{ZONE_LABEL[zone]}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">{ids.length}장</span>
          {!onRemove && zone === "main" && ids.length < MAIN_MIN && <span className={WARN}>{MAIN_MIN}장 이상 필요</span>}
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
                <DeckCardFace card={card} look={looks[at]} />
                {overIds.has(id) && <span className="absolute inset-0 card-corner ring-2 ring-inset ring-amber-400 pointer-events-none" />}
                {mark !== undefined && (
                  <span className="absolute top-0.5 right-0.5 w-4 h-4 grid place-items-center rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none shadow">
                    {mark}
                  </span>
                )}
              </button>
            ) : (
              <Link key={`${id}-${at}`} to={`/cards/${id}`} title={card.name} className="group block">
                <DeckCardFace card={card} look={looks[at]} />
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
export default function DeckZones({ deck, cards, order, loading, onRemove, onShow, picking, marks }: {
  deck: Pick<DeckDraft, DeckZone> & { looks: DeckLooks };
  cards: Map<number, CardListItem>;
  order: Map<number, number>;
  loading: boolean;
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
