import type { CardListItem } from "@/api/cardDexApi";
import { type CardLook, type CoverPick, COVERS_MAX } from "@/lib/deckDrafts";
import CopyFace from "./DeckFinish";

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

function Slot({ at, pick, look, cards, active }: {
  at: number; pick: CoverPick | null; look: CardLook | null; cards: Map<number, CardListItem>; active: boolean;
}) {
  const card = pick === null ? undefined : cards.get(pick.id);
  // the slot being set (참혈 2026-10-16): an empty one keeps its dashed card's look, its edge alone turning solid
  // blue; one holding a card is not marked
  if (pick === null) {
    return (
      <span className={`flex border-2 w-full h-full card-corner bg-gray-50 dark:bg-gray-800 ${active ? "border-solid border-blue-500" : "border-dashed border-gray-300 dark:border-gray-600"}`}>
        <span className={`absolute flex font-semibold text-gray-400 dark:text-gray-500 ${NUMBER_AT[at]}`}>
          {at === 0 ? <span className="text-[11px] lg:text-[13px] leading-tight text-center break-keep px-1">대표<br />카드</span> : <span className="text-xs lg:text-sm">{at + 1}</span>}
        </span>
      </span>
    );
  }
  if (!card) return <span className="block w-full h-full card-corner bg-gray-200 dark:bg-gray-700 animate-pulse" />;
  // drawn as the copy picked looks (참혈 2026-10-16)
  return (
    <span className="relative block w-full h-full card-corner shadow-md">
      <CopyFace card={card} look={look} className="block w-full h-full object-contain card-corner" />
    </span>
  );
}

// while a slot is being set, under the cards: the way out (참혈 2026-10-16)
const DONE = "absolute left-1/2 -translate-x-1/2 bottom-1 z-50 h-6 px-2.5 inline-flex items-center rounded-md bg-gray-900/80 dark:bg-black/80 text-white text-[11px] lg:text-xs font-semibold whitespace-nowrap shadow-md";

/** The deck's 대표 카드 (참혈 2026-10-16), up to three fanned in a square left of its name and description, bigger
 *  from lg, each drawn as the copy picked looks. From lg each slot is pressed on its own (onSlot): the one being set
 *  (active) comes to the front, and the deck's cards pressed go into it. Below lg the square is one button (onArea),
 *  starting with the first slot and going on from there. While one is set, 「눌러서 종료」 floats at the square's
 *  bottom: from lg it, or the slot being set pressed again, stops (onDone); below lg the whole square does. */
export default function CoverCards({ covers, lookOf, cards, active = null, wide = false, onSlot, onArea, onDone }: {
  covers: (CoverPick | null)[];
  lookOf: (pick: CoverPick) => CardLook | null;
  cards: Map<number, CardListItem>;
  /** the slot being set, or null */
  active?: number | null;
  /** from lg: the slots pressed one by one */
  wide?: boolean;
  /** none: the deck's page, which only shows the cards set (참혈 2026-10-16) */
  onSlot?: (slot: number) => void;
  onArea?: () => void;
  onDone?: () => void;
}) {
  const slots = Array.from({ length: COVERS_MAX }, (_, i) => covers[i] ?? null);
  const name = (i: number) => (slots[i] === null ? "비어 있음" : (cards.get(slots[i]!.id)?.name ?? ""));
  const slot = (i: number) => <Slot at={i} pick={slots[i]} look={slots[i] && lookOf(slots[i]!)} cards={cards} active={active === i} />;
  const SIZE = "relative shrink-0 w-[116px] h-[116px] lg:w-[168px] lg:h-[168px]";

  if (!onSlot || !onArea || !onDone) {
    return (
      <div role="group" aria-label="대표 카드" className={SIZE}>
        {DRAW_ORDER.filter((i) => slots[i] !== null).map((i) => (
          <span key={i} className={`${CARD} ${SLOT_LOOK[i]}`} title={name(i)}>
            {slot(i)}
          </span>
        ))}
      </div>
    );
  }
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
            {slot(i)}
          </span>
        ))}
        {active !== null && <span className={DONE}>눌러서 종료</span>}
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
          title={active === i ? "다시 누르면 종료" : `대표 카드 ${i + 1}`}
          className={`${CARD} ${SLOT_LOOK[i]} p-0 border-0 bg-transparent hover:-translate-y-1 ${active === i ? "!z-40" : ""}`}
        >
          {slot(i)}
        </button>
      ))}
      {active !== null && (
        <button type="button" onClick={onDone} className={`${DONE} border-0 hover:bg-gray-900 dark:hover:bg-black`}>눌러서 종료</button>
      )}
    </div>
  );
}
