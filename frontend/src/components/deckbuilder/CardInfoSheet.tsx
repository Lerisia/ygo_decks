import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCard, type CardDoc, type CardListItem } from "@/api/cardDexApi";

const BAN_LABEL = { forbidden: "금지", limited: "제한", semi_limited: "준제한" } as const;
const BUTTON = "flex-1 h-10 rounded-lg font-semibold text-sm transition disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed";

/** A card shown while a deck is built (held on a phone, right-clicked on a computer; 엘리스 2026-10-14): its picture,
 *  its text in Korean, and putting a copy in or taking one out without leaving the deck. */
export default function CardInfoSheet({ card, inDeck, onAdd, onRemove, onClose }: {
  card: CardListItem;
  /** How many copies the deck holds. */
  inDeck: number;
  onAdd?: () => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<CardDoc | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getCard(card.id).then((d) => alive && setDoc(d)).catch(() => alive && setFailed(true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [card.id, onClose]);
  const t = doc?.texts.ko ?? doc?.texts.ja ?? null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose} role="dialog" aria-modal="true" aria-label={card.name}>
      <div className="w-full sm:max-w-lg max-h-[85svh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-4">
          <img src={card.image_url || card.face_thumb_url || card.thumb_url || "/default_cover.png"} alt={card.name}
               className="w-28 sm:w-36 shrink-0 aspect-[704/1024] object-contain card-corner self-start" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold break-keep">{card.name}</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {card.rarity && <span className="mr-2">{card.rarity}</span>}
              {card.ban && <span className="font-semibold text-red-600 dark:text-red-400">{BAN_LABEL[card.ban]}</span>}
              {inDeck > 0 && <span className="ml-2 tabular-nums">덱에 {inDeck}장</span>}
            </p>
            <div className="mt-2 text-sm leading-relaxed whitespace-pre-line break-keep text-gray-800 dark:text-gray-200">
              {t ? (
                <>
                  {t.materials && <p className="mb-1 text-gray-600 dark:text-gray-300">{t.materials}</p>}
                  {t.pendulum_effect && <p className="mb-2"><span className="text-xs font-semibold text-gray-500">펜듈럼 효과</span><br />{t.pendulum_effect}</p>}
                  <p>{t.effect || t.flavor}</p>
                </>
              ) : failed ? (
                <p className="text-gray-500">카드 효과를 불러오지 못했습니다.</p>
              ) : (
                <span className="block h-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          {onRemove && <button type="button" onClick={onRemove} disabled={inDeck === 0} className={`${BUTTON} bg-gray-500 hover:bg-gray-600 text-white`}>1장 빼기</button>}
          {onAdd && <button type="button" onClick={onAdd} className={`${BUTTON} bg-blue-600 hover:bg-blue-700 text-white`}>1장 넣기</button>}
          <Link to={`/cards/${card.id}`} className={`${BUTTON} inline-flex items-center justify-center border border-gray-300 dark:border-gray-600`}>카드 문서</Link>
        </div>
      </div>
    </div>
  );
}
