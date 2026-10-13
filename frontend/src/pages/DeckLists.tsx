import { useMemo } from "react";
import { Link } from "react-router-dom";
import DeckListCard, { DeckListAddCard } from "@/components/deckbuilder/DeckListCard";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { listDecks } from "@/lib/deckDrafts";
import { NEW_DECK_PATH, deckListPath } from "@/lib/deckListPaths";

const ADD_BUTTON = "shrink-0 inline-flex items-center h-9 px-4 rounded-lg font-semibold text-sm transition bg-blue-600 hover:bg-blue-700 text-white";

/** 내 덱 리스트 (/decklists): the decks a member has built (덱 구축, 참혈 2026-10-13). Operators only while it is laid
 *  out; linked from nowhere yet. With none, a dashed card is the way to make the first (참혈 2026-10-14). */
export default function DeckLists() {
  const admin = useAdminOnly();
  const decks = useMemo(() => (admin ? listDecks() : []), [admin]);
  if (!admin) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen w-full max-w-5xl mx-auto px-4 py-6">
      <div className="h-9 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">내 덱 리스트</h1>
        {decks.length > 0 && <Link to={NEW_DECK_PATH} className={ADD_BUTTON}>+ 추가</Link>}
      </div>
      <p className="mt-1 mb-4 text-xs text-gray-500 dark:text-gray-400 break-keep">만든 덱은 지금은 이 브라우저에만 임시 저장됩니다.</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {decks.length ? (
          decks.map((d) => (
            <li key={d.code}>
              <DeckListCard deck={d} to={deckListPath(d.code)} />
            </li>
          ))
        ) : (
          <li>
            <DeckListAddCard to={NEW_DECK_PATH} />
          </li>
        )}
      </ul>
    </div>
  );
}
