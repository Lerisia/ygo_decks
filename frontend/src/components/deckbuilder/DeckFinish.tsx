import type { CardListItem } from "@/api/cardDexApi";
import { type CardLook, lookThumb } from "@/lib/deckDrafts";

/** A copy's small face in its own print (참혈 2026-10-16). It once moved in 샤인 / 로얄 through the card page's shaders;
 *  a deck list needs no finish (엘리스 2026-10-18), so the print is drawn plain. className sizes the picture; tone
 *  (fading) goes on it. */
export default function CopyFace({ card, look, className, tone = "" }: {
  card: CardListItem; look: CardLook | null | undefined; className: string; tone?: string;
}) {
  return <img loading="lazy" decoding="async" src={lookThumb(card, look)} alt={card.name} className={`${className} ${tone}`} />;
}
