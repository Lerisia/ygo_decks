import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useDeckCards } from "@/hooks/useDeckCards";
import { deckDay, getDeck } from "@/lib/deckDrafts";
import { DECK_LISTS_PATH, deckListEditPath } from "@/lib/deckListPaths";

const BUTTON = "shrink-0 inline-flex items-center h-9 px-4 rounded-lg font-semibold text-sm transition bg-blue-600 hover:bg-blue-700 text-white";

/** A deck list (/decklists/:code): its main and extra decks, each card opening its page (덱 구축, 참혈 2026-10-13).
 *  Operators only for now. */
export default function DeckListView() {
  const admin = useAdminOnly();
  const { code = "" } = useParams();
  const deck = useMemo(() => (admin ? getDeck(code) : null), [admin, code]);
  const { cards, order, loading, error } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);
  if (!admin) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen w-full max-w-5xl mx-auto px-4 py-6">
      <Link to={DECK_LISTS_PATH} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 내 덱 리스트</Link>
      {deck ? (
        <>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold break-keep">{deck.name || "이름 없는 덱"}</h1>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">등록일 {deckDay(deck.createdAt)}</p>
            </div>
            <Link to={deckListEditPath(deck.code)} className={BUTTON}>수정</Link>
          </div>
          {deck.description && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line break-keep">{deck.description}</p>
          )}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-4">
            <DeckZones deck={deck} cards={cards} order={order} loading={loading} />
          </div>
        </>
      ) : (
        <div className="py-16 flex flex-col items-center gap-4">
          <p className="text-gray-600 dark:text-gray-300">덱을 찾을 수 없습니다.</p>
          <Link to={DECK_LISTS_PATH} className={BUTTON}>목록으로</Link>
        </div>
      )}
    </div>
  );
}
