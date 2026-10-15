import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isAuthenticated } from "@/api/accountApi";
import { deleteDeckList, getDeckList, type DeckListDoc } from "@/api/deckListApi";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useDeckCards } from "@/hooks/useDeckCards";
import { deckDay } from "@/lib/deckDrafts";
import { DECK_LISTS_PATH, deckListEditPath } from "@/lib/deckListPaths";

const BUTTON = "shrink-0 inline-flex items-center h-9 px-4 rounded-lg font-semibold text-sm transition bg-blue-600 hover:bg-blue-700 text-white";

/** A deck list (/dev/decklists/:code): its main and extra decks, each card opening its page, and what keeps it from being
 *  played today (덱 구축, 참혈 2026-10-13; from the server 2026-10-14). Its owner's alone for now. Operators only. */
export default function DeckListView() {
  const admin = useAdminOnly();
  const navigate = useNavigate();
  const { code = "" } = useParams();
  const signedIn = isAuthenticated();
  // undefined while asked, null when there is no such deck of this member's
  const [deck, setDeck] = useState<DeckListDoc | null | undefined>(undefined);
  const { cards, order, loading, error } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);
  useEffect(() => {
    if (!admin) return;
    if (!signedIn) {
      setDeck(null);
      return;
    }
    let alive = true;
    getDeckList(code).then((d) => alive && setDeck(d), () => alive && setDeck(null));
    return () => {
      alive = false;
    };
  }, [admin, code, signedIn]);
  if (!admin || deck === undefined) return <div className="min-h-screen" />;

  const remove = async () => {
    if (!deck || !window.confirm(`'${deck.name}' 덱을 지울까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteDeckList(deck.code);
      navigate(DECK_LISTS_PATH, { replace: true });
    } catch {
      window.alert("덱을 지우지 못했습니다.");
    }
  };

  return (
    <div className="min-h-screen w-full max-w-5xl mx-auto px-4 py-6">
      <Link to={DECK_LISTS_PATH} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 내 덱 리스트</Link>
      {deck ? (
        <>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold break-keep">{deck.name}</h1>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                등록일 {deckDay(deck.created_at)}
                {deckDay(deck.updated_at) !== deckDay(deck.created_at) && <> · 갱신일 {deckDay(deck.updated_at)}</>}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={remove} className={`${BUTTON} bg-gray-500 hover:bg-gray-600`}>삭제</button>
              <Link to={deckListEditPath(deck.code)} className={BUTTON}>수정</Link>
            </div>
          </div>
          {deck.description && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line break-keep">{deck.description}</p>
          )}
          {deck.issues.length > 0 && (
            <ul className="mt-3 text-xs text-amber-700 dark:text-amber-400 break-keep space-y-0.5">
              {deck.issues.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-4">
            <DeckZones deck={deck} cards={cards} order={order} loading={loading} />
          </div>
        </>
      ) : (
        <div className="py-16 flex flex-col items-center gap-4">
          <p className="text-gray-600 dark:text-gray-300">{signedIn ? "덱을 찾을 수 없습니다." : "로그인하면 저장한 덱을 볼 수 있습니다."}</p>
          <Link to={DECK_LISTS_PATH} className={BUTTON}>목록으로</Link>
        </div>
      )}
    </div>
  );
}
