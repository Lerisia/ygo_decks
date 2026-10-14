import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isAuthenticated } from "@/api/accountApi";
import { createDeckList, listDeckLists, type DeckListRow } from "@/api/deckListApi";
import DeckListCard, { DeckListAddCard } from "@/components/deckbuilder/DeckListCard";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { type DeckDraft, clearLocalDrafts, localDrafts } from "@/lib/deckDrafts";
import { NEW_DECK_PATH, deckListPath } from "@/lib/deckListPaths";

const ADD_BUTTON = "shrink-0 inline-flex items-center h-9 px-4 rounded-lg font-semibold text-sm transition bg-blue-600 hover:bg-blue-700 text-white";

/** The decks the first layout kept in this browser go to the member's account, once (2026-10-14). */
async function moveLocalDrafts() {
  const kept: DeckDraft[] = [];
  const local = localDrafts();
  for (const d of local) {
    try {
      await createDeckList({ name: d.name.trim() || "이름 없는 덱", description: d.description, main: d.main, extra: d.extra });
    } catch {
      kept.push(d);
    }
  }
  if (local.length) clearLocalDrafts(kept);
}

/** 내 덱 리스트 (/decklists): the decks a member has saved (덱 구축, 참혈 2026-10-13; on the server from 2026-10-14).
 *  Operators only while it is laid out; linked from nowhere yet. With none, a dashed card is the way to make the
 *  first (참혈 2026-10-14). A guest is asked to sign in, and may still build one. */
export default function DeckLists() {
  const admin = useAdminOnly();
  const signedIn = isAuthenticated();
  const [decks, setDecks] = useState<DeckListRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!admin || !signedIn) return;
    let alive = true;
    moveLocalDrafts()
      .then(listDeckLists)
      .then((list) => alive && setDecks(list))
      .catch(() => alive && setError("덱 목록을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [admin, signedIn]);
  if (!admin) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen w-full max-w-5xl mx-auto px-4 py-6">
      <div className="h-9 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">내 덱 리스트</h1>
        {!!decks?.length && <Link to={NEW_DECK_PATH} className={ADD_BUTTON}>+ 추가</Link>}
      </div>
      {!signedIn ? (
        <div className="py-16 flex flex-col items-center gap-4 text-center">
          <p className="text-gray-600 dark:text-gray-300 break-keep">로그인하면 덱을 저장하고 모아 볼 수 있습니다.</p>
          <div className="flex gap-2">
            <Link to={`/login?next=${encodeURIComponent("/decklists")}`} className={ADD_BUTTON}>로그인</Link>
            <Link to={NEW_DECK_PATH} className={`${ADD_BUTTON} bg-gray-500 hover:bg-gray-600`}>덱 짜 보기</Link>
          </div>
        </div>
      ) : error ? (
        <p className="py-16 text-center text-gray-500">{error}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {decks === null ? (
            Array.from({ length: 3 }, (_, i) => <li key={i} className="h-[6.75rem] rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse" />)
          ) : decks.length ? (
            decks.map((d) => (
              <li key={d.code}>
                <DeckListCard deck={{ name: d.name, description: d.description, createdAt: d.created_at, updatedAt: d.updated_at }} to={deckListPath(d.code)} />
              </li>
            ))
          ) : (
            <li>
              <DeckListAddCard to={NEW_DECK_PATH} />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
