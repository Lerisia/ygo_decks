import type { CardDoc } from "@/api/cardDexApi";
import type { FinishParams, FinishStyle } from "@/lib/cardFinish";

/** How a card is looked at: which of its prints and in which finish — on the card page and for each copy in a deck
 *  being built (참혈 2026-10-16), the same choices by the same rules. */
export type FinishKey = "normal" | FinishStyle;
type Face = CardDoc["faces"][number];

// Master Duel's finishes (가공), drawn with the game's own shaders (엘리스 2026-10-11); 로얄 comes in SR and UR only
export const ROYAL_RARITIES = new Set(["SR", "UR", ""]);   // "" for a print whose rarity is not known
export const FINISHES: { key: FinishKey; label: string }[] = [
  { key: "normal", label: "일반" },
  { key: "shine", label: "샤인" },
  { key: "royal", label: "로얄" },
];

/** The finishes a print comes in: the print picked decides (an N / R card's UR 오버프레임 comes in 로얄, the card
 *  itself does not); a token in neither 샤인 nor 로얄 (엘리스 10/12). */
export const finishesFor = (card: Pick<CardDoc, "frame" | "rarity">, face?: Pick<Face, "rarity">) =>
  card.frame === "token" ? [] : FINISHES.filter((f) => f.key !== "royal" || ROYAL_RARITIES.has(face?.rarity ?? card.rarity));

/** What the shaders draw a print with: the card's own values, a print in 오버프레임 without the frame's lines. */
export const faceParams = (card: Pick<CardDoc, "finish">, face?: Pick<Face, "overframe" | "name_mask">): FinishParams => ({
  ...card.finish, frame: face?.overframe ? "overframe" : card.finish.frame, name: face?.name_mask ?? null,
});

/** 일반 / 샤인 / 로얄, side by side. */
export function FinishToggle({ finishes, value, onChange, className = "" }: {
  finishes: { key: FinishKey; label: string }[];
  value: FinishKey;
  onChange: (key: FinishKey) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="가공" className={`grid ${finishes.length === 3 ? "grid-cols-3" : "grid-cols-2"} rounded-lg bg-gray-300 dark:bg-gray-700 p-0.5 font-semibold ${className}`}>
      {finishes.map((f) => (
        <button
          key={f.key}
          type="button"
          role="radio"
          aria-checked={value === f.key}
          onClick={() => onChange(f.key)}
          className={`py-1 px-0 border-0 rounded-md transition ${
            value === f.key ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow" : "bg-transparent text-gray-600 dark:text-gray-300"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** The card's prints, its own first and then Master Duel's 다른 일러스트, the one shown ringed. */
export function FaceThumbs({ faces, value, onPick, className = "", itemClassName = "", ring = "ring-white ring-offset-black" }: {
  faces: Face[];
  /** the md id of the print shown */
  value: number | undefined;
  onPick: (face: Face) => void;
  className?: string;
  itemClassName?: string;
  /** the ring round the one shown */
  ring?: string;
}) {
  return (
    <div className={className}>
      {faces.map((f, i) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onPick(f)}
          aria-pressed={value === f.id}
          className={`p-0 border-0 bg-transparent card-corner overflow-hidden ring-2 ring-offset-1 transition touch-manipulation ${itemClassName} ${value === f.id ? ring : "ring-transparent ring-offset-transparent"}`}
          aria-label={i === 0 ? "기본 일러스트" : `다른 일러스트 ${i}`}
        >
          <img src={f.thumb || f.face} alt="" loading="lazy" className="block w-full aspect-[704/1024] object-contain" />
        </button>
      ))}
    </div>
  );
}
