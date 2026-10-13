import { Link } from "react-router-dom";
import type { CardListItem } from "@/api/cardDexApi";
import { type DeckDraft, type DeckZone, MAIN_MIN, ZONES, ZONE_LABEL, kindCounts, sortedZone } from "@/lib/deckDrafts";

// close together, as Master Duel lays out a deck
const GRID = "grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1 sm:gap-1.5";
const BAN_LABEL = { forbidden: "금지", limited: "제한", semi_limited: "준제한" } as const;

/** A card's picture as the card book draws it, its 금제 in the corner. */
export function DeckCardFace({ card, dim = false }: { card: CardListItem; dim?: boolean }) {
  return (
    <span className="relative block">
      <img
        loading="lazy"
        decoding="async"
        src={card.face_thumb_url || card.thumb_url || card.image_url || "/default_cover.png"}
        alt={card.name}
        className={`w-full aspect-[704/1024] object-contain card-corner transition ${dim ? "opacity-40" : "group-hover:opacity-75"}`}
      />
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

function Zone({ zone, ids, cards, loading, onRemove }: {
  zone: DeckZone;
  ids: number[];
  cards: Map<number, CardListItem>;
  loading: boolean;
  onRemove?: (id: number) => void;
}) {
  const counts = kindCounts(ids, cards);
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4">
      {/* the zone on the left, how many of each kind on the right (on a phone, the line below) */}
      <header className="mb-2 sm:flex sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="m-0 h-6 flex items-baseline gap-2 shrink-0 whitespace-nowrap text-base">
          <span className="font-bold">{ZONE_LABEL[zone]}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">{ids.length}장</span>
          {zone === "main" && ids.length < MAIN_MIN && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{MAIN_MIN}장 이상 필요</span>
          )}
        </h2>
        <p className="min-h-5 text-xs sm:text-sm text-gray-600 dark:text-gray-300 tabular-nums break-keep sm:text-right">
          {loading && ids.length ? (
            <span className="inline-block h-3.5 w-44 rounded bg-gray-200 dark:bg-gray-700 animate-pulse align-middle" />
          ) : (
            counts.map(({ label, count }, i) => (
              <span key={label}>
                {i > 0 && " / "}
                <span className="whitespace-nowrap">{label} : {count}장</span>
              </span>
            ))
          )}
        </p>
      </header>
      {ids.length ? (
        <div className={GRID}>
          {ids.map((id, i) => {
            const card = cards.get(id);
            if (!card) {
              return <span key={`${id}-${i}`} className={`${TILE_BLANK} ${loading ? "animate-pulse" : ""}`} />;
            }
            return onRemove ? (
              <button
                key={`${id}-${i}`}
                type="button"
                onClick={() => onRemove(id)}
                title={`${card.name} (눌러서 빼기)`}
                aria-label={`${card.name} 1장 빼기`}
                className="group block"
              >
                <DeckCardFace card={card} />
              </button>
            ) : (
              <Link key={`${id}-${i}`} to={`/cards/${id}`} title={card.name} className="group block">
                <DeckCardFace card={card} />
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="h-16 flex items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 break-keep">
          {onRemove ? "검색에서 카드를 누르면 여기에 들어갑니다." : "카드가 없습니다."}
        </p>
      )}
    </section>
  );
}

/** A deck's main and extra decks, each card in the 디폴트 순 (order: the server's); shown on its page and while it is
 *  built. With onRemove (building) a card pressed comes out; without, a card opens its page. */
export default function DeckZones({ deck, cards, order, loading, onRemove }: {
  deck: Pick<DeckDraft, DeckZone>;
  cards: Map<number, CardListItem>;
  order: Map<number, number>;
  loading: boolean;
  onRemove?: (zone: DeckZone, id: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 min-w-0">
      {ZONES.map((z) => (
        <Zone
          key={z}
          zone={z}
          ids={sortedZone(deck[z], order)}
          cards={cards}
          loading={loading}
          onRemove={onRemove && ((id) => onRemove(z, id))}
        />
      ))}
    </div>
  );
}
