import type { CardListItem } from "@/api/cardDexApi";
import { COVERS_MAX } from "@/lib/deckDrafts";

// The three slots fanned in one square (참혈 2026-10-16): the first in front in the middle, the second behind on the
// left, the third behind on the right. Drawn back to front; the slot being set comes to the front.
const SLOT_LOOK = [
  "left-[25%] top-[9%] z-30",
  "left-[3%] top-[14%] -rotate-[9deg] z-10",
  "left-[47%] top-[14%] rotate-[9deg] z-20",
];
const DRAW_ORDER = [1, 2, 0];
const CARD = "absolute w-1/2 aspect-[704/1024] card-corner transition";
// where a slot's number shows on an empty card: in the part the front card leaves uncovered
const NUMBER_AT = ["inset-0 items-center justify-center", "inset-y-0 left-[12%] items-start pt-[18%]", "inset-y-0 right-[12%] items-start pt-[18%]"];

function Slot({ at, id, cards, active }: { at: number; id: number | null; cards: Map<number, CardListItem>; active: boolean }) {
  const card = id === null ? undefined : cards.get(id);
  const ring = active ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900" : "";
  if (id === null) {
    return (
      <span className={`flex border-2 border-dashed bg-gray-50 dark:bg-gray-800 ${active ? "border-blue-500" : "border-gray-300 dark:border-gray-600"} w-full h-full card-corner ${ring}`}>
        <span className={`absolute flex text-gray-400 dark:text-gray-500 font-semibold ${NUMBER_AT[at]}`}>
          {at === 0 ? <span className="text-[11px] leading-tight text-center break-keep px-1">대표<br />카드</span> : <span className="text-xs">{at + 1}</span>}
        </span>
      </span>
    );
  }
  if (!card) return <span className={`block w-full h-full card-corner bg-gray-200 dark:bg-gray-700 animate-pulse ${ring}`} />;
  return (
    <img
      src={card.face_thumb_url || card.thumb_url || card.image_url || "/default_cover.png"}
      alt={card.name}
      className={`block w-full h-full object-contain card-corner shadow-md ${ring}`}
    />
  );
}

/** The deck's 대표 카드 (참혈 2026-10-16), up to three fanned in a square beside its name and description. From lg each
 *  slot is pressed on its own (onSlot): the one being set (active) stands out, and the deck's cards pressed go into it.
 *  Below lg the square is one button (onArea), starting with the first slot and going on from there. */
export default function CoverCards({ covers, cards, active, wide, onSlot, onArea }: {
  covers: (number | null)[];
  cards: Map<number, CardListItem>;
  /** the slot being set, or null */
  active: number | null;
  /** from lg: the slots pressed one by one */
  wide: boolean;
  onSlot: (slot: number) => void;
  onArea: () => void;
}) {
  const slots = Array.from({ length: COVERS_MAX }, (_, i) => covers[i] ?? null);
  const name = (i: number) => (slots[i] === null ? "비어 있음" : (cards.get(slots[i]!)?.name ?? ""));
  const SIZE = "relative shrink-0 w-[116px] h-[116px] md:w-[104px] md:h-[104px]";

  if (!wide) {
    return (
      <button
        type="button"
        onClick={onArea}
        aria-pressed={active !== null}
        aria-label={active === null ? "대표 카드 고르기" : "대표 카드 고르기 끝내기"}
        className={`${SIZE} block p-0 border-0 rounded-lg bg-transparent`}
      >
        {DRAW_ORDER.map((i) => (
          <span key={i} className={`${CARD} ${SLOT_LOOK[i]} ${active === i ? "!z-40" : ""}`}>
            <Slot at={i} id={slots[i]} cards={cards} active={active === i} />
          </span>
        ))}
      </button>
    );
  }
  return (
    <div role="group" aria-label="대표 카드" className={SIZE}>
      {DRAW_ORDER.map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSlot(i)}
          aria-pressed={active === i}
          aria-label={`대표 카드 ${i + 1}: ${name(i)}`}
          title={active === i ? "다시 누르면 취소" : `대표 카드 ${i + 1}`}
          className={`${CARD} ${SLOT_LOOK[i]} p-0 border-0 bg-transparent hover:-translate-y-1 ${active === i ? "!z-40" : ""}`}
        >
          <Slot at={i} id={slots[i]} cards={cards} active={active === i} />
        </button>
      ))}
    </div>
  );
}
