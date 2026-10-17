import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isAuthenticated } from "@/api/accountApi";
import { deleteDeckList, getDeckList, type DeckListDoc } from "@/api/deckListApi";
import { Pencil, Trash2 } from "lucide-react";
import CoverCards from "@/components/deckbuilder/CoverCards";
import DeckPage, { DECK_ICON, DECK_ICON_SIZE, DeckNotFound } from "@/components/deckbuilder/DeckPage";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useBanlist } from "@/hooks/useBanlist";
import { useDeckCards } from "@/hooks/useDeckCards";
import { banlistName, banlistTitle } from "@/lib/banlists";
import { coverLook, deckDayLine, deckWarnings, fromDoc } from "@/lib/deckDrafts";
import { DECK_LISTS_PATH, deckListEditPath } from "@/lib/deckListPaths";

const FOOT_BUTTON = "shrink-0 h-8 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors";

/** A deck list (/dev/decklists/:code): its main and extra decks, each card opening its page, the 금제 it is checked by
 *  and what keeps it from being played under it (덱 구축, 참혈 2026-10-13; from the server 2026-10-14; its 금제
 *  2026-10-16). Its owner's alone for now. Operators only. */
export default function DeckListView() {
  const admin = useAdminOnly();
  const navigate = useNavigate();
  const { code = "" } = useParams();
  const signedIn = isAuthenticated();
  // undefined while asked, null when there is no such deck of this member's
  const [deck, setDeck] = useState<DeckListDoc | null | undefined>(undefined);
  const { cards, order, loading, error } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);
  const { index: banlists, rule } = useBanlist(deck?.banlist || "md");
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

  const draft = deck ? fromDoc(deck) : null;

  return (
    <div className="min-h-screen w-full max-w-6xl mx-auto px-4 py-6">
      {deck && draft ? (
        // laid out as the editor, through the same parts (참혈 2026-10-16)
        <DeckPage
          back={<Link to={DECK_LISTS_PATH} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 내 덱 리스트</Link>}
          cover={draft.covers.length > 0 && <CoverCards covers={draft.covers} lookOf={(c) => coverLook(draft, c)} cards={cards} />}
          name={
            // its day beside it (참혈 2026-10-16)
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h1 className="m-0 text-xl leading-8 font-bold break-keep">{deck.name}</h1>
              <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{deckDayLine(draft)}</span>
            </div>
          }
          actions={
            <>
              <Link to={deckListEditPath(deck.code)} aria-label="수정" title="수정" className={`${DECK_ICON} text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400`}>
                <Pencil className={DECK_ICON_SIZE} aria-hidden />
              </Link>
              <button type="button" onClick={remove} aria-label="삭제" title="삭제" className={`${DECK_ICON} text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400`}>
                <Trash2 className={DECK_ICON_SIZE} aria-hidden />
              </button>
            </>
          }
          description={deck.description && <p className="m-0 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line break-keep">{deck.description}</p>}
          // 「마스터 듀얼 • 최신」 alone as the editor has it, its day in the title (참혈 2026-10-16)
          banlist={
            <span className="min-w-0 truncate font-semibold text-gray-700 dark:text-gray-200" title={banlistTitle(draft.banlist, banlists)}>
              {banlistName(draft.banlist, banlists)}
            </span>
          }
          warnings={deckWarnings(draft, cards, rule)}
          error={error}
        >
          <DeckZones deck={draft} cards={cards} order={order} loading={loading} rule={rule} />
          {/* under the deck: 덱 코드 on the left, the exports on the right (참혈 2026-10-17; the buttons alone for now) */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" className={FOOT_BUTTON}>덱 코드</button>
            <div className="flex items-center gap-2">
              <button type="button" className={FOOT_BUTTON}>이미지로 내보내기</button>
              <button type="button" className={FOOT_BUTTON}>목록으로 내보내기</button>
            </div>
          </div>
        </DeckPage>
      ) : (
        <DeckNotFound signedIn={signedIn} />
      )}
    </div>
  );
}
