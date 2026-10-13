import { useCallback, useEffect, useRef, useState } from "react";
import { getCardsByIds, type CardListItem } from "@/api/cardDexApi";

/** A deck's cards from the server: what each is (name, picture, kind) and their place in the 디폴트 순. ids: every card
 *  in the deck, or null while there is nothing to ask yet. When a card new to the deck goes in, the deck is asked for
 *  again to learn its place; loading is the first answer only, so the deck never blinks back to its skeleton. */
export function useDeckCards(ids: number[] | null) {
  const [cards, setCards] = useState<Map<number, CardListItem>>(() => new Map());
  const [order, setOrder] = useState<Map<number, number>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const placed = useRef(order);
  placed.current = order;
  const key = ids === null ? null : [...new Set(ids)].sort((a, b) => a - b).join(",");

  useEffect(() => {
    if (key === null) return;
    const wanted = key ? key.split(",").map(Number) : [];
    if (wanted.every((id) => placed.current.has(id))) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    getCardsByIds(wanted, ctrl.signal)
      .then((rows) => {
        setCards((prev) => {
          const next = new Map(prev);
          rows.forEach((r) => next.set(r.id, r));
          return next;
        });
        setOrder(new Map(rows.map((r, i) => [r.id, i])));
        setError("");
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError("카드 정보를 불러오지 못했습니다.");
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [key]);

  /** A card picked in the search is known at once, before the server places it. */
  const remember = useCallback((card: CardListItem) => {
    setCards((prev) => (prev.has(card.id) ? prev : new Map(prev).set(card.id, card)));
  }, []);

  return { cards, order, loading, error, remember };
}
