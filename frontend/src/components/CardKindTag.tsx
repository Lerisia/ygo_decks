import { cardTagLook } from "@/lib/cardTag";

/** A card kind's tag (몬스터, 마법, 융합 …) in its Master Duel frame colour, as /dev/cards' drop-down and the deck builder's
 *  zone counts show it (참혈 2026-10-15·16); a tag with no frame colour (카드군, 서포트, 검색) stays grey. */
/** `compact`: a size smaller on a phone, for a row that must fit beside a title (the deck builder's zone counts). */
export default function CardKindTag({ tag, frame, compact = false, className = "" }: { tag: string; frame?: string; compact?: boolean; className?: string }) {
  const look = cardTagLook(tag, frame);
  return (
    <span
      style={look?.style}
      className={`shrink-0 inline-block text-center rounded leading-5 font-semibold ${compact ? "w-9 sm:w-10 text-[10px] sm:text-[11px]" : "w-10 text-[11px]"} ${
        look ? (look.dark ? "dark:ring-1 dark:ring-white/30" : "") : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
      } ${className}`}
    >
      {tag}
    </span>
  );
}
