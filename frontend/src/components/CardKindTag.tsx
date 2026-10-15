import { cardTagLook } from "@/lib/cardTag";

/** A card kind's tag (몬스터, 마법, 융합 …) in its Master Duel frame colour, as /dev/cards' drop-down and the deck builder's
 *  zone counts show it (참혈 2026-10-15·16); a tag with no frame colour (카드군, 서포트, 검색) stays grey. */
export default function CardKindTag({ tag, frame, className = "" }: { tag: string; frame?: string; className?: string }) {
  const look = cardTagLook(tag, frame);
  return (
    <span
      style={look?.style}
      className={`shrink-0 inline-block w-10 text-center rounded text-[11px] leading-5 font-semibold ${
        look ? (look.dark ? "dark:ring-1 dark:ring-white/30" : "") : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
      } ${className}`}
    >
      {tag}
    </span>
  );
}
